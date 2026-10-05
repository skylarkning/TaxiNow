import type { ElevationProfileResponse, TelemetrySnapshot, WeatherBand, WeatherProfileResponse } from './contracts';
import { distanceNm, type FlightPlan, type FlightPoint, type Position } from './flightPlan';

export type TerrainClearanceBand = 'normal' | 'amber' | 'red';

export interface RouteProjection {
  legIndex: number;
  fraction: number;
  distanceNm: number;
  crossTrackDistanceNm: number;
  position: Position;
}

export interface VerticalProfileRoutePoint {
  ident: string;
  position: Position;
  distanceNm: number;
  waypointIndex: number;
}

export interface VerticalProfilePathPoint {
  distanceNm: number;
  altitudeFeet: number;
  estimated: boolean;
  waypointIndex: number | null;
}

export interface VerticalProfileConstraint {
  ident: string;
  distanceNm: number;
  kind: NonNullable<FlightPoint['constraintKind']>;
  minimumAltitudeFeet: number | undefined;
  maximumAltitudeFeet: number | undefined;
  waypointIndex: number;
}

export interface VerticalProfileTerrainPoint {
  longitude: number;
  latitude: number;
  distanceNm: number;
  elevationFeet: number;
  referenceAltitudeFeet: number;
  clearanceFeet: number;
  clearanceBand: TerrainClearanceBand;
}

export interface VerticalProfileAircraft {
  distanceNm: number;
  crossTrackDistanceNm: number;
  altitudeMslFeet: number;
  altitudeAglFeet: number | null;
  terrainElevationFeet: number | null;
  clearanceFeet: number | null;
  clearanceBand: TerrainClearanceBand;
}

export interface VerticalProfileSource {
  name: string;
  cacheState: ElevationProfileResponse['cacheState'];
  generatedAt: string;
  attribution: string;
}

export interface VerticalProfileMetrics {
  currentAltitudeFeet: number | null;
  currentAglFeet: number | null;
  terrainClearanceFeet: number | null;
  nextRestriction: VerticalProfileConstraint | null;
  distanceRemainingNm: number;
  sourceCacheBadge: string;
}

export interface VerticalProfileModel {
  origin: string;
  destination: string;
  totalDistanceNm: number;
  routePoints: VerticalProfileRoutePoint[];
  altitudePath: VerticalProfilePathPoint[];
  constraints: VerticalProfileConstraint[];
  terrain: VerticalProfileTerrainPoint[];
  aircraft?: VerticalProfileAircraft;
  weatherBands: WeatherBand[];
  weatherWarnings: string[];
  weatherSourceSummary: string;
  source: VerticalProfileSource;
  metrics: VerticalProfileMetrics;
  accessibilitySummary: string;
}

export interface BuildVerticalProfileInput {
  flightPlan: FlightPlan;
  elevationProfile: ElevationProfileResponse;
  telemetry?: TelemetrySnapshot;
  weatherProfile?: WeatherProfileResponse;
}

const nauticalMilesPerDegree = 60.0405;
const radians = Math.PI / 180;
export const profileTelemetryFreshnessMilliseconds = 15_000;

export function hasFreshProfileTelemetry(sample: TelemetrySnapshot | undefined, now = Date.now()): boolean {
  if (!sample?.connected || !sample.hasPosition || sample.isStale) return false;
  const timestamp = Date.parse(sample.serverTimestampUtc);
  const age = now - timestamp;
  return Number.isFinite(timestamp) && age >= 0 && age < profileTelemetryFreshnessMilliseconds;
}

function shortLongitudeDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

function normalizedLongitude(longitude: number): number {
  return ((longitude + 540) % 360) - 180;
}

function finitePosition(position: Position): boolean {
  return Number.isFinite(position[0]) && Number.isFinite(position[1]) &&
    Math.abs(position[0]) <= 180 && Math.abs(position[1]) <= 90;
}

function cumulativeRoute(points: ReadonlyArray<Pick<FlightPoint, 'position'>>): number[] {
  const result = [0];
  for (let index = 1; index < points.length; index++) {
    result.push(result[index - 1]! + distanceNm(points[index - 1]!.position, points[index]!.position));
  }
  return result;
}

