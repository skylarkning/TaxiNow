import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VerticalProfileModel } from './verticalProfile';
import type { ProfileLabelPlacement } from './verticalProfileLabels';
import { aircraftTriangle, drawVerticalProfile, type VerticalProfilePalette } from './verticalProfileRenderer';
import type { ProfileViewport } from './verticalProfileViewport';

const palette: VerticalProfilePalette = {
  background: 'background', text: 'text', muted: 'muted', grid: 'grid',
  terrain: 'terrain', terrainStroke: 'terrain-stroke', route: 'route',
  amber: 'amber', red: 'red', aircraft: 'aircraft',
  weatherWeak: 'green', weatherModerate: 'yellow', weatherStrong: 'weather-red',
  font: 'sans-serif'
};

function model(): VerticalProfileModel {
  const weatherColumn = (distanceNm: number, baseFeet: number, topFeet: number) => ({
    longitude: distanceNm / 60, latitude: 0, distanceNm,
    validAt: '2026-10-06T00:00:00Z', originalBaseFeet: baseFeet,
    originalTopFeet: topFeet, baseFeet, topFeet, plannedAltitudeFeet: 10_000
  });
  return {
    origin: 'A', destination: 'B', totalDistanceNm: 100,
    routePoints: [
      { ident: 'A', position: [0, 0], distanceNm: 0, waypointIndex: 0 },
      { ident: 'B', position: [1, 0], distanceNm: 100, waypointIndex: 1 }
    ],
    altitudePath: [
      { distanceNm: 0, altitudeFeet: 10_000, estimated: false, waypointIndex: 0 },
      { distanceNm: 100, altitudeFeet: 12_000, estimated: false, waypointIndex: 1 }
    ],
    constraints: [{ ident: 'B', distanceNm: 100, kind: 'atOrAbove', minimumAltitudeFeet: 12_000, maximumAltitudeFeet: undefined, waypointIndex: 1 }],
    terrain: [
      { longitude: 0, latitude: 0, distanceNm: 0, elevationFeet: 500, referenceAltitudeFeet: 10_000, clearanceFeet: 9_500, clearanceBand: 'normal' },
      { longitude: 1, latitude: 0, distanceNm: 100, elevationFeet: 1_000, referenceAltitudeFeet: 12_000, clearanceFeet: 11_000, clearanceBand: 'normal' }
    ],
    weatherBands: [
      { id: 'off', kind: 'cloud', intensity: 'moderate', pathRelation: 'offPath', confidence: 'medium', valueKind: 'forecast', source: 'model', columns: [weatherColumn(0, 2_000, 5_000), weatherColumn(100, 3_000, 6_000)] },
      { id: 'on', kind: 'convective', intensity: 'strong', pathRelation: 'onPath', confidence: 'high', valueKind: 'forecast', source: 'SIGMET', columns: [weatherColumn(0, 8_000, 14_000), weatherColumn(100, 9_000, 15_000)] }
    ],
    weatherWarnings: [], weatherSourceSummary: 'model · SIGMET',
    aircraft: { distanceNm: 50, crossTrackDistanceNm: 0, altitudeMslFeet: 11_000, altitudeAglFeet: 10_000, terrainElevationFeet: 750, clearanceFeet: 10_250, clearanceBand: 'normal' },
    source: { name: 'Terrain', cacheState: 'fresh', generatedAt: '', attribution: '' },
    metrics: { currentAltitudeFeet: 11_000, currentAglFeet: 10_000, terrainClearanceFeet: 10_250, nextRestriction: null, distanceRemainingNm: 50, sourceCacheBadge: 'Fresh' },
    accessibilitySummary: ''
  };
}

