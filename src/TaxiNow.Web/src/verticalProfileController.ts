import type { ElevationProfileResponse, TelemetrySnapshot, WeatherProfileResponse } from './contracts';
import type { FlightPlan } from './flightPlan';
import {
  buildVerticalProfileModel,
  hasFreshProfileTelemetry,
  profileTelemetryFreshnessMilliseconds,
  projectPositionOntoRoute
} from './verticalProfile';
import type { VerticalProfileView, VerticalProfileViewState } from './verticalProfileView';

interface VerticalProfileControllerOptions {
  initialOpen: boolean;
  fetch?: typeof fetch;
  onOpenChange?: (open: boolean) => void;
  preferenceStore?: ProfileOpenPreferenceStore;
}

export interface ProfileOpenPreferenceStore {
  load(fallback: boolean): boolean;
  save(open: boolean): void;
}

const profileOpenPreferenceKey = 'taxinow.map.profileOpen';

export function createSessionProfileOpenPreference(
  storage?: Pick<Storage, 'getItem' | 'setItem'>
): ProfileOpenPreferenceStore {
  return {
    load(fallback) {
      try {
        const value = storage?.getItem(profileOpenPreferenceKey);
        return value === 'true' ? true : value === 'false' ? false : fallback;
      } catch { return fallback; }
    },
    save(open) {
      try { storage?.setItem(profileOpenPreferenceKey, String(open)); }
      catch { /* The controller retains the choice in memory. */ }
    }
  };
}

const unavailableTerrain: ElevationProfileResponse = {
  samples: [], cacheState: 'fresh', generatedAt: '', source: 'Terrain unavailable', attribution: ''
};

export class VerticalProfileController {
  private plan: FlightPlan | undefined;
  private telemetry: TelemetrySnapshot | undefined;
  private telemetryExpiry: ReturnType<typeof setTimeout> | undefined;
  private routeHash: string | undefined;
  private terrain: ElevationProfileResponse | undefined;
  private readonly terrainCache = new Map<string, ElevationProfileResponse>();
  private request: { abort: AbortController; promise: Promise<void> } | undefined;
  private weatherIdentity: string | undefined;
  private weather: WeatherProfileResponse | undefined;
  private readonly weatherCache = new Map<string, WeatherProfileResponse>();
  private weatherRequest: { abort: AbortController; promise: Promise<void>; key: string } | undefined;
  private weatherFeatureDisabled = false;
  private state: VerticalProfileViewState = { status: 'empty' };
  private openPreference: boolean;
  private mapView: 'globe' | 'ground' = 'globe';
  private applyingOpen = false;
  private readonly fetch: typeof fetch;

