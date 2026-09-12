import { describe, expect, it } from 'vitest';
import type { ElevationProfileResponse, TelemetrySnapshot } from './contracts';
import type { FlightPlan, FlightPoint } from './flightPlan';
import {
  buildVerticalProfileModel,
  projectPositionOntoRoute,
  terrainClearanceBand
} from './verticalProfile';

const nmLongitude = 100 / 60.0405;

function plan(points: FlightPoint[], overrides: Partial<FlightPlan> = {}): FlightPlan {
  return {
    origin: 'KAAA',
    destination: 'KBBB',
    originName: 'Alpha',
    destinationName: 'Bravo',
    callsign: 'TEST1',
    aircraft: 'A320',
    altitude: '10000',
    route: 'DCT',
    points,
    distance: 0,
    importedAt: '2026-09-12T00:00:00Z',
    ...overrides
  };
}

function terrain(samples: ElevationProfileResponse['samples'], cacheState: ElevationProfileResponse['cacheState'] = 'fresh'): ElevationProfileResponse {
  return {
    samples,
    cacheState,
    generatedAt: '2026-09-12T00:00:00Z',
    source: 'Open-Meteo',
    attribution: 'Open-Meteo and Copernicus DEM'
  };
}

function telemetry(overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sequence: 1,
    simulator: 'replay',
    connected: true,
    onGround: false,
    latitude: 0,
    longitude: nmLongitude / 2,
    trueHeadingDegrees: 90,
    groundSpeedKnots: 200,
    sourceTimestampUtc: '2026-09-12T00:00:00Z',
    serverTimestampUtc: '2026-09-12T00:00:00Z',
    sourceMonotonicMilliseconds: 1,
    hasPosition: true,
    isStale: false,
    altitudeMslFeet: 5000,
    altitudeAglFeet: 4000,
    state: 'airborne',
    ...overrides
  };
}

describe('route projection', () => {
  it('projects halfway along a 100 NM leg near 50 NM', () => {
    const projection = projectPositionOntoRoute([
      { ident: 'A', position: [0, 0], airway: '' },
      { ident: 'B', position: [nmLongitude, 0], airway: '' }
    ], [nmLongitude / 2, 0]);

    expect(projection?.legIndex).toBe(0);
    expect(projection?.fraction).toBeCloseTo(0.5, 5);
    expect(projection?.distanceNm).toBeCloseTo(50, 0);
    expect(projection?.crossTrackDistanceNm).toBeCloseTo(0, 5);
  });

  it('selects the nearest route leg rather than the nearest route endpoint', () => {
    const projection = projectPositionOntoRoute([
      { ident: 'A', position: [0, 0], airway: '' },
      { ident: 'B', position: [2, 0], airway: '' },
      { ident: 'C', position: [2, 2], airway: '' }
    ], [2.1, 1]);

    expect(projection?.legIndex).toBe(1);
    expect(projection?.fraction).toBeCloseTo(0.5, 2);
  });

  it('uses the short longitude delta across the anti-meridian', () => {
    const projection = projectPositionOntoRoute([
      { ident: 'A', position: [179, 0], airway: '' },
      { ident: 'B', position: [-179, 0], airway: '' }
    ], [-180, 0]);

    expect(projection?.fraction).toBeCloseTo(0.5, 5);
    expect(projection?.distanceNm).toBeCloseTo(60, 0);
    expect(projection?.crossTrackDistanceNm).toBeCloseTo(0, 5);
  });
});

