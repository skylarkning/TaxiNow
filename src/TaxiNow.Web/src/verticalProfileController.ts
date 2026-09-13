import type { ElevationProfileResponse, TelemetrySnapshot } from './contracts';
import type { FlightPlan } from './flightPlan';
import { buildVerticalProfileModel } from './verticalProfile';
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
  private routeHash: string | undefined;
  private terrain: ElevationProfileResponse | undefined;
  private readonly terrainCache = new Map<string, ElevationProfileResponse>();
  private request: { abort: AbortController; promise: Promise<void> } | undefined;
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
    if (!plan) {
      this.state = { status: 'empty' };
      this.render();
      return Promise.resolve();
    }
    if (this.terrain) {
      this.state = { status: 'ready' };
      this.render();
      return Promise.resolve();
    }
    if (this.request) {
      this.render();
      return this.request.promise;
    }
    return this.loadTerrain();
  }

  setTelemetry(sample: TelemetrySnapshot): void {
    this.telemetry = sample;
    this.render();
  }

  retry(): Promise<void> {
    return this.plan ? this.setPlan(this.plan) : Promise.resolve();
  }

  setOpen(open: boolean): void {
    // setOpen on the view emits a synchronous event. Mode-driven hiding must
    // not be interpreted as the user choosing to close the profile.
    if (this.applyingOpen) return;
    this.openPreference = open;
    this.options.preferenceStore?.save(open);
    this.applyOpen();
  }

  setMapView(mapView: 'globe' | 'ground'): void {
    this.mapView = mapView;
    this.applyOpen();
  }

  private applyOpen(): void {
    const open = this.mapView === 'globe' && this.openPreference;
    this.applyingOpen = true;
    try { this.view.setOpen(open); }
    finally { this.applyingOpen = false; }
    this.options.onOpenChange?.(open);
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

  private render(): void {
    this.view.render(this.plan ? buildVerticalProfileModel({
      flightPlan: this.plan, elevationProfile: this.terrain ?? unavailableTerrain, telemetry: this.telemetry
    }) : null, this.state);
  }
}
