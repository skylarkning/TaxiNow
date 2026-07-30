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
  hasPosition: boolean;
  isStale: boolean;
  state:
    | "disconnected"
    | "connecting"
    | "connected"
    | "airborne"
    | "groundTracking"
    | "reconnecting";
}

export interface AppStatus {
  product: string;
  version: string;
  displayVersion: string;
  buildDate: string;
  apiVersion: number;
  localUrl: string;
  localUrls: string[];
  port: number;
  mode: string;
  connected: boolean;
  selectedAirport: string;
  lanEnabled: boolean;
}

export interface StoredMapAsset {
  icao: string;
  name: string;
  countryCode: string;
  regionCode: string | null;
  municipality: string | null;
  sizeBytes: number;
  generatedAt: string;
  importedAt: string;
  sourceMix: string;
  warning: string | null;
}

export interface StorageSummary {
  totalBytes: number;
  freeBytes: number;
  airportCount: number;
  countries: Array<{
    code: string;
    airportCount: number;
    sizeBytes: number;
  }>;
  assets: StoredMapAsset[];
}

export interface DownloadJob {
  jobId: string;
  state: "queued" | "running" | "completed" | "failed" | "cancelled";
  phase: string;
  airportsCompleted: number;
  airportsTotal: number;
  maxParallel: number;
  bytesWritten: number;
  bytesDownloaded: number;
  downloadBytesTotal: number | null;
  downloadBytesPerSecond: number | null;
  currentIcao: string | null;
  percentage: number;
  elapsed: string;
  estimatedRemaining: string | null;
  currentSource: string | null;
  warnings: string[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