  constructor(private readonly view: VerticalProfileView, private readonly options: VerticalProfileControllerOptions) {
    this.openPreference = options.preferenceStore?.load(options.initialOpen) ?? options.initialOpen;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  setPlan(plan: FlightPlan | undefined): Promise<void> {
    // The coordinate serialization is an exact, collision-free route cache key.
    // Altitudes, labels and import timestamps do not change the terrain request.
    const routeHash = plan ? JSON.stringify(plan.points.map(point => point.position)) : undefined;
    this.plan = plan;
    if (routeHash !== this.routeHash) {
      this.request?.abort.abort();
      this.request = undefined;
      this.routeHash = routeHash;
      this.terrain = routeHash ? this.terrainCache.get(routeHash) : undefined;
    }
    const weatherIdentity = plan ? this.createWeatherIdentity(plan) : undefined;
    if (weatherIdentity !== this.weatherIdentity) {
      this.weatherRequest?.abort.abort();
      this.weatherRequest = undefined;
      this.weatherIdentity = weatherIdentity;
      this.weather = undefined;
    }
    if (!plan) {
      this.weatherRequest?.abort.abort();
      this.weatherRequest = undefined;
      this.weather = undefined;
      this.state = { status: 'empty' };
      this.render();
      return Promise.resolve();
    }
    let terrainPromise: Promise<void>;
    if (this.terrain) {
      this.state = { status: 'ready' };
      this.render();
      terrainPromise = Promise.resolve();
    } else if (this.request) {
      this.render();
      terrainPromise = this.request.promise;
    } else {
      terrainPromise = this.loadTerrain();
    }
    const weatherPromise = this.isVisible() ? this.loadWeather() : Promise.resolve();
    return Promise.all([terrainPromise, weatherPromise]).then(() => undefined);
  }

  setTelemetry(sample: TelemetrySnapshot): void {
    if (this.telemetryExpiry !== undefined) clearTimeout(this.telemetryExpiry);
    this.telemetryExpiry = undefined;
    this.telemetry = sample;
    if (hasFreshProfileTelemetry(sample)) {
      const remaining = profileTelemetryFreshnessMilliseconds - (Date.now() - Date.parse(sample.serverTimestampUtc));
      this.telemetryExpiry = setTimeout(() => {
        this.telemetryExpiry = undefined;
        this.telemetry = undefined;
        this.render();
      }, remaining);
    }
    this.render();
    if (this.isVisible()) void this.loadWeather();
  }

  retry(): Promise<void> {
    if (!this.plan) return Promise.resolve();
    const pending: Promise<void>[] = [];
    if (!this.terrain && !this.request) pending.push(this.loadTerrain());
    else if (this.request) pending.push(this.request.promise);
    if ((!this.weather || this.weather.cacheState === 'stale') &&
        !this.weatherFeatureDisabled && this.isVisible()) {
      pending.push(this.loadWeather(true));
    }
    return Promise.all(pending).then(() => undefined);
  }

  setOpen(open: boolean): void {
    // setOpen on the view emits a synchronous event. Mode-driven hiding must
    // not be interpreted as the user choosing to close the profile.
    if (this.applyingOpen) return;
    this.openPreference = open;
    this.options.preferenceStore?.save(open);
    this.applyOpen();
    if (this.isVisible()) void this.loadWeather();
    else {
      this.weatherRequest?.abort.abort();
      this.weatherRequest = undefined;
    }
  }

  setMapView(mapView: 'globe' | 'ground'): void {
    this.mapView = mapView;
    this.applyOpen();
    if (this.isVisible()) void this.loadWeather();
    else {
      this.weatherRequest?.abort.abort();
      this.weatherRequest = undefined;
    }
  }

  private applyOpen(): void {
    const open = this.mapView === 'globe' && this.openPreference;
    this.applyingOpen = true;
    try { this.view.setOpen(open); }
    finally { this.applyingOpen = false; }
    this.options.onOpenChange?.(open);
  }

  private isVisible(): boolean {
    return this.mapView === 'globe' && this.openPreference;
  }

  private loadTerrain(): Promise<void> {
    const routeHash = this.routeHash!;
    const route = this.plan!.points.map(point => ({ longitude: point.position[0], latitude: point.position[1] }));
    const request = { abort: new AbortController(), promise: Promise.resolve() };
    this.request = request;
    this.state = { status: 'loading' };
    this.render();
    const isCurrent = () => this.request === request && this.routeHash === routeHash && !request.abort.signal.aborted;
    request.promise = (async () => {
      try {
        const response = await this.fetch('/api/v1/elevation/profile', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ route }), signal: request.abort.signal
        });
        if (!response.ok) throw new Error('Terrain request failed');
        const terrain = await response.json() as ElevationProfileResponse;
        if (!isCurrent()) return;
        this.terrain = terrain;
        this.state = { status: 'ready' };
        this.render();
        this.terrainCache.set(routeHash, terrain);
      } catch {
        if (!isCurrent()) return;
        this.terrain = undefined;
        this.state = { status: 'error' };
        this.render();
      } finally {
        if (this.request === request) this.request = undefined;
      }
    })();
    return request.promise;
  }

  private loadWeather(force = false): Promise<void> {
    if (!this.plan || !this.weatherIdentity || this.weatherFeatureDisabled || !this.isVisible()) {
      return Promise.resolve();
    }
    const body = this.buildWeatherRequest(this.plan);
    const bucketSource = this.plan.departureTimeUtc
      ? Date.parse(this.plan.departureTimeUtc)
      : Date.now();
    const bucket = Math.floor((Number.isFinite(bucketSource) ? bucketSource : Date.now()) / 300_000);
    const key = `${this.weatherIdentity}|${bucket}`;
    const cached = this.weatherCache.get(key);
    if (!force && cached && this.coversRequestedWindow(cached, body.currentDistanceNm ?? 0)) {
      this.weather = cached;
      this.render();
      return Promise.resolve();
    }
    if (this.weatherRequest?.key === key) return this.weatherRequest.promise;
    this.weatherRequest?.abort.abort();
    const request = { abort: new AbortController(), promise: Promise.resolve(), key };
    this.weatherRequest = request;
    const identity = this.weatherIdentity;
    const previousWeather = this.weather;
    request.promise = (async () => {
      try {
        const response = await this.fetch('/api/v1/weather/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: request.abort.signal
        });
        if (response.status === 404) {
          if (this.weatherRequest === request && this.weatherIdentity === identity) {
            this.weatherFeatureDisabled = true;
            this.weather = undefined;
            this.render();
          }
          return;
        }
        if (!response.ok) throw new Error('Weather request failed');
        const weather = await response.json() as WeatherProfileResponse;
        if (this.weatherRequest !== request || this.weatherIdentity !== identity || request.abort.signal.aborted) return;
        this.weather = weather;
        this.weatherCache.set(key, weather);
        this.render();
      } catch {
        if (this.weatherRequest !== request || this.weatherIdentity !== identity || request.abort.signal.aborted) return;
        this.weather = previousWeather;
        this.render();
      } finally {
        if (this.weatherRequest === request) this.weatherRequest = undefined;
      }
    })();
    return request.promise;
  }

  private createWeatherIdentity(plan: FlightPlan): string {
    return JSON.stringify({
      route: plan.points.map(point => [
        point.ident,
        point.position[0],
        point.position[1],
        point.plannedAltitudeFeet ?? null,
        point.constraintKind ?? null,
        point.minimumAltitudeFeet ?? null,
        point.maximumAltitudeFeet ?? null
      ]),
      departureTimeUtc: plan.departureTimeUtc ?? null,
      estimatedEnrouteSeconds: plan.estimatedEnrouteSeconds ?? null
    });
  }

  private buildWeatherRequest(plan: FlightPlan): {
    route: Array<{
      ident: string;
      longitude: number;
      latitude: number;
      plannedAltitudeFeet: number | null;
      critical: boolean;
    }>;
    currentDistanceNm?: number;
    groundSpeedKnots?: number;
    departureTimeUtc?: string;
    estimatedEnrouteSeconds?: number;
  } {
    const selected = sampleWeatherPoints(plan.points, 200);
    const route = selected.map(({ point, index }) => ({
      ident: point.ident,
      longitude: point.position[0],
      latitude: point.position[1],
      plannedAltitudeFeet: Number.isFinite(point.plannedAltitudeFeet)
        ? point.plannedAltitudeFeet!
        : null,
      critical: isWeatherCriticalPoint(plan.points, index)
    }));
    const validTelemetry = hasFreshProfileTelemetry(this.telemetry) && this.telemetry &&
      Number.isFinite(this.telemetry.latitude) && Number.isFinite(this.telemetry.longitude);
    const projection = validTelemetry
      ? projectPositionOntoRoute(plan.points, [this.telemetry!.longitude, this.telemetry!.latitude])
      : undefined;
    const speed = validTelemetry && Number.isFinite(this.telemetry!.groundSpeedKnots) &&
      this.telemetry!.groundSpeedKnots >= 50 && this.telemetry!.groundSpeedKnots <= 750
      ? this.telemetry!.groundSpeedKnots
      : undefined;
    return {
      route,
      ...(projection ? { currentDistanceNm: projection.distanceNm } : {}),
      ...(speed !== undefined ? { groundSpeedKnots: speed } : {}),
      ...(plan.departureTimeUtc ? { departureTimeUtc: plan.departureTimeUtc } : {}),
      ...(plan.estimatedEnrouteSeconds !== undefined
        ? { estimatedEnrouteSeconds: plan.estimatedEnrouteSeconds }
        : {})
    };
  }

  private coversRequestedWindow(weather: WeatherProfileResponse, currentDistanceNm: number): boolean {
    if (!this.plan) return false;
    const total = this.plan.distance > 0 ? this.plan.distance : Number.POSITIVE_INFINITY;
    const desiredEnd = Math.min(total, currentDistanceNm + 500);
    return weather.startDistanceNm <= currentDistanceNm + 1 && weather.endDistanceNm >= desiredEnd - 1;
  }

  private render(): void {
    this.view.render(this.plan ? buildVerticalProfileModel({
      flightPlan: this.plan,
      elevationProfile: this.terrain ?? unavailableTerrain,
      telemetry: this.telemetry,
      weatherProfile: this.weather
    }) : null, this.state);
  }
}

