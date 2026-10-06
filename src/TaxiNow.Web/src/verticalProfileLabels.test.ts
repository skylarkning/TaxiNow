import { describe, expect, it } from 'vitest';
import type { VerticalProfileModel } from './verticalProfile';
import { classifyVerticalProfilePoints, layoutVerticalProfileLabels } from './verticalProfileLabels';
import { createProfileViewport, zoomProfileViewport } from './verticalProfileViewport';

function model(distances: number[], altitudes: number[], aircraftDistance = 0): VerticalProfileModel {
  const routePoints = distances.map((distanceNm, waypointIndex) => ({
    ident: waypointIndex === 2 ? 'A-VERY-LONG-WAYPOINT-NAME' : `W${waypointIndex}`,
    position: [distanceNm / 60, 0] as [number, number],
    distanceNm,
    waypointIndex
  }));
  return {
    origin: 'W0', destination: `W${distances.length - 1}`,
    totalDistanceNm: distances.at(-1) ?? 0,
    routePoints,
    altitudePath: distances.map((distanceNm, waypointIndex) => ({
      distanceNm, altitudeFeet: altitudes[waypointIndex]!, estimated: false, waypointIndex
    })),
    constraints: distances.length > 3 ? [{
      ident: routePoints[3]!.ident,
      distanceNm: distances[3]!,
      kind: 'atOrAbove',
      minimumAltitudeFeet: altitudes[3],
      maximumAltitudeFeet: undefined,
      waypointIndex: 3
    }] : [],
    terrain: [],
    aircraft: {
      distanceNm: aircraftDistance,
      crossTrackDistanceNm: 0,
      altitudeMslFeet: 10_000,
      altitudeAglFeet: 9_000,
      terrainElevationFeet: 1_000,
      clearanceFeet: 9_000,
      clearanceBand: 'normal'
    },
    weatherBands: [], weatherWarnings: [], weatherSourceSummary: '',
    source: { name: 'Terrain', cacheState: 'fresh', generatedAt: '', attribution: '' },
    metrics: {
      currentAltitudeFeet: 10_000, currentAglFeet: 9_000,
      terrainClearanceFeet: 9_000, nextRestriction: null,
      distanceRemainingNm: distances.at(-1) ?? 0, sourceCacheBadge: 'Fresh'
    },
    accessibilitySummary: ''
  };
}

describe('vertical profile label classification', () => {
  it('classifies endpoints, next waypoint, constraints, TOC and TOD as critical', () => {
    const profile = model([0, 20, 60, 100, 140], [0, 10_000, 10_000, 10_000, 0], 25);

    const candidates = classifyVerticalProfilePoints(profile);

    expect(candidates.find(candidate => candidate.ident === 'W0')?.reasons).toContain('endpoint');
    expect(candidates.find(candidate => candidate.ident === 'A-VERY-LONG-WAYPOINT-NAME')?.reasons).toContain('next');
    expect(candidates.find(candidate => candidate.ident === 'W3')?.reasons).toEqual(expect.arrayContaining(['constraint', 'tod']));
    expect(candidates.find(candidate => candidate.ident === 'W1')?.reasons).toContain('toc');
  });

  it('uses exact one-thousand-foot and twenty-nautical-mile step thresholds', () => {
    const accepted = classifyVerticalProfilePoints(model([0, 20, 40], [10_000, 10_000, 11_000]));
    const tooShort = classifyVerticalProfilePoints(model([0, 19.9, 40], [10_000, 10_000, 11_000]));
    const tooSmall = classifyVerticalProfilePoints(model([0, 20, 40], [10_000, 10_000, 10_999]));

    expect(accepted.find(candidate => candidate.ident === 'A-VERY-LONG-WAYPOINT-NAME')?.reasons).toContain('step');
    expect(tooShort.slice(1).every(candidate => !candidate.reasons.includes('step'))).toBe(true);
    expect(tooSmall.slice(1).every(candidate => !candidate.reasons.includes('step'))).toBe(true);
  });

  it('keeps significant climb and descent waypoints critical even before a stable cruise band', () => {
    const candidates = classifyVerticalProfilePoints(
      model([0, 60, 120, 180, 240], [0, 8_000, 20_000, 32_000, 3_000]));

    expect(candidates.slice(1, -1).map(candidate => candidate.reasons)).toEqual([
      expect.arrayContaining(['altitudeChange']),
      expect.arrayContaining(['altitudeChange']),
      expect.arrayContaining(['altitudeChange'])
    ]);
    expect(candidates.slice(1, -1).every(candidate => candidate.critical)).toBe(true);
  });
});

describe('vertical profile label layout', () => {
  const measure = (text: string) => text.length * 7;

  it('keeps every waypoint in a one-hundred-twenty-mile view using at most three rows', () => {
    const profile = model([0, 10, 20, 30, 40, 50, 60, 70, 80], Array(9).fill(10_000));
    const placements = layoutVerticalProfileLabels(
      classifyVerticalProfilePoints(profile),
      createProfileViewport(80),
      320,
      measure);

    expect(placements).toHaveLength(9);
    expect(Math.max(...placements.map(placement => placement.row))).toBeLessThan(3);
  });

  it('full-route view keeps critical points and drops ordinary waypoints', () => {
    const profile = model([0, 100, 200, 300, 400, 500, 600], [0, 10_000, 10_000, 11_000, 11_000, 11_000, 0], 150);
    const candidates = classifyVerticalProfilePoints(profile);
    const fullRoute = zoomProfileViewport(createProfileViewport(600), 0.5, 300);
    const placements = layoutVerticalProfileLabels(candidates, fullRoute, 620, measure);

    expect(placements.map(placement => placement.candidate.ident)).toEqual(
      expect.arrayContaining(['W0', 'A-VERY-LONG-WAYPOINT-NAME', 'W3', 'W6']));
    expect(placements.some(placement => placement.candidate.priority === 0)).toBe(false);
  });

  it('keeps long critical labels inside a narrow plot', () => {
    const profile = model([0, 50, 100, 150], [0, 10_000, 10_000, 0], 55);
    const placements = layoutVerticalProfileLabels(
      classifyVerticalProfilePoints(profile),
      createProfileViewport(150),
      320,
      measure);

    for (const placement of placements.filter(item => item.candidate.critical)) {
      expect(placement.x - placement.width / 2).toBeGreaterThanOrEqual(0);
      expect(placement.x + placement.width / 2).toBeLessThanOrEqual(320);
    }
  });
});
