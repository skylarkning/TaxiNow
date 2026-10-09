import { describe, expect, it, vi } from 'vitest';
import type { ElevationProfileResponse, TelemetrySnapshot, WeatherProfileResponse } from './contracts';
import { distanceNm, type FlightPlan } from './flightPlan';
import type { VerticalProfileModel } from './verticalProfile';
import type { VerticalProfileView, VerticalProfileViewState } from './verticalProfileView';
import { VerticalProfileController } from './verticalProfileController';
import * as verticalProfileControllerModule from './verticalProfileController';
import * as flightPlanGround from './flightPlanGround';

function plan(longitude = 1): FlightPlan {
  return {
    origin: 'KAAA', destination: longitude === 1 ? 'KBBB' : 'KCCC',
    originName: 'Alpha', destinationName: 'Arrival', callsign: 'TEST1', aircraft: 'A320',
    altitude: '10000', route: 'DCT', distance: 60, importedAt: '2026-09-12T00:00:00Z',
    points: [{ ident: 'KAAA', position: [0, 0], airway: '' },
      { ident: 'END', position: [longitude, 0], airway: '' }]
  };
}
function terrain(elevationFeet = 500, cacheState: ElevationProfileResponse['cacheState'] = 'fresh'): ElevationProfileResponse {
  return {
    samples: [{ longitude: 0, latitude: 0, distanceNm: 0, elevationFeet },
      { longitude: 1, latitude: 0, distanceNm: 60, elevationFeet }],
    cacheState, generatedAt: '2026-09-12T00:00:00Z', source: 'Open-Meteo', attribution: 'Copernicus DEM'
  };
}
function telemetry(overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sequence: 1, simulator: 'replay', connected: true, onGround: false, latitude: 0, longitude: 0.5,
    trueHeadingDegrees: 90, groundSpeedKnots: 200, sourceTimestampUtc: new Date().toISOString(),
    serverTimestampUtc: new Date().toISOString(), sourceMonotonicMilliseconds: 1,
    hasPosition: true, isStale: false, altitudeMslFeet: 5000, altitudeAglFeet: 4500, state: 'airborne',
    ...overrides
  };
}
function weather(overrides: Partial<WeatherProfileResponse> = {}): WeatherProfileResponse {
  return {
    startDistanceNm: 0, endDistanceNm: 500,
    generatedAt: '2026-10-06T00:00:00Z', validFrom: '2026-10-06T00:00:00Z', validTo: '2026-10-06T02:00:00Z',
    etaBasis: 'scheduled', cacheState: 'fresh',
    bands: [{
      id: 'cloud-0', kind: 'cloud', intensity: 'moderate', pathRelation: 'onPath', confidence: 'high', valueKind: 'forecast', source: 'Open-Meteo',
      columns: [{ longitude: 0, latitude: 0, distanceNm: 0, validAt: '2026-10-06T00:00:00Z', originalBaseFeet: 1000, originalTopFeet: 10000, baseFeet: 1000, topFeet: 10000, plannedAltitudeFeet: 10000 }]
    }],
    sources: [{ name: 'Open-Meteo', attribution: 'Weather: Open-Meteo', generatedAt: '2026-10-06T00:00:00Z', validFrom: null, validTo: null }],
    warnings: [],
    ...overrides
  };
}
function harness(initialOpen = true, preferenceStore?: unknown, recordWeather = false) {
  let model: VerticalProfileModel | null = null;
  let state: VerticalProfileViewState | undefined;
  let open = initialOpen;
  const requests: Array<{ url: string; init: RequestInit; resolve: (response: Response) => void }> = [];
  const openings: boolean[] = [];
  const view: VerticalProfileView = {
    render(next, nextState) { model = next; state = nextState; },
    setOpen(next) { open = next; controller.setOpen(next); },
    resize() {}, destroy() {}
  };
  const controller = new VerticalProfileController(view, {
    initialOpen,
    fetch: (url, init) => {
      if (!recordWeather && String(url) === '/api/v1/weather/profile') {
        return Promise.resolve(new Response('', { status: 404 }));
      }
      return new Promise<Response>(resolve => requests.push({ url: String(url), init: init!, resolve }));
    },
    onOpenChange: next => openings.push(next),
    ...(preferenceStore ? { preferenceStore } : {})
  } as ConstructorParameters<typeof VerticalProfileController>[1]);
  controller.setMapView('globe');
  return { controller, requests, openings, get model() { return model; }, get state() { return state; }, get open() { return open; } };
}