function sampleWeatherPoints(
  points: FlightPlan['points'],
  maximum: number
): Array<{ point: FlightPlan['points'][number]; index: number }> {
  if (points.length <= maximum) return points.map((point, index) => ({ point, index }));
  const critical = points.map((_, index) => index)
    .filter(index => isWeatherCriticalPoint(points, index));
  const selected = new Set<number>();
  if (critical.length >= maximum) {
    for (let slot = 0; slot < maximum; slot++) {
      selected.add(critical[Math.round(slot * (critical.length - 1) / (maximum - 1))]!);
    }
  } else {
    critical.forEach(index => selected.add(index));
    const ordinary = points.map((_, index) => index).filter(index => !selected.has(index));
    const remaining = maximum - selected.size;
    for (let slot = 0; slot < remaining; slot++) {
      const candidate = remaining === 1
        ? ordinary[Math.floor(ordinary.length / 2)]
        : ordinary[Math.round(slot * (ordinary.length - 1) / (remaining - 1))];
      if (candidate !== undefined) selected.add(candidate);
    }
  }
  return [...selected].sort((left, right) => left - right)
    .map(index => ({ point: points[index]!, index }));
}

function isWeatherCriticalPoint(points: FlightPlan['points'], index: number): boolean {
  const point = points[index]!;
  if (index === 0 || index === points.length - 1) return true;
  if (point.constraintKind !== undefined || point.minimumAltitudeFeet !== undefined ||
      point.maximumAltitudeFeet !== undefined) return true;
  if (!Number.isFinite(point.plannedAltitudeFeet)) return false;
  return !Number.isFinite(points[index - 1]?.plannedAltitudeFeet) ||
    point.plannedAltitudeFeet !== points[index - 1]?.plannedAltitudeFeet;
}
