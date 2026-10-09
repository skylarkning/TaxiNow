import type {
  WeatherBand,
  WeatherConfidence,
  WeatherFeatureKind,
  WeatherIntensity,
  WeatherPathRelation,
  WeatherValueKind
} from './contracts';
import type { ProfileViewport } from './verticalProfileViewport';

export interface WeatherPolygonColumn {
  distanceNm: number;
  baseFeet: number | null;
  topFeet: number | null;
}

export interface WeatherPolygon {
  bandId: string;
  kind: WeatherFeatureKind;
  intensity: WeatherIntensity;
  pathRelation: WeatherPathRelation;
  confidence: WeatherConfidence;
  valueKind: WeatherValueKind;
  source: string;
  baseOpen: boolean;
  topOpen: boolean;
  columns: WeatherPolygonColumn[];
}

const maximumGapNm = 50;

export function buildWeatherPolygons(
  bands: readonly WeatherBand[],
  viewport: ProfileViewport
): WeatherPolygon[] {
  const polygons: WeatherPolygon[] = [];
  for (const band of bands) {
    const ordered = band.columns
      .filter(column => Number.isFinite(column.distanceNm))
      .map(column => ({
        distanceNm: column.distanceNm,
        baseFeet: finiteOrNull(column.baseFeet),
        topFeet: finiteOrNull(column.topFeet)
      }))
      .sort((left, right) => left.distanceNm - right.distanceNm);
    const runs: WeatherPolygonColumn[][] = [];
    for (const column of ordered) {
      const current = runs.at(-1);
      if (!current || column.distanceNm - current.at(-1)!.distanceNm > maximumGapNm) {
        runs.push([column]);
      } else if (column.distanceNm > current.at(-1)!.distanceNm + 1e-9) {
        current.push(column);
      }
    }
    for (const run of runs) {
      let columns = clipRun(run, viewport.startDistanceNm, viewport.endDistanceNm);
      if (columns.length === 0) continue;
      if (columns.length === 1) {
        const column = columns[0]!;
        const halfWidth = 5;
        const start = Math.max(viewport.startDistanceNm, column.distanceNm - halfWidth);
        const end = Math.min(viewport.endDistanceNm, column.distanceNm + halfWidth);
        columns = start < end
          ? [{ ...column, distanceNm: start }, { ...column, distanceNm: end }]
          : columns;
      }
      polygons.push({
        bandId: band.id,
        kind: band.kind,
        intensity: band.intensity,
        pathRelation: band.pathRelation,
        confidence: band.confidence,
        valueKind: band.valueKind,
        source: band.source,
        baseOpen: columns.some(column => column.baseFeet === null),
        topOpen: columns.some(column => column.topFeet === null),
        columns
      });
    }
  }
  return polygons;
}

function clipRun(
  run: readonly WeatherPolygonColumn[],
  startDistanceNm: number,
  endDistanceNm: number
): WeatherPolygonColumn[] {
  if (run.length === 0 || endDistanceNm < startDistanceNm ||
      run.at(-1)!.distanceNm < startDistanceNm || run[0]!.distanceNm > endDistanceNm) return [];
  const output: WeatherPolygonColumn[] = [];
  const atStart = interpolateBoundary(run, startDistanceNm);
  if (atStart) output.push(atStart);
  for (const column of run) {
    if (column.distanceNm >= startDistanceNm - 1e-9 &&
        column.distanceNm <= endDistanceNm + 1e-9 &&
        !output.some(item => Math.abs(item.distanceNm - column.distanceNm) < 1e-9)) {
      output.push(column);
    }
  }
  const atEnd = interpolateBoundary(run, endDistanceNm);
  if (atEnd && !output.some(item => Math.abs(item.distanceNm - atEnd.distanceNm) < 1e-9)) {
    output.push(atEnd);
  }
  return output.sort((left, right) => left.distanceNm - right.distanceNm);
}

function interpolateBoundary(
  run: readonly WeatherPolygonColumn[],
  distanceNm: number
): WeatherPolygonColumn | undefined {
  for (let index = 1; index < run.length; index++) {
    const previous = run[index - 1]!;
    const next = run[index]!;
    if (distanceNm <= previous.distanceNm || distanceNm >= next.distanceNm) continue;
    const fraction = (distanceNm - previous.distanceNm) / (next.distanceNm - previous.distanceNm);
    return {
      distanceNm,
      baseFeet: interpolateNullable(previous.baseFeet, next.baseFeet, fraction),
      topFeet: interpolateNullable(previous.topFeet, next.topFeet, fraction)
    };
  }
  return undefined;
}

function interpolateNullable(first: number | null, second: number | null, fraction: number): number | null {
  return first === null || second === null ? null : first + fraction * (second - first);
}

function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}
