import type { AirportFeature, AirportMap } from "./contracts";

const METRES_PER_LATITUDE_DEGREE = 111_320;
const PRIMARY_RUNWAY_RADIUS_METRES = 5_000;
const AIRPORT_FEATURE_DISTANCE_METRES = 1_200;

function localPoint(
  point: [number, number],
  latitude: number
): [number, number] {
  return [
    point[0] * METRES_PER_LATITUDE_DEGREE *
      Math.cos(latitude * Math.PI / 180),
    point[1] * METRES_PER_LATITUDE_DEGREE
  ];
}

function distance(
  left: [number, number],
  right: [number, number],
  latitude: number
): number {
  const [leftX, leftY] = localPoint(left, latitude);
  const [rightX, rightY] = localPoint(right, latitude);
  return Math.hypot(leftX - rightX, leftY - rightY);
}

function pointSegmentDistance(
  point: [number, number],
  start: [number, number],
  end: [number, number],
  latitude: number
): number {
  const [pointX, pointY] = localPoint(point, latitude);
  const [startX, startY] = localPoint(start, latitude);
  const [endX, endY] = localPoint(end, latitude);
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX ** 2 + deltaY ** 2;
  const fraction = lengthSquared === 0
    ? 0
    : Math.max(
      0,
      Math.min(
        1,
        (
          (pointX - startX) * deltaX +
          (pointY - startY) * deltaY
        ) / lengthSquared
      )
    );
  return Math.hypot(
    pointX - (startX + fraction * deltaX),
    pointY - (startY + fraction * deltaY)
  );
}

export function filterAirportFeatures(
  features: AirportFeature[],
  center: [number, number],
  maximumDistance = AIRPORT_FEATURE_DISTANCE_METRES
): AirportFeature[] {
  const runways = features.filter(
    (feature) => feature.kind === "runway" && feature.points.length >= 2
  );
  if (runways.length === 0) {
    return features;
  }
  const primaryRunways = runways.filter((runway) =>
    runway.points.some((point) =>
      distance(point, center, center[1]) <= PRIMARY_RUNWAY_RADIUS_METRES
    )
  );
  const selectedRunways = primaryRunways.length > 0
    ? primaryRunways
    : runways;
  const runwayIds = new Set(selectedRunways.map((runway) => runway.id));
  const segments = selectedRunways.flatMap((runway) =>
    runway.points.slice(1).map((point, index) =>
      [runway.points[index]!, point] as const
    )
  );

  return features.filter((feature) => {
    if (runwayIds.has(feature.id)) {
      return true;
    }
    if (feature.points.length === 0) {
      return false;
    }
    return feature.points.some((point) =>
      segments.some(([start, end]) =>
        pointSegmentDistance(point, start, end, center[1]) <= maximumDistance
      )
    );
  });
}

export function calculateFeatureBounds(
  features: AirportFeature[],
  center: [number, number]
): AirportMap["airport"]["bounds"] {
  const points = features.flatMap((feature) => feature.points);
  if (points.length === 0) {
    return {
      minLon: center[0] - 0.02,
      maxLon: center[0] + 0.02,
      minLat: center[1] - 0.02,
      maxLat: center[1] + 0.02
    };
  }
  const longitudes = points.map((point) => point[0]);
  const latitudes = points.map((point) => point[1]);
  const minimumLongitude = Math.min(...longitudes);
  const maximumLongitude = Math.max(...longitudes);
  const minimumLatitude = Math.min(...latitudes);
  const maximumLatitude = Math.max(...latitudes);
  const longitudePadding = Math.max(
    (maximumLongitude - minimumLongitude) * 0.035,
    0.0005
  );
  const latitudePadding = Math.max(
    (maximumLatitude - minimumLatitude) * 0.035,
    0.0005
  );
  return {
    minLon: minimumLongitude - longitudePadding,
    maxLon: maximumLongitude + longitudePadding,
    minLat: minimumLatitude - latitudePadding,
    maxLat: maximumLatitude + latitudePadding
  };
}

export function featureCounts(
  features: AirportFeature[]
): AirportMap["counts"] {
  return {
    runways: features.filter((feature) => feature.kind === "runway").length,
    taxiways: features.filter(
      (feature) =>
        feature.kind === "taxiway" || feature.kind === "taxilane"
    ).length,
    stands: features.filter(
      (feature) =>
        feature.kind === "parking_position" || feature.kind === "gate"
    ).length,
    terminals: features.filter(
      (feature) => feature.kind === "terminal"
    ).length
  };
}
