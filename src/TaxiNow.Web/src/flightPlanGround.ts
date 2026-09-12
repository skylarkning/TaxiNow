export interface PlanAirportPair {
  origin: string;
  destination: string;
}

export function shouldShowPlanAirportShortcuts(
  mapView: "globe" | "ground"
): boolean {
  return mapView === "ground";
}

export interface AirportDownloadSummary {
  icao: string;
  state: string;
}

export interface GroundTransitionSample {
  connected: boolean;
  hasPosition: boolean;
  isStale: boolean;
  onGround: boolean;
}

export type FlightPlanAirportStatus =
  | "idle"
  | "checking"
  | "downloading"
  | "ready"
  | "failed"
  | "opening";

export function airportStatusAfterActivation(
  previous: FlightPlanAirportStatus,
  opened: boolean
): FlightPlanAirportStatus {
  return opened ? "ready" : previous;
}

export function normalizeIcao(value: string): string {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9]{4}$/.test(normalized) ? normalized : "";
}

export class AirportDownloadStartGate {
  private readonly pending = new Map<string, Promise<void>>();

  run(icao: string, start: () => Promise<void>): Promise<void> {
    const key = normalizeIcao(icao);
    const existing = this.pending.get(key);
    if (existing) return existing;

    let started: Promise<void>;
    try {
      started = Promise.resolve(start());
    } catch (error) {
      started = Promise.reject(error);
    }
    const tracked = started.finally(() => {
      if (this.pending.get(key) === tracked) this.pending.delete(key);
    });
    this.pending.set(key, tracked);
    return tracked;
  }
}

export class LatestAirportActivation {
  private generation = 0;

  begin(): { isCurrent: () => boolean } {
    const generation = ++this.generation;
    return { isCurrent: () => generation === this.generation };
  }

  cancel(): void {
    this.generation += 1;
  }
}

export function normalizePlanAirports(plan: PlanAirportPair): string[] {
  return [...new Set([
    normalizeIcao(plan.origin),
    normalizeIcao(plan.destination)
  ].filter(Boolean))];
}

export function airportsNeedingDownload(
  plan: PlanAirportPair,
  installedIcaos: readonly string[],
  downloads: readonly AirportDownloadSummary[]
): string[] {
  const installed = new Set(installedIcaos.map(normalizeIcao));
  const inProgress = new Set(downloads
    .filter(download => download.state === "queued" || download.state === "running")
    .map(download => normalizeIcao(download.icao)));
  return normalizePlanAirports(plan)
    .filter(icao => !installed.has(icao) && !inProgress.has(icao));
}

export class TouchdownAirportSelector {
  private lastValidOnGround: boolean | undefined;

  observe(sample: GroundTransitionSample, destination: string): string | null {
    if (!sample.connected || !sample.hasPosition || sample.isStale) {
      this.lastValidOnGround = undefined;
      return null;
    }

    const previous = this.lastValidOnGround;
    this.lastValidOnGround = sample.onGround;
    return previous === false && sample.onGround
      ? normalizeIcao(destination) || null
      : null;
  }
}
