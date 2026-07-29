export type AirportFeatureKind =
  | "runway"
  | "taxiway"
  | "taxilane"
  | "apron"
  | "parking_position"
  | "gate"
  | "holding_position"
  | "terminal"
  | "hangar"
  | "jetway"
  | "pavement";

export interface AirportMap {
  schemaVersion: 2;
  airport: {
    icao: string;
    name: string;
    countryCode: string;
    regionCode: string | null;
    municipality: string | null;
    center: [number, number];
    bounds: {
      minLon: number;
      maxLon: number;
      minLat: number;
      maxLat: number;
    };
  };
  counts: {
    runways: number;
    taxiways: number;
    stands: number;
    terminals: number;
  };
  sources: Array<{ name: string; url: string | null; license: string | null }>;
  features: AirportFeature[];
}

export interface AirportFeature {
  id: string;
  kind: AirportFeatureKind;
  points: [number, number][];
  ref: string | null;
  name: string | null;
  widthMeters: number | null;
  headingDegrees: number | null;
  closed: boolean;
  source: string;
}

export interface TelemetrySnapshot {
  sequence: number;
  simulator: "replay" | "msfs2020" | "msfs2024" | "unknown";
  connected: boolean;
  onGround: boolean;
  latitude: number;
  longitude: number;
  trueHeadingDegrees: number;
  groundSpeedKnots: number;
  sourceTimestampUtc: string;
  serverTimestampUtc: string;
  sourceMonotonicMilliseconds: number;
  isStale: boolean;
  state:
    | "disconnected"
    | "connecting"
    | "connected"
    | "airborne"
    | "groundTracking"
    | "reconnecting";
}
