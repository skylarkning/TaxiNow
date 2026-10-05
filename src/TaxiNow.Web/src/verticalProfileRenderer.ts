import type { VerticalProfileModel } from './verticalProfile';
import type { ProfileLabelPlacement } from './verticalProfileLabels';
import { buildWeatherPolygons, type WeatherPolygon } from './verticalProfileWeather';
import { distanceToProfileX, type ProfileViewport } from './verticalProfileViewport';

export interface ProfilePoint { x: number; y: number }

export interface ProfilePlotBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface VerticalProfilePalette {
  background: string;
  text: string;
  muted: string;
  grid: string;
  terrain: string;
  terrainStroke: string;
  route: string;
  amber: string;
  red: string;
  aircraft: string;
  weatherWeak: string;
  weatherModerate: string;
  weatherStrong: string;
  font: string;
}

export function verticalProfileBounds(width: number, height: number): ProfilePlotBounds {
  const left = Math.min(54, width * 0.2);
  const right = Math.max(left + 1, width - 22);
  const top = 22;
  const bottom = Math.max(top + 1, height - 33);
  return { left, right, top, bottom };
}

export function aircraftTriangle(
  distanceX: number,
  altitudeY: number,
  size: number
): [ProfilePoint, ProfilePoint, ProfilePoint] {
  return [
    { x: distanceX, y: altitudeY },
    { x: distanceX - size * 0.75, y: altitudeY - size },
    { x: distanceX + size * 0.75, y: altitudeY - size }
  ];
}

export function drawVerticalProfile(
  context: CanvasRenderingContext2D,
  model: VerticalProfileModel,
  viewport: ProfileViewport,
  bounds: ProfilePlotBounds,
  palette: VerticalProfilePalette,
  labels: readonly ProfileLabelPlacement[]
): void {
  const width = Math.max(bounds.right + 22, 1);
  const height = Math.max(bounds.bottom + 33, 1);
  const polygons = buildWeatherPolygons(model.weatherBands, viewport);
  const weatherAltitudes = polygons.flatMap(polygon => polygon.columns.flatMap(column =>
    [column.baseFeet, column.topFeet].filter(finite)));
  const altitudes = [
    ...model.altitudePath.map(point => point.altitudeFeet),
    ...model.terrain.map(point => point.elevationFeet),
    ...model.constraints.flatMap(point => [point.minimumAltitudeFeet, point.maximumAltitudeFeet]),
    ...weatherAltitudes,
    model.aircraft?.altitudeMslFeet
  ].filter(finite);
  const lower = Math.floor(Math.min(0, ...altitudes) / 1000) * 1000;
  const upper = Math.max(lower + 1000,
    Math.ceil(Math.max(3000, ...altitudes) * 1.12 / 1000) * 1000);
  const plotWidth = bounds.right - bounds.left;
  const plotHeight = bounds.bottom - bounds.top;
  const x = (distanceNm: number) => bounds.left +
    distanceToProfileX(distanceNm, viewport, plotWidth);
  const y = (altitudeFeet: number) => bounds.bottom - clamp(
    (altitudeFeet - lower) / (upper - lower), 0, 1) * plotHeight;
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
  };

  context.clearRect(0, 0, width, height);
  context.fillStyle = palette.background;
  context.fillRect(0, 0, width, height);
  context.font = `10px ${palette.font}`;
  context.lineWidth = 1;
  context.strokeStyle = palette.grid;
  context.fillStyle = palette.muted;
  for (let tick = 0; tick <= 4; tick++) {
    const altitude = lower + (upper - lower) * tick / 4;
    line(bounds.left, y(altitude), bounds.right, y(altitude));
    context.fillText(`${Math.round(altitude / 1000)}k`, 6, y(altitude) + 3);
  }
  context.fillText('FT MSL', 6, 11);
  const distanceTicks = Math.max(2, Math.min(8, Math.floor(plotWidth / 85)));
  const span = viewport.endDistanceNm - viewport.startDistanceNm;
  for (let tick = 0; tick <= distanceTicks; tick++) {
    const distanceNm = viewport.startDistanceNm + span * tick / distanceTicks;
    const atX = x(distanceNm);
    context.fillText(`${Math.round(distanceNm)}`, clamp(atX - 10, bounds.left, bounds.right - 20), height - 4, 42);
  }
  context.fillText('NM', Math.max(2, width - 19), height - 4);

  context.save();
  context.beginPath();
  context.rect(bounds.left, bounds.top, plotWidth, plotHeight);
  context.clip();

  drawTerrain(context, model, viewport, bounds, palette, x, y);
  for (const polygon of polygons.filter(item => item.pathRelation === 'offPath')) {
    drawWeather(context, polygon, bounds, palette, x, y, true);
  }
  for (const polygon of polygons.filter(item => item.pathRelation !== 'offPath')) {
    drawWeather(context, polygon, bounds, palette, x, y, false);
  }
  drawRoute(context, model, viewport, palette, x, y);
  drawConstraints(context, model, viewport, palette, x, y);
  context.restore();

  context.fillStyle = palette.text;
  for (const placement of labels) {
    context.fillText(
      placement.candidate.ident.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 24),
      bounds.left + placement.x - placement.width / 2,
      bounds.top + 12 + placement.row * 13,
      placement.width);
  }

  if (model.aircraft && finite(model.aircraft.altitudeMslFeet) &&
      model.aircraft.distanceNm >= viewport.startDistanceNm &&
      model.aircraft.distanceNm <= viewport.endDistanceNm) {
    const triangle = aircraftTriangle(x(model.aircraft.distanceNm), y(model.aircraft.altitudeMslFeet), 10);
    context.fillStyle = palette.aircraft;
    context.beginPath();
    context.moveTo(triangle[0].x, triangle[0].y);
    context.lineTo(triangle[1].x, triangle[1].y);
    context.lineTo(triangle[2].x, triangle[2].y);
    context.closePath();
    context.fill();
  }
}