describe('VerticalProfileController', () => {
  it('loads terrain and weather independently and renders whichever arrives first', async () => {
    const h = harness(true, undefined, true);
    const pending = h.controller.setPlan({
      ...plan(), departureTimeUtc: '2026-10-06T00:00:00Z', estimatedEnrouteSeconds: 3600
    });
    expect(h.requests.map(request => request.url).sort()).toEqual([
      '/api/v1/elevation/profile', '/api/v1/weather/profile'
    ]);
    const weatherRequest = h.requests.find(request => request.url.includes('/weather/'))!;
    const terrainRequest = h.requests.find(request => request.url.includes('/elevation/'))!;

    weatherRequest.resolve(Response.json(weather()));
    await vi.waitFor(() => expect(h.model?.weatherBands).toHaveLength(1));
    expect(h.model?.terrain).toEqual([]);
    expect(h.state?.status).toBe('loading');

    terrainRequest.resolve(Response.json(terrain()));
    await pending;
    expect(h.model?.terrain).toHaveLength(2);
    expect(h.model?.weatherBands).toHaveLength(1);
    expect(h.state?.status).toBe('ready');
  });

  it('sends bounded route altitude, critical, live position, speed, and timing fields', async () => {
    const h = harness(true, undefined, true);
    h.controller.setTelemetry(telemetry({ groundSpeedKnots: 430 }));
    const pending = h.controller.setPlan({
      ...plan(), departureTimeUtc: '2026-10-06T00:00:00Z', estimatedEnrouteSeconds: 3600,
      points: [
        { ident: 'KAAA', position: [0, 0], airway: '', plannedAltitudeFeet: 1000 },
        { ident: 'STEP', position: [0.5, 0], airway: '', plannedAltitudeFeet: 10000, constraintKind: 'atOrAbove', minimumAltitudeFeet: 9000 },
        { ident: 'KBBB', position: [1, 0], airway: '', plannedAltitudeFeet: 2000 }
      ]
    });
    const weatherRequest = h.requests.find(request => request.url.includes('/weather/'))!;
    const body = JSON.parse(weatherRequest.init.body as string);

    expect(body.route).toEqual([
      { ident: 'KAAA', longitude: 0, latitude: 0, plannedAltitudeFeet: 1000, critical: true },
      { ident: 'STEP', longitude: 0.5, latitude: 0, plannedAltitudeFeet: 10000, critical: true },
      { ident: 'KBBB', longitude: 1, latitude: 0, plannedAltitudeFeet: 2000, critical: true }
    ]);
    expect(body.currentDistanceNm).toBeCloseTo(30, 0);
    expect(body.groundSpeedKnots).toBe(430);
    expect(body.departureTimeUtc).toBe('2026-10-06T00:00:00Z');
    expect(body.estimatedEnrouteSeconds).toBe(3600);
    h.requests.find(request => request.url.includes('/elevation/'))!.resolve(Response.json(terrain()));
    weatherRequest.resolve(Response.json(weather()));
    await pending;
  });

  it('defers weather while closed, starts it on open, and aborts it on close', async () => {
    const h = harness(false, undefined, true);
    const terrainPending = h.controller.setPlan(plan());
    expect(h.requests.map(request => request.url)).toEqual(['/api/v1/elevation/profile']);
    h.requests[0]!.resolve(Response.json(terrain()));
    await terrainPending;

    h.controller.setOpen(true);
    const weatherRequest = h.requests.find(request => request.url.includes('/weather/'))!;
    expect(weatherRequest).toBeDefined();
    h.controller.setOpen(false);
    expect((weatherRequest.init.signal as AbortSignal).aborted).toBe(true);
    weatherRequest.resolve(Response.json(weather()));
    await Promise.resolve(); await Promise.resolve();
    expect(h.model?.weatherBands).toEqual([]);
  });

  it('aborts superseded weather and stale responses cannot replace the new route', async () => {
    const h = harness(true, undefined, true);
    const older = h.controller.setPlan(plan());
    const oldWeather = h.requests.find(request => request.url.includes('/weather/'))!;
    const oldTerrain = h.requests.find(request => request.url.includes('/elevation/'))!;
    const newer = h.controller.setPlan(plan(2));
    expect((oldWeather.init.signal as AbortSignal).aborted).toBe(true);
    const newWeather = h.requests.filter(request => request.url.includes('/weather/')).at(-1)!;
    const newTerrain = h.requests.filter(request => request.url.includes('/elevation/')).at(-1)!;
    newWeather.resolve(Response.json(weather({ bands: [] })));
    newTerrain.resolve(Response.json(terrain(900)));
    await newer;
    oldWeather.resolve(Response.json(weather()));
    oldTerrain.resolve(Response.json(terrain(100)));
    await older;
    expect(h.model?.destination).toBe('KCCC');
    expect(h.model?.weatherBands).toEqual([]);
  });

  it('weather failure keeps terrain and retry requests only the missing source', async () => {
    const h = harness(true, undefined, true);
    const first = h.controller.setPlan(plan());
    h.requests.find(request => request.url.includes('/elevation/'))!.resolve(Response.json(terrain()));
    h.requests.find(request => request.url.includes('/weather/'))!.resolve(new Response('', { status: 503 }));
    await first;
    expect(h.model?.terrain).toHaveLength(2);
    expect(h.model?.weatherBands).toEqual([]);
    expect(h.state?.status).toBe('ready');

    const retry = h.controller.retry();
    const retried = h.requests.slice(2);
    expect(retried).toHaveLength(1);
    expect(retried[0]!.url).toBe('/api/v1/weather/profile');
    retried[0]!.resolve(Response.json(weather()));
    await retry;
    expect(h.model?.weatherBands).toHaveLength(1);
  });

  it('keeps stale weather visible when its refresh fails', async () => {
    const h = harness(true, undefined, true);
    const first = h.controller.setPlan(plan());
    h.requests.find(request => request.url.includes('/elevation/'))!.resolve(Response.json(terrain()));
    h.requests.find(request => request.url.includes('/weather/'))!.resolve(Response.json(weather({ cacheState: 'stale' })));
    await first;
    expect(h.model?.weatherBands).toHaveLength(1);

    const refresh = h.controller.retry();
    h.requests.filter(request => request.url.includes('/weather/')).at(-1)!
      .resolve(new Response('', { status: 503 }));
    await refresh;

    expect(h.model?.weatherBands).toHaveLength(1);
    expect(h.model?.weatherCacheState).toBe('stale');
  });

  it('suppresses weather requests for the session after a feature-disabled 404', async () => {
    const h = harness(true, undefined, true);
    const first = h.controller.setPlan(plan());
    h.requests.find(request => request.url.includes('/elevation/'))!.resolve(Response.json(terrain()));
    h.requests.find(request => request.url.includes('/weather/'))!.resolve(new Response('', { status: 404 }));
    await first;
    const second = h.controller.setPlan(plan(2));
    const latestTerrain = h.requests.filter(request => request.url.includes('/elevation/')).at(-1)!;
    latestTerrain.resolve(Response.json(terrain()));
    await second;
    expect(h.requests.filter(request => request.url.includes('/weather/'))).toHaveLength(1);
  });

  it('reuses identical route and time-bucket weather after visiting another route', async () => {
    const h = harness(true, undefined, true);
    const first = h.controller.setPlan({ ...plan(), departureTimeUtc: '2026-10-06T00:00:00Z' });
    h.requests.find(request => request.url.includes('/elevation/'))!.resolve(Response.json(terrain()));
    h.requests.find(request => request.url.includes('/weather/'))!.resolve(Response.json(weather()));
    await first;

    const second = h.controller.setPlan({ ...plan(2), departureTimeUtc: '2026-10-06T00:00:00Z' });
    h.requests.filter(request => request.url.includes('/elevation/')).at(-1)!.resolve(Response.json(terrain(900)));
    h.requests.filter(request => request.url.includes('/weather/')).at(-1)!.resolve(Response.json(weather({ bands: [] })));
    await second;

    await h.controller.setPlan({ ...plan(), departureTimeUtc: '2026-10-06T00:00:00Z' });
    expect(h.requests.filter(request => request.url.includes('/weather/'))).toHaveLength(2);
    expect(h.model?.weatherBands).toHaveLength(1);
  });

  it('requests a new weather interval when the visible viewport leaves cached coverage', async () => {
    const h = harness(true, undefined, true);
    const longPlan = {
      ...plan(), distance: 1000,
      points: [
        { ident: 'START', position: [0, 0] as [number, number], airway: '' },
        { ident: 'END', position: [16, 0] as [number, number], airway: '' }
      ]
    };
    const first = h.controller.setPlan(longPlan);
    h.requests.find(request => request.url.includes('/elevation/'))!.resolve(Response.json(terrain()));
    h.requests.find(request => request.url.includes('/weather/'))!.resolve(Response.json(weather()));
    await first;

    h.controller.setViewport(600, 900);
    const weatherRequests = h.requests.filter(request => request.url.includes('/weather/'));
    expect(weatherRequests).toHaveLength(2);
    expect(JSON.parse(weatherRequests[1]!.init.body as string).currentDistanceNm).toBe(600);
    weatherRequests[1]!.resolve(Response.json(weather({ startDistanceNm: 600, endDistanceNm: 1000 })));
  });

  it('refreshes unscheduled weather when a speed change shifts ETA by five minutes or more', async () => {
    const h = harness(true, undefined, true);
    h.controller.setTelemetry(telemetry({ longitude: 0, groundSpeedKnots: 500 }));
    const first = h.controller.setPlan({ ...plan(), distance: 500 });
    h.requests.find(request => request.url.includes('/elevation/'))!.resolve(Response.json(terrain()));
    h.requests.find(request => request.url.includes('/weather/'))!.resolve(Response.json(weather()));
    await first;

    h.controller.setTelemetry(telemetry({ longitude: 0, groundSpeedKnots: 250 }));

    expect(h.requests.filter(request => request.url.includes('/weather/'))).toHaveLength(2);
  });

  it('limits the weather request route to two hundred points while preserving endpoints and critical changes', async () => {
    const h = harness(true, undefined, true);
    const points: FlightPlan['points'] = Array.from({ length: 450 }, (_, index) => ({
      ident: `P${index}`,
      position: [index / 1000, 0] as [number, number],
      airway: ''
    }));
    points[111]!.plannedAltitudeFeet = 10_000;
    points[112]!.plannedAltitudeFeet = 10_000;
    points[333]!.constraintKind = 'atOrAbove';
    points[333]!.minimumAltitudeFeet = 12_000;
    const pending = h.controller.setPlan({ ...plan(), points });
    const weatherRequest = h.requests.find(request => request.url.includes('/weather/'))!;
    const body = JSON.parse(weatherRequest.init.body as string);
    expect(body.route).toHaveLength(200);
    expect(body.route[0].ident).toBe('P0');
    expect(body.route.at(-1).ident).toBe('P449');
    expect(body.route.find((point: { ident: string }) => point.ident === 'P111')?.critical).toBe(true);
    expect(body.route.find((point: { ident: string }) => point.ident === 'P333')?.critical).toBe(true);
    h.requests.find(request => request.url.includes('/elevation/'))!.resolve(Response.json(terrain()));
    weatherRequest.resolve(Response.json(weather()));
    await pending;
  });

  it('projects current distance against the same downsampled route sent to weather', () => {
    const h = harness(true, undefined, true);
    const points: FlightPlan['points'] = Array.from({ length: 450 }, (_, index) => ({
      ident: `Z${index}`,
      position: [index / 100, index % 2 ? 1 : -1] as [number, number],
      airway: ''
    }));
    const last = points.at(-1)!;
    h.controller.setTelemetry(telemetry({ latitude: last.position[1], longitude: last.position[0] }));
    void h.controller.setPlan({ ...plan(), distance: 10_000, points });
    const request = h.requests.find(item => item.url.includes('/weather/'))!;
    const body = JSON.parse(request.init.body as string);
    const sentDistance = body.route.slice(1).reduce((total: number, point: { longitude: number; latitude: number }, index: number) =>
      total + distanceNm(
        [body.route[index].longitude, body.route[index].latitude],
        [point.longitude, point.latitude]), 0);

    expect(body.currentDistanceNm).toBeLessThanOrEqual(sentDistance + 1);
  });

  it('expires live altitude without another sample, retains terrain, and recovers on fresh telemetry', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      const loaded = h.controller.setPlan(plan());
      h.requests[0]!.resolve(Response.json(terrain()));
      await loaded;
      h.controller.setTelemetry(telemetry());
      expect(h.model?.metrics.currentAltitudeFeet).toBe(5000);
      vi.advanceTimersByTime(10_000);
      h.controller.setTelemetry(telemetry({ altitudeMslFeet: 6000 }));
      vi.advanceTimersByTime(5_000);
      expect(h.model?.metrics.currentAltitudeFeet).toBe(6000);
      vi.advanceTimersByTime(10_000);
      expect(h.model?.aircraft).toBeUndefined();
      expect(h.model?.metrics.currentAltitudeFeet).toBeNull();
      expect(h.model?.metrics.currentAglFeet).toBeNull();
      expect(h.model?.metrics.terrainClearanceFeet).toBeNull();
      expect(h.model?.terrain).toHaveLength(2);
      h.controller.setTelemetry(telemetry({ altitudeMslFeet: 7000 }));
      expect(h.model?.metrics.currentAltitudeFeet).toBe(7000);
      expect(h.requests).toHaveLength(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('renders plan-only loading immediately and sends one POST for overlapping identical routes', async () => {
    const h = harness();
    const first = h.controller.setPlan(plan());
    const duplicate = h.controller.setPlan({ ...plan(), altitude: '20000' });
    expect(h.state?.status).toBe('loading');
    expect(h.model?.terrain).toEqual([]);
    expect(h.model?.altitudePath.some(point => point.altitudeFeet === 20000)).toBe(true);
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]!.url).toBe('/api/v1/elevation/profile');
    expect(h.requests[0]!.init.method).toBe('POST');
    expect(JSON.parse(h.requests[0]!.init.body as string)).toEqual({
      route: [{ longitude: 0, latitude: 0 }, { longitude: 1, latitude: 0 }]
    });
    h.requests[0]!.resolve(Response.json(terrain()));
    await Promise.all([first, duplicate]);
    expect(h.state?.status).toBe('ready');
    expect(h.model?.terrain[0]?.elevationFeet).toBe(500);
    expect(h.model?.altitudePath.some(point => point.altitudeFeet === 20000)).toBe(true);
  });

  it('reuses a route result after another plan and preserves cachedOffline attribution', async () => {
    const h = harness();
    const first = h.controller.setPlan(plan());
    h.requests[0]!.resolve(Response.json(terrain(700, 'cachedOffline'))); await first;
    const second = h.controller.setPlan(plan(2));
    h.requests[1]!.resolve(Response.json(terrain(900))); await second;
    await h.controller.setPlan({ ...plan(), callsign: 'CHANGED' });
    expect(h.requests).toHaveLength(2);
    expect(h.model?.terrain[0]?.elevationFeet).toBe(700);
    expect(h.model?.source.cacheState).toBe('cachedOffline');
    expect(h.model?.metrics.sourceCacheBadge).toContain('Cached/offline');
  });

  it('keeps the newer imported plan when an older response completes despite abort', async () => {
    const h = harness();
    const older = h.controller.setPlan(plan());
    const newer = h.controller.setPlan(plan(2));
    expect((h.requests[0]!.init.signal as AbortSignal).aborted).toBe(true);
    h.requests[1]!.resolve(Response.json(terrain(900))); await newer;
    h.requests[0]!.resolve(Response.json(terrain(100))); await older;
    expect(h.model?.destination).toBe('KCCC');
    expect(h.model?.terrain[0]?.elevationFeet).toBe(900);
    expect(h.state?.status).toBe('ready');
  });

  it('clears pending work and cannot resurrect a cleared plan', async () => {
    const h = harness();
    const pending = h.controller.setPlan(plan());
    await h.controller.setPlan(undefined);
    expect((h.requests[0]!.init.signal as AbortSignal).aborted).toBe(true);
    h.requests[0]!.resolve(Response.json(terrain())); await pending;
    expect(h.model).toBeNull();
    expect(h.state?.status).toBe('empty');
  });

  it('clears through the shared flight-deck action before callers refresh their UI', async () => {
    const h = harness();
    const pending = h.controller.setPlan(plan());
    const clearFlightPlanState = (flightPlanGround as unknown as {
      clearFlightPlanState?: (
        target: Pick<VerticalProfileController, 'setPlan'>
      ) => undefined;
    }).clearFlightPlanState;

    expect(clearFlightPlanState).toBeTypeOf('function');
    const cleared = clearFlightPlanState!(h.controller);
    expect(cleared).toBeUndefined();
    expect((h.requests[0]!.init.signal as AbortSignal).aborted).toBe(true);
    expect(h.model).toBeNull();
    expect(h.state?.status).toBe('empty');

    h.requests[0]!.resolve(Response.json(terrain()));
    await pending;
    expect(h.model).toBeNull();
    expect(h.state?.status).toBe('empty');
  });

  it('retains plan-only data on failure and retries the same route', async () => {
    const h = harness();
    const pending = h.controller.setPlan(plan());
    h.requests[0]!.resolve(new Response('', { status: 503 })); await pending;
    expect(h.state?.status).toBe('error');
    expect(h.model?.origin).toBe('KAAA');
    expect(h.model?.terrain).toEqual([]);
    const retry = h.controller.retry();
    expect(h.state?.status).toBe('loading');
    h.requests[1]!.resolve(Response.json(terrain())); await retry;
    expect(h.state?.status).toBe('ready');
    expect(h.model?.terrain[0]?.elevationFeet).toBe(500);
  });

  it('forwards live and invalid telemetry without requesting terrain again', async () => {
    const h = harness();
    const pending = h.controller.setPlan(plan());
    h.requests[0]!.resolve(Response.json(terrain())); await pending;
    h.controller.setTelemetry(telemetry());
    expect(h.model?.metrics.currentAltitudeFeet).toBe(5000);
    expect(h.model?.metrics.terrainClearanceFeet).toBe(4500);
    for (const invalid of [{ isStale: true }, { connected: false }, { hasPosition: false }]) {
      h.controller.setTelemetry(telemetry(invalid));
      expect(h.model?.aircraft).toBeUndefined();
      expect(h.model?.metrics.currentAltitudeFeet).toBeNull();
    }
    expect(h.requests).toHaveLength(1);
  });

  it('preserves the open preference through TAXI and handles view-driven closure without recursion', () => {
    const h = harness();
    h.controller.setMapView('ground'); expect(h.open).toBe(false);
    h.controller.setMapView('globe'); expect(h.open).toBe(true);
    h.controller.setOpen(false); expect(h.open).toBe(false);
    h.controller.setMapView('ground'); h.controller.setMapView('globe');
    expect(h.open).toBe(false);
    h.controller.setOpen(true); expect(h.open).toBe(true);
    expect(h.openings).toContain(false);
    expect(h.openings).toContain(true);
  });

  it('keeps the initial mobile preference closed until explicitly opened', () => {
    const h = harness(false);
    h.controller.setMapView('ground'); h.controller.setMapView('globe');
    expect(h.open).toBe(false);
    h.controller.setOpen(true); expect(h.open).toBe(true);
  });

  it('restores and persists only explicit session choices while storage failures use memory', () => {
    const createPreference = (verticalProfileControllerModule as unknown as {
      createSessionProfileOpenPreference?: (storage?: Pick<Storage, 'getItem' | 'setItem'>) => unknown;
    }).createSessionProfileOpenPreference;
    expect(createPreference).toBeTypeOf('function');

    const storage = { getItem: vi.fn(() => 'false'), setItem: vi.fn() };
    const restored = harness(true, createPreference!(storage));
    expect(restored.open).toBe(false);
    restored.controller.setMapView('ground');
    restored.controller.setMapView('globe');
    expect(storage.setItem).not.toHaveBeenCalled();
    restored.controller.setOpen(true);
    expect(restored.open).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith('taxinow.map.profileOpen', 'true');

    const brokenStorage = {
      getItem: vi.fn(() => { throw new Error('blocked'); }),
      setItem: vi.fn(() => { throw new Error('blocked'); })
    };
    const fallback = harness(false, createPreference!(brokenStorage));
    expect(fallback.open).toBe(false);
    expect(() => fallback.controller.setOpen(true)).not.toThrow();
    expect(fallback.open).toBe(true);
  });
});
