import { describe, expect, it } from 'vitest';
import type { ElevationProfileResponse, TelemetrySnapshot } from './contracts';
import type { FlightPlan } from './flightPlan';
import type { VerticalProfileModel } from './verticalProfile';
import type { VerticalProfileView, VerticalProfileViewState } from './verticalProfileView';
import { VerticalProfileController } from './verticalProfileController';

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
    trueHeadingDegrees: 90, groundSpeedKnots: 200, sourceTimestampUtc: '2026-09-12T00:00:00Z',
    serverTimestampUtc: '2026-09-12T00:00:00Z', sourceMonotonicMilliseconds: 1,
    hasPosition: true, isStale: false, altitudeMslFeet: 5000, altitudeAglFeet: 4500, state: 'airborne',
    ...overrides
  };
}
function harness(initialOpen = true) {
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
    fetch: (url, init) => new Promise<Response>(resolve => requests.push({ url: String(url), init: init!, resolve })),
    onOpenChange: next => openings.push(next)
  });
  return { controller, requests, openings, get model() { return model; }, get state() { return state; }, get open() { return open; } };
}

describe('VerticalProfileController', () => {
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
});
