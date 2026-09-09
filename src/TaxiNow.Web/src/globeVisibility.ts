type Coordinate = readonly [number, number];

export function isOnVisibleHemisphere(center: Coordinate, point: Coordinate): boolean {
  const toRadians = (degrees: number): number => degrees * Math.PI / 180;
  const centerLatitude = toRadians(center[1]), pointLatitude = toRadians(point[1]);
  const longitudeDelta = toRadians(point[0] - center[0]);
  const cosine = Math.sin(centerLatitude) * Math.sin(pointLatitude) +
    Math.cos(centerLatitude) * Math.cos(pointLatitude) * Math.cos(longitudeDelta);
  return cosine >= 0;
}