function drawTerrain(
  context: CanvasRenderingContext2D,
  model: VerticalProfileModel,
  viewport: ProfileViewport,
  bounds: ProfilePlotBounds,
  palette: VerticalProfilePalette,
  x: (value: number) => number,
  y: (value: number) => number
) {
  const ordered = [...model.terrain].sort((left, right) => left.distanceNm - right.distanceNm);
  const firstVisible = ordered.findIndex(point => point.distanceNm >= viewport.startDistanceNm);
  if (firstVisible < 0) return;
  let lastVisible = -1;
  for (let index = ordered.length - 1; index >= 0; index--) {
    if (ordered[index]!.distanceNm <= viewport.endDistanceNm) {
      lastVisible = index;
      break;
    }
  }
  if (lastVisible < firstVisible) lastVisible = firstVisible;
  const terrain = ordered.slice(
    Math.max(0, firstVisible - 1),
    Math.min(ordered.length, lastVisible + 2));
  if (terrain.length === 0) return;
  context.beginPath();
  context.moveTo(x(terrain[0]!.distanceNm), bounds.bottom);
  for (const point of terrain) context.lineTo(x(point.distanceNm), y(point.elevationFeet));
  context.lineTo(x(terrain.at(-1)!.distanceNm), bounds.bottom);
  context.closePath();
  context.fillStyle = palette.terrain;
  context.fill();
  for (let index = 1; index < terrain.length; index++) {
    const previous = terrain[index - 1]!;
    const point = terrain[index]!;
    if (point.clearanceBand === 'normal') continue;
    context.beginPath();
    context.moveTo(x(previous.distanceNm), bounds.bottom);
    context.lineTo(x(previous.distanceNm), y(previous.elevationFeet));
    context.lineTo(x(point.distanceNm), y(point.elevationFeet));
    context.lineTo(x(point.distanceNm), bounds.bottom);
    context.closePath();
    context.fillStyle = point.clearanceBand === 'red' ? palette.red : palette.amber;
    context.fill();
  }
  context.beginPath();
  context.moveTo(x(terrain[0]!.distanceNm), y(terrain[0]!.elevationFeet));
  for (const point of terrain.slice(1)) context.lineTo(x(point.distanceNm), y(point.elevationFeet));
  context.strokeStyle = palette.terrainStroke;
  context.lineWidth = 2;
  context.stroke();
}

function drawWeather(
  context: CanvasRenderingContext2D,
  polygon: WeatherPolygon,
  bounds: ProfilePlotBounds,
  palette: VerticalProfilePalette,
  x: (value: number) => number,
  y: (value: number) => number,
  striped: boolean
) {
  if (polygon.columns.length === 0) return;
  const color = polygon.intensity === 'strong' ? palette.weatherStrong
    : polygon.intensity === 'moderate' ? palette.weatherModerate
      : palette.weatherWeak;
  context.beginPath();
  const first = polygon.columns[0]!;
  context.moveTo(x(first.distanceNm), first.topFeet === null ? bounds.top : y(first.topFeet));
  traceBoundary(context, polygon.columns, column =>
    column.topFeet === null ? bounds.top : y(column.topFeet), x, polygon.bandId, false);
  const reversed = [...polygon.columns].reverse();
  traceBoundary(context, reversed, column =>
    column.baseFeet === null ? bounds.bottom : y(column.baseFeet), x, polygon.bandId, true);
  context.closePath();
  context.fillStyle = striped ? createStripePattern(context, color) : color;
  context.fill();
}

