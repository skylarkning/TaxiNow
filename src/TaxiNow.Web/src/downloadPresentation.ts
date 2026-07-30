import type { DownloadJob } from "./contracts";

type DownloadProgressState = Pick<
  DownloadJob,
  | "state"
  | "phase"
  | "airportsCompleted"
  | "bytesDownloaded"
  | "percentage"
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
