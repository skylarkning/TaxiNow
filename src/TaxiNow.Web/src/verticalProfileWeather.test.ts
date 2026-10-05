import { describe, expect, it } from 'vitest';
import type { WeatherBand, WeatherBandColumn } from './contracts';
import { buildWeatherPolygons } from './verticalProfileWeather';
import type { ProfileViewport } from './verticalProfileViewport';

const validAt = '2026-10-06T00:00:00Z';
function column(distanceNm: number, baseFeet: number | null = 2_000, topFeet: number | null = 10_000): WeatherBandColumn {
  return {
    longitude: distanceNm / 60, latitude: 0, distanceNm, validAt,
    originalBaseFeet: baseFeet, originalTopFeet: topFeet,
    baseFeet, topFeet, plannedAltitudeFeet: 8_000
  };
}
function band(columns: WeatherBandColumn[], id = 'cloud-0'): WeatherBand {
  return {
    id, kind: 'cloud', intensity: 'moderate', pathRelation: 'offPath',
    confidence: 'medium', valueKind: 'estimated', columns, source: 'Open-Meteo'
  };
}
function viewport(startDistanceNm = 0, endDistanceNm = 200): ProfileViewport {
  return { totalDistanceNm: 200, startDistanceNm, endDistanceNm };
}

describe('vertical profile weather geometry', () => {
  it('merges contiguous columns and preserves display metadata', () => {
    const polygon = buildWeatherPolygons([band([column(0), column(25), column(50)])], viewport())[0]!;

    expect(polygon.columns.map(item => item.distanceNm)).toEqual([0, 25, 50]);
    expect(polygon).toMatchObject({
      bandId: 'cloud-0', kind: 'cloud', intensity: 'moderate',
      pathRelation: 'offPath', valueKind: 'estimated', source: 'Open-Meteo'
    });
  });

  it('splits gaps over fifty nautical miles and never bridges them at viewport edges', () => {
    const polygons = buildWeatherPolygons([
      band([column(0), column(25), column(80), column(105)])
    ], viewport(10, 95));

    expect(polygons).toHaveLength(2);
    expect(polygons[0]!.columns.map(item => item.distanceNm)).toEqual([10, 25]);
    expect(polygons[1]!.columns.map(item => item.distanceNm)).toEqual([80, 95]);
  });

  it('keeps multiple decks separate', () => {
    const polygons = buildWeatherPolygons([
      band([column(0, 1_000, 4_000), column(25, 1_500, 4_500)], 'low'),
      band([column(0, 12_000, 18_000), column(25, 13_000, 19_000)], 'high')
    ], viewport());

    expect(polygons.map(item => item.bandId)).toEqual(['low', 'high']);
  });

  it('preserves unknown base and top as open boundaries instead of zero-height data', () => {
    const [openBase, openTop] = buildWeatherPolygons([
      band([column(0, null, 8_000), column(25, null, 9_000)], 'open-base'),
      band([column(0, 2_000, null), column(25, 3_000, null)], 'open-top')
    ], viewport());

    expect(openBase).toMatchObject({ baseOpen: true, topOpen: false });
    expect(openTop).toMatchObject({ baseOpen: false, topOpen: true });
    expect(openBase!.columns.every(item => item.baseFeet === null)).toBe(true);
    expect(openTop!.columns.every(item => item.topFeet === null)).toBe(true);
  });
});
