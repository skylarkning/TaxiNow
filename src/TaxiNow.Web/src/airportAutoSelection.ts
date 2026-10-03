import type { TelemetrySnapshot } from "./contracts";
import type { GeographicBounds } from "./interpolation";

export function shouldIdentifyCurrentAirport(
  sample: TelemetrySnapshot,
  currentBounds: GeographicBounds | null,
  automaticSelectionSuspended: boolean
): boolean {
  return sample.hasPosition &&
    sample.connected &&
    sample.onGround &&
    sample.state === "groundTracking" &&
    !automaticSelectionSuspended &&
    !isPointInsideExpandedAirportBounds(
      sample.longitude,
      sample.latitude,
      currentBounds
    );
}

export function isPointInsideExpandedAirportBounds(
  longitude: number,
  latitude: number,
  bounds: GeographicBounds | null,
  paddingDegrees = 0.015
): boolean {
  return bounds !== null &&
    longitude >= bounds.minLon - paddingDegrees &&
    longitude <= bounds.maxLon + paddingDegrees &&
    latitude >= bounds.minLat - paddingDegrees &&
    latitude <= bounds.maxLat + paddingDegrees;
}