export function projectPositionOntoRoute(
  points: ReadonlyArray<FlightPoint>,
  position: Position
): RouteProjection | undefined {
  if (points.length < 2 || !finitePosition(position)) return undefined;

  const cumulative = cumulativeRoute(points);
  let best: RouteProjection | undefined;
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index]!.position;
    const end = points[index + 1]!.position;
    if (!finitePosition(start) || !finitePosition(end)) continue;

    const meanLatitudeRadians = ((start[1] + end[1]) / 2) * radians;
    const longitudeScale = Math.max(1e-9, Math.abs(Math.cos(meanLatitudeRadians)));
    const endX = shortLongitudeDelta(start[0], end[0]) * longitudeScale * nauticalMilesPerDegree;
    const endY = (end[1] - start[1]) * nauticalMilesPerDegree;
    const positionX = shortLongitudeDelta(start[0], position[0]) * longitudeScale * nauticalMilesPerDegree;
    const positionY = (position[1] - start[1]) * nauticalMilesPerDegree;
    const squaredLength = endX * endX + endY * endY;
    const fraction = squaredLength === 0
      ? 0
      : Math.max(0, Math.min(1, (positionX * endX + positionY * endY) / squaredLength));
    const crossTrackDistanceNm = Math.hypot(positionX - fraction * endX, positionY - fraction * endY);
    if (best && crossTrackDistanceNm >= best.crossTrackDistanceNm) continue;

    const legDistanceNm = cumulative[index + 1]! - cumulative[index]!;
    best = {
      legIndex: index,
      fraction,
      distanceNm: cumulative[index]! + fraction * legDistanceNm,
      crossTrackDistanceNm,
      position: [
        normalizedLongitude(start[0] + fraction * shortLongitudeDelta(start[0], end[0])),
        start[1] + fraction * (end[1] - start[1])
      ]
    };
  }
  return best;
}

export function terrainClearanceBand(clearanceFeet: number, airborne: boolean): TerrainClearanceBand {
  if (!airborne || !Number.isFinite(clearanceFeet)) return 'normal';
  if (clearanceFeet <= 1000) return 'red';
  if (clearanceFeet <= 2000) return 'amber';
  return 'normal';
}

function terrainElevationAt(samples: ElevationProfileResponse['samples'], distance: number): number | null {
  if (!samples.length) return null;
  if (distance <= samples[0]!.distanceNm) return samples[0]!.elevationFeet;
  for (let index = 1; index < samples.length; index++) {
    const previous = samples[index - 1]!;
    const current = samples[index]!;
    if (distance > current.distanceNm) continue;
    const span = current.distanceNm - previous.distanceNm;
    const fraction = span > 0 ? (distance - previous.distanceNm) / span : 0;
    return previous.elevationFeet + fraction * (current.elevationFeet - previous.elevationFeet);
  }
  return samples.at(-1)!.elevationFeet;
}

function estimatedAltitude(
  distance: number,
  totalDistance: number,
  originElevation: number,
  destinationElevation: number,
  cruiseAltitude: number
): number {
  if (totalDistance <= 0) return originElevation;
  const fraction = Math.max(0, Math.min(1, distance / totalDistance));
  if (fraction <= 0.2) return originElevation + (cruiseAltitude - originElevation) * (fraction / 0.2);
  if (fraction <= 0.7) return cruiseAltitude;
  return cruiseAltitude + (destinationElevation - cruiseAltitude) * ((fraction - 0.7) / 0.3);
}

function pathAltitudeAt(path: VerticalProfilePathPoint[], distance: number): number {
  if (!path.length) return 0;
  if (distance <= path[0]!.distanceNm) return path[0]!.altitudeFeet;
  for (let index = 1; index < path.length; index++) {
    const previous = path[index - 1]!;
    const current = path[index]!;
    if (distance > current.distanceNm) continue;
    const span = current.distanceNm - previous.distanceNm;
    const fraction = span > 0 ? (distance - previous.distanceNm) / span : 0;
    return previous.altitudeFeet + fraction * (current.altitudeFeet - previous.altitudeFeet);
  }
  return path.at(-1)!.altitudeFeet;
}

