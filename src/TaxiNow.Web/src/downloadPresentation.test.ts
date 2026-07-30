import { describe, expect, it } from "vitest";
import {
  formatDownloadPercentage,
  isIndeterminateDownload
} from "./downloadPresentation";

describe("download progress presentation", () => {
  it("treats an unmeasurable map-source wait as indeterminate", () => {
    expect(isIndeterminateDownload({
      state: "running",
      phase: "waiting_sources",
      airportsCompleted: 0,
      bytesDownloaded: 0,
      percentage: 0.48
    })).toBe(true);
  });

  it("shows measured progress after an airport completes", () => {
    expect(isIndeterminateDownload({
      state: "running",
      phase: "waiting_sources",
      airportsCompleted: 1,
      bytesDownloaded: 0,
      percentage: 0.2
    })).toBe(false);
    expect(formatDownloadPercentage(0.2)).toBe("0.2%");
  });

  it("shows measured byte progress while a response is arriving", () => {
    expect(isIndeterminateDownload({
      state: "running",
      phase: "downloading_map",
      airportsCompleted: 0,
      bytesDownloaded: 4096,
      percentage: 12
    })).toBe(false);
  });
});