describe('vertical profile normalization', () => {
  it('emits cumulative route distance and preserves exact altitudes and constraints', () => {
    const flightPlan = plan([
      { ident: 'A', position: [0, 0], airway: '', plannedAltitudeFeet: 1000 },
      {
        ident: 'B', position: [nmLongitude, 0], airway: '', plannedAltitudeFeet: 9000,
        constraintKind: 'atOrAbove', minimumAltitudeFeet: 8000
      },
      { ident: 'C', position: [2 * nmLongitude, 0], airway: '', plannedAltitudeFeet: 1200 }
    ]);
    const model = buildVerticalProfileModel({
      flightPlan,
      elevationProfile: terrain([
        { longitude: 0, latitude: 0, distanceNm: 0, elevationFeet: 500 },
        { longitude: nmLongitude, latitude: 0, distanceNm: 100, elevationFeet: 1000 },
        { longitude: 2 * nmLongitude, latitude: 0, distanceNm: 200, elevationFeet: 700 }
      ])
    });

    expect(model.routePoints.map(point => point.distanceNm)).toEqual([
      0,
      expect.closeTo(100, 0),
      expect.closeTo(200, 0)
    ]);
    expect(model.altitudePath).toHaveLength(3);
    expect(model.altitudePath.filter(point => point.waypointIndex !== null)).toMatchObject([
      { distanceNm: 0, altitudeFeet: 1000, estimated: false, waypointIndex: 0 },
      { altitudeFeet: 9000, estimated: false, waypointIndex: 1 },
      { altitudeFeet: 1200, estimated: false, waypointIndex: 2 }
    ]);
    expect(model.constraints).toEqual([{
      ident: 'B',
      distanceNm: expect.closeTo(100, 0),
      kind: 'atOrAbove',
      minimumAltitudeFeet: 8000,
      maximumAltitudeFeet: undefined,
      waypointIndex: 1
    }]);
  });

  it('creates an explicitly estimated climb-cruise-descent path without constraints', () => {
    const flightPlan = plan([
      { ident: 'A', position: [0, 0], airway: '' },
      { ident: 'C', position: [2 * nmLongitude, 0], airway: '' }
    ], { originElevationFeet: 500, destinationElevationFeet: 1000, altitude: '10000' });
    const model = buildVerticalProfileModel({
      flightPlan,
      elevationProfile: terrain([
        { longitude: 0, latitude: 0, distanceNm: 0, elevationFeet: 450 },
        { longitude: 2 * nmLongitude, latitude: 0, distanceNm: 200, elevationFeet: 900 }
      ])
    });

    expect(model.altitudePath).toMatchObject([
      { distanceNm: 0, altitudeFeet: 500, estimated: true },
      { distanceNm: expect.closeTo(40, 2), altitudeFeet: 10000, estimated: true },
      { distanceNm: expect.closeTo(140, 2), altitudeFeet: 10000, estimated: true },
      { distanceNm: expect.closeTo(200, 2), altitudeFeet: expect.closeTo(1000, 5), estimated: true }
    ]);
    expect(model.altitudePath.every(point => point.estimated)).toBe(true);
    expect(model.constraints).toEqual([]);
  });

  it('retains terrain source and offline cache state for the display badge', () => {
    const model = buildVerticalProfileModel({
      flightPlan: plan([
        { ident: 'A', position: [0, 0], airway: '' },
        { ident: 'B', position: [1, 0], airway: '' }
      ]),
      elevationProfile: terrain([
        { longitude: 0, latitude: 0, distanceNm: 0, elevationFeet: 0 },
        { longitude: 1, latitude: 0, distanceNm: 60, elevationFeet: 0 }
      ], 'cachedOffline')
    });

    expect(model.source).toEqual({
      name: 'Open-Meteo',
      cacheState: 'cachedOffline',
      generatedAt: '2026-09-12T00:00:00Z',
      attribution: 'Open-Meteo and Copernicus DEM'
    });
    expect(model.metrics.sourceCacheBadge).toBe('Open-Meteo · Cached/offline');
  });
});

describe('live marker and advisory metrics', () => {
  const flightPlan = plan([
    { ident: 'A', position: [0, 0], airway: '', plannedAltitudeFeet: 5000 },
    {
      ident: 'B', position: [nmLongitude, 0], airway: '', plannedAltitudeFeet: 5000,
      constraintKind: 'atOrBelow', maximumAltitudeFeet: 6000
    }
  ]);
  const elevationProfile = terrain([
    { longitude: 0, latitude: 0, distanceNm: 0, elevationFeet: 500 },
    { longitude: nmLongitude, latitude: 0, distanceNm: 100, elevationFeet: 1500 }
  ]);

  it('interpolates terrain under a valid live aircraft and emits display metrics', () => {
    const model = buildVerticalProfileModel({ flightPlan, elevationProfile, telemetry: telemetry() });

    expect(model.aircraft).toMatchObject({
      distanceNm: expect.closeTo(50, 0),
      altitudeMslFeet: 5000,
      altitudeAglFeet: 4000,
      terrainElevationFeet: expect.closeTo(1000, 2),
      clearanceFeet: expect.closeTo(4000, 2),
      clearanceBand: 'normal'
    });
    expect(model.metrics).toMatchObject({
      currentAltitudeFeet: 5000,
      currentAglFeet: 4000,
      terrainClearanceFeet: expect.closeTo(4000, 2),
      distanceRemainingNm: expect.closeTo(50, 0),
      nextRestriction: { ident: 'B', kind: 'atOrBelow' }
    });
    expect(model.accessibilitySummary).toContain('KAAA to KBBB');
    expect(model.accessibilitySummary).toContain('5,000 feet MSL');
    expect(model.accessibilitySummary).toContain('simulation advisory');
  });

  it.each([
    ['disconnected', { connected: false }],
    ['missing position', { hasPosition: false }],
    ['stale', { isStale: true }],
    ['invalid altitude', { altitudeMslFeet: Number.NaN }]
  ])('omits the live aircraft marker for %s telemetry', (_name, override) => {
    const model = buildVerticalProfileModel({
      flightPlan,
      elevationProfile,
      telemetry: telemetry(override)
    });

    expect(model.aircraft).toBeUndefined();
    expect(model.metrics.currentAltitudeFeet).toBeNull();
  });

  it('keeps an on-ground marker but suppresses live amber and red advisory bands', () => {
    const model = buildVerticalProfileModel({
      flightPlan,
      elevationProfile,
      telemetry: telemetry({ onGround: true, altitudeMslFeet: 1600, altitudeAglFeet: 100 })
    });

    expect(model.aircraft?.clearanceFeet).toBeCloseTo(600, 0);
    expect(model.aircraft?.clearanceBand).toBe('normal');
  });
});

describe('terrain clearance bands', () => {
  it('uses the required airborne thresholds and suppresses warnings on the ground', () => {
    expect(terrainClearanceBand(2500, true)).toBe('normal');
    expect(terrainClearanceBand(2000, true)).toBe('amber');
    expect(terrainClearanceBand(1500, true)).toBe('amber');
    expect(terrainClearanceBand(1000, true)).toBe('red');
    expect(terrainClearanceBand(500, true)).toBe('red');
    expect(terrainClearanceBand(500, false)).toBe('normal');
  });
});