function displayAltitude(value: number): string {
  const rounded = Math.round(value).toString();
  return rounded.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function buildAccessibilitySummary(
  flightPlan: FlightPlan,
  aircraft: VerticalProfileAircraft | undefined,
  cacheState: ElevationProfileResponse['cacheState'],
  weatherProfile: WeatherProfileResponse | undefined,
  weatherSourceSummary: string
): string {
  const aircraftText = aircraft
    ? `Aircraft altitude ${displayAltitude(aircraft.altitudeMslFeet)} feet MSL.`
    : 'Live aircraft altitude unavailable.';
  const terrainText = cacheState === 'cachedOffline'
    ? 'Terrain is from the cached offline profile.'
    : 'Terrain profile is fresh.';
  const weatherText = !weatherProfile
    ? 'Weather forecast unavailable.'
    : [
        `Weather forecast source ${weatherSourceSummary || 'unknown'}.`,
        weatherProfile.cacheState === 'stale' ? 'Weather forecast is stale.' : '',
        weatherProfile.bands.some(band => band.valueKind === 'estimated')
          ? 'Weather boundaries include estimated values.'
          : '',
        ...weatherProfile.warnings
      ].filter(Boolean).join(' ');
  return `${flightPlan.origin} to ${flightPlan.destination} vertical profile. ${aircraftText} ${terrainText} ${weatherText} Terrain colours are a simulation advisory only.`;
}

export function buildVerticalProfileModel(input: BuildVerticalProfileInput): VerticalProfileModel {
  const { flightPlan, elevationProfile, telemetry, weatherProfile } = input;
  const routeDistances = cumulativeRoute(flightPlan.points);
  const totalDistanceNm = routeDistances.at(-1) ?? 0;
  const sortedTerrain = [...elevationProfile.samples].sort((left, right) => left.distanceNm - right.distanceNm);
  const terrainOrigin = terrainElevationAt(sortedTerrain, 0) ?? 0;
  const terrainDestination = terrainElevationAt(sortedTerrain, totalDistanceNm) ?? terrainOrigin;
  const originElevation = Number.isFinite(flightPlan.originElevationFeet)
    ? flightPlan.originElevationFeet!
    : terrainOrigin;
  const destinationElevation = Number.isFinite(flightPlan.destinationElevationFeet)
    ? flightPlan.destinationElevationFeet!
    : terrainDestination;
  const parsedCruiseAltitude = Number(flightPlan.altitude);
  const cruiseAltitude = Number.isFinite(parsedCruiseAltitude)
    ? parsedCruiseAltitude
    : Math.max(originElevation, destinationElevation);

  const routePoints = flightPlan.points.map((point, waypointIndex): VerticalProfileRoutePoint => ({
    ident: point.ident,
    position: [...point.position],
    distanceNm: routeDistances[waypointIndex]!,
    waypointIndex
  }));

  const altitudePath: VerticalProfilePathPoint[] = flightPlan.points.map((point, waypointIndex) => {
    const exact = point.plannedAltitudeFeet;
    return {
      distanceNm: routeDistances[waypointIndex]!,
      altitudeFeet: Number.isFinite(exact)
        ? exact!
        : estimatedAltitude(routeDistances[waypointIndex]!, totalDistanceNm, originElevation, destinationElevation, cruiseAltitude),
      estimated: !Number.isFinite(exact),
      waypointIndex
    };
  });
  const needsEstimatedPath = altitudePath.some(point => point.estimated);
  for (const fraction of needsEstimatedPath ? [0.2, 0.7] : []) {
    const distance = totalDistanceNm * fraction;
    if (totalDistanceNm <= 0 || altitudePath.some(point => Math.abs(point.distanceNm - distance) < 1e-6)) continue;
    altitudePath.push({
      distanceNm: distance,
      altitudeFeet: estimatedAltitude(distance, totalDistanceNm, originElevation, destinationElevation, cruiseAltitude),
      estimated: true,
      waypointIndex: null
    });
  }
  altitudePath.sort((left, right) => left.distanceNm - right.distanceNm);

  const constraints = flightPlan.points.flatMap((point, waypointIndex): VerticalProfileConstraint[] => {
    if (!point.constraintKind) return [];
    return [{
      ident: point.ident,
      distanceNm: routeDistances[waypointIndex]!,
      kind: point.constraintKind,
      minimumAltitudeFeet: point.minimumAltitudeFeet,
      maximumAltitudeFeet: point.maximumAltitudeFeet,
      waypointIndex
    }];
  });

  const liveProjection = hasFreshProfileTelemetry(telemetry) && telemetry &&
    Number.isFinite(telemetry.latitude) && Number.isFinite(telemetry.longitude) &&
    Number.isFinite(telemetry.altitudeMslFeet)
    ? projectPositionOntoRoute(flightPlan.points, [telemetry.longitude, telemetry.latitude])
    : undefined;
  const terrainUnderAircraft = liveProjection
    ? terrainElevationAt(sortedTerrain, liveProjection.distanceNm)
    : null;
  const liveClearance = liveProjection && terrainUnderAircraft !== null
    ? telemetry!.altitudeMslFeet! - terrainUnderAircraft
    : null;
  const aircraft: VerticalProfileAircraft | undefined = liveProjection
    ? {
        distanceNm: liveProjection.distanceNm,
        crossTrackDistanceNm: liveProjection.crossTrackDistanceNm,
        altitudeMslFeet: telemetry!.altitudeMslFeet!,
        altitudeAglFeet: Number.isFinite(telemetry!.altitudeAglFeet) ? telemetry!.altitudeAglFeet! : null,
        terrainElevationFeet: terrainUnderAircraft,
        clearanceFeet: liveClearance,
        clearanceBand: terrainClearanceBand(liveClearance ?? Number.POSITIVE_INFINITY, !telemetry!.onGround)
      }
    : undefined;

  const useLiveAltitudeForBands = aircraft !== undefined && !telemetry!.onGround;
  const terrain = sortedTerrain.map((sample): VerticalProfileTerrainPoint => {
    const referenceAltitudeFeet = useLiveAltitudeForBands
      ? aircraft.altitudeMslFeet
      : pathAltitudeAt(altitudePath, sample.distanceNm);
    const clearanceFeet = referenceAltitudeFeet - sample.elevationFeet;
    return {
      ...sample,
      referenceAltitudeFeet,
      clearanceFeet,
      clearanceBand: terrainClearanceBand(clearanceFeet, true)
    };
  });

  const currentDistance = aircraft?.distanceNm ?? 0;
  const nextRestriction = constraints.find(constraint => constraint.distanceNm + 1e-6 >= currentDistance) ?? null;
  const sourceCacheBadge = elevationProfile.cacheState === 'cachedOffline'
    ? `${elevationProfile.source} · Cached/offline`
    : `${elevationProfile.source} · Fresh`;
  const source: VerticalProfileSource = {
    name: elevationProfile.source,
    cacheState: elevationProfile.cacheState,
    generatedAt: elevationProfile.generatedAt,
    attribution: elevationProfile.attribution
  };
  const metrics: VerticalProfileMetrics = {
    currentAltitudeFeet: aircraft?.altitudeMslFeet ?? null,
    currentAglFeet: aircraft?.altitudeAglFeet ?? null,
    terrainClearanceFeet: aircraft?.clearanceFeet ?? null,
    nextRestriction,
    distanceRemainingNm: Math.max(0, totalDistanceNm - currentDistance),
    sourceCacheBadge
  };
  const weatherBands = (weatherProfile?.bands ?? [])
    .map(band => ({
      ...band,
      columns: band.columns
        .filter(column => Number.isFinite(column.distanceNm))
        .map(column => ({
          ...column,
          distanceNm: Math.max(0, Math.min(totalDistanceNm, column.distanceNm))
        }))
        .sort((left, right) => left.distanceNm - right.distanceNm)
    }))
    .filter(band => band.columns.length > 0)
    .sort((left, right) => left.columns[0]!.distanceNm - right.columns[0]!.distanceNm);
  const weatherSourceSummary = [...new Set(
    (weatherProfile?.sources ?? []).map(source => source.name.trim()).filter(Boolean)
  )].join(' · ');
  const weatherWarnings = [...(weatherProfile?.warnings ?? [])];

  return {
    origin: flightPlan.origin,
    destination: flightPlan.destination,
    totalDistanceNm,
    routePoints,
    altitudePath,
    constraints,
    terrain,
    aircraft,
    weatherBands,
    weatherWarnings,
    weatherSourceSummary,
    source,
    metrics,
    accessibilitySummary: buildAccessibilitySummary(
      flightPlan,
      aircraft,
      elevationProfile.cacheState,
      weatherProfile,
      weatherSourceSummary)
  };
}