function traceBoundary(
  context: CanvasRenderingContext2D,
  columns: readonly WeatherPolygon['columns'][number][],
  y: (column: WeatherPolygon['columns'][number]) => number,
  x: (value: number) => number,
  seed: string,
  includeFirst: boolean
) {
  const start = includeFirst ? 0 : 1;
  if (includeFirst && columns[0]) context.lineTo(x(columns[0].distanceNm), y(columns[0]));
  for (let index = start || 1; index < columns.length; index++) {
    const previous = columns[index - 1]!;
    const current = columns[index]!;
    const previousX = x(previous.distanceNm);
    const currentX = x(current.distanceNm);
    const previousY = y(previous);
    const currentY = y(current);
    const wobble = ((hash(seed) + index * 17) % 7 - 3) * 0.6;
    context.quadraticCurveTo(
      (previousX + currentX) / 2,
      (previousY + currentY) / 2 + wobble,
      currentX,
      currentY);
  }
}

function createStripePattern(
  context: CanvasRenderingContext2D,
  color: string
): string | CanvasPattern {
  const document = globalThis.document;
  if (!document?.createElement) return color;
  const tile = document.createElement('canvas');
  tile.width = 8;
  tile.height = 8;
  const tileContext = tile.getContext('2d');
  if (!tileContext) return color;
  tileContext.clearRect(0, 0, 8, 8);
  tileContext.strokeStyle = color;
  tileContext.globalAlpha = 0.75;
  tileContext.lineWidth = 3;
  tileContext.beginPath();
  tileContext.moveTo(-2, 8);
  tileContext.lineTo(8, -2);
  tileContext.moveTo(4, 10);
  tileContext.lineTo(10, 4);
  tileContext.stroke();
  return context.createPattern(tile, 'repeat') ?? color;
}

function drawRoute(
  context: CanvasRenderingContext2D,
  model: VerticalProfileModel,
  viewport: ProfileViewport,
  palette: VerticalProfilePalette,
  x: (value: number) => number,
  y: (value: number) => number
) {
  context.strokeStyle = palette.route;
  context.lineWidth = 1.5;
  for (let index = 1; index < model.altitudePath.length; index++) {
    const previous = model.altitudePath[index - 1]!;
    const point = model.altitudePath[index]!;
    if (point.distanceNm < viewport.startDistanceNm || previous.distanceNm > viewport.endDistanceNm) continue;
    context.setLineDash(point.estimated || previous.estimated ? [5, 3] : []);
    context.beginPath();
    context.moveTo(x(previous.distanceNm), y(previous.altitudeFeet));
    context.lineTo(x(point.distanceNm), y(point.altitudeFeet));
    context.stroke();
  }
  context.setLineDash([]);
}

function drawConstraints(
  context: CanvasRenderingContext2D,
  model: VerticalProfileModel,
  viewport: ProfileViewport,
  palette: VerticalProfilePalette,
  x: (value: number) => number,
  y: (value: number) => number
) {
  context.strokeStyle = palette.text;
  context.lineWidth = 1;
  for (const restriction of model.constraints) {
    if (restriction.distanceNm < viewport.startDistanceNm || restriction.distanceNm > viewport.endDistanceNm) continue;
    const atX = x(restriction.distanceNm);
    const bar = (altitude: number | undefined, direction: number) => {
      if (!finite(altitude)) return;
      const atY = y(altitude);
      context.beginPath();
      context.moveTo(atX - 5, atY);
      context.lineTo(atX + 5, atY);
      if (direction) {
        context.moveTo(atX - 5, atY);
        context.lineTo(atX - 5, atY + direction * 5);
        context.moveTo(atX + 5, atY);
        context.lineTo(atX + 5, atY + direction * 5);
      }
      context.stroke();
    };
    if (restriction.kind === 'at') bar(
      restriction.minimumAltitudeFeet ?? restriction.maximumAltitudeFeet, 0);
    else {
      bar(restriction.minimumAltitudeFeet, -1);
      bar(restriction.maximumAltitudeFeet, 1);
    }
  }
}

function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index++) result = (result * 31 + value.charCodeAt(index)) >>> 0;
  return result;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const finite = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);
