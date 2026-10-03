import type { Coordinate } from './taxiRouting';

interface FollowCamera {
  getZoom(): number;
  easeTo(options: {
    center: Coordinate; bearing: number; zoom: number;
    offset: [number, number]; duration: number; essential: boolean;
  }): unknown;
}

export function followAircraft(
  camera: FollowCamera,
  position: Coordinate,
  heading: number,
  offset: [number, number],
  minimumZoom = 0
): void {
  if (!position.every(Number.isFinite) || !Number.isFinite(heading) ||
      Math.abs(position[0]) > 180 || Math.abs(position[1]) > 90) return;
  // Replacing an in-progress camera animation keeps following a moving aircraft.
  camera.easeTo({
    center: position, bearing: heading, zoom: Math.max(camera.getZoom(), minimumZoom),
    offset, duration: 250, essential: true
  });
}
