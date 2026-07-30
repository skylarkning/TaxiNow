import type { DownloadJob } from "./contracts";

type DownloadProgressState = Pick<
  DownloadJob,
  | "state"
  | "phase"
  | "airportsCompleted"
  | "bytesDownloaded"
  | "percentage"
>;

type DownloadEtaState = Pick<
  DownloadJob,
  | "state"
  | "airportsCompleted"
  | "airportsTotal"
  | "estimatedRemaining"
>;

export function isIndeterminateDownload(
  job: DownloadProgressState
): boolean {
  if (job.state === "queued") {
    return true;
  }
  if (job.state !== "running" ||
      job.airportsCompleted > 0 ||
      job.bytesDownloaded > 0) {
    return false;
  }

  const phase = job.phase.toLowerCase();
  return job.percentage <= 0 ||
    phase.includes("waiting") ||
    phase.includes("requesting") ||
    phase.includes("acquiring");
}

export function formatDownloadPercentage(percentage: number): string {
  const value = Math.max(0, Math.min(100, percentage));
  if (value > 0 && value < 1) {
    return `${value.toFixed(1)}%`;
  }
  return `${Math.round(value)}%`;
}

export function shouldShowDownloadEta(job: DownloadEtaState): boolean {
  if (job.state !== "running" || !job.estimatedRemaining) {
    return false;
  }
  if (job.airportsTotal <= 1) {
    return true;
  }

  // The first completed airport in a large country is not a representative
  // throughput sample. Wait for up to four completions before showing an ETA
  // so one unusually slow OSM response cannot be multiplied across the whole
  // queue.
  const requiredSamples = Math.min(4, job.airportsTotal);
  return job.airportsCompleted >= requiredSamples;
}