function context() {
  const events: string[] = [];
  const segments: Array<[number, number, number, number]> = [];
  let fillStyle = '', strokeStyle = '', start: [number, number] | undefined;
  const target = {
    clearRect: vi.fn(),
    fillRect: vi.fn(() => events.push(`fill:${fillStyle}`)),
    beginPath: vi.fn(() => { start = undefined; }),
    moveTo: vi.fn((x: number, y: number) => { start = [x, y]; }),
    lineTo: vi.fn((x: number, y: number) => {
      if (start) segments.push([start[0], start[1], x, y]);
      start = [x, y];
    }),
    quadraticCurveTo: vi.fn((_cx: number, _cy: number, x: number, y: number) => { start = [x, y]; }),
    closePath: vi.fn(), rect: vi.fn(), clip: vi.fn(), save: vi.fn(), restore: vi.fn(),
    fill: vi.fn(() => events.push(`fill:${fillStyle}`)),
    stroke: vi.fn(() => events.push(`stroke:${strokeStyle}`)),
    fillText: vi.fn((text: string) => events.push(`text:${text}`)),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
    setLineDash: vi.fn(),
    createPattern: vi.fn(() => ({ pattern: true }))
  };
  const proxy = new Proxy(target as unknown as CanvasRenderingContext2D, {
    set(object, property, value) {
      if (property === 'fillStyle') fillStyle = String(value && typeof value === 'object' ? 'pattern' : value);
      if (property === 'strokeStyle') strokeStyle = String(value);
      return Reflect.set(object, property, value);
    }
  });
  return { context: proxy, events, segments, createPattern: target.createPattern };
}

beforeEach(() => {
  const tileContext = {
    clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
    strokeStyle: '', globalAlpha: 1, lineWidth: 1
  };
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => tileContext })
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('vertical profile renderer', () => {
  it('draws layers in operational order with stripes and no full-height vertical grid', () => {
    const recording = context();
    const labels: ProfileLabelPlacement[] = [{
      candidate: { ident: 'A', distanceNm: 0, waypointIndex: 0, priority: 100, critical: true, reasons: ['endpoint'] },
      x: 0, row: 0, width: 12
    }];
    const viewport: ProfileViewport = { totalDistanceNm: 100, startDistanceNm: 0, endDistanceNm: 100 };
    const bounds = { left: 54, right: 778, top: 22, bottom: 167 };

    drawVerticalProfile(recording.context, model(), viewport, bounds, palette, labels);

    const first = (prefix: string) => recording.events.findIndex(event => event === prefix);
    expect(first('fill:background')).toBeLessThan(first('fill:terrain'));
    expect(first('fill:terrain')).toBeLessThan(first('fill:pattern'));
    expect(first('fill:pattern')).toBeLessThan(first('fill:weather-red'));
    expect(first('fill:weather-red')).toBeLessThan(first('stroke:route'));
    expect(first('stroke:route')).toBeLessThan(first('text:A'));
    expect(first('text:A')).toBeLessThan(recording.events.lastIndexOf('fill:aircraft'));
    expect(recording.createPattern).toHaveBeenCalled();
    expect(recording.segments.some(([x1, y1, x2, y2]) =>
      Math.abs(x1 - x2) < 0.01 && Math.abs(y2 - y1) >= bounds.bottom - bounds.top - 1)).toBe(false);
  });

  it('uses distinct weak, moderate, and strong weather palette entries', () => {
    const recording = context();
    const profile = model();
    profile.weatherBands = ['weak', 'moderate', 'strong'].map((intensity, index) => ({
      ...profile.weatherBands[1]!, id: intensity, intensity: intensity as 'weak' | 'moderate' | 'strong',
      columns: profile.weatherBands[1]!.columns.map(column => ({ ...column, distanceNm: column.distanceNm + index }))
    }));

    drawVerticalProfile(recording.context, profile,
      { totalDistanceNm: 100, startDistanceNm: 0, endDistanceNm: 100 },
      { left: 54, right: 778, top: 22, bottom: 167 }, palette, []);

    expect(recording.events).toEqual(expect.arrayContaining(['fill:green', 'fill:yellow', 'fill:weather-red']));
  });

  it('returns a downward triangle whose first point is the exact aircraft anchor', () => {
    const triangle = aircraftTriangle(120, 80, 10);

    expect(triangle[0]).toEqual({ x: 120, y: 80 });
    expect(triangle[0]!.y).toBeGreaterThan(triangle[1]!.y);
    expect(triangle[0]!.y).toBeGreaterThan(triangle[2]!.y);
  });
});
