import { describe, expect, it } from "vitest";
import type { TelemetrySnapshot } from "./contracts";
import {
  interpolateHeading,
  interpolateOwnship,
  isPointInsideBounds
} from "./interpolation";

describe("interpolateHeading", () => {
  it("uses the shortest arc across north", () => {
    expect(interpolateHeading(359, 1, 0.5)).toBeCloseTo(0);
  });

  it("normalizes negative headings", () => {
    expect(interpolateHeading(-10, 10, 0.5)).toBeCloseTo(0);
  });
});

describe("interpolateOwnship", () => {
  it("does not interpolate from a connection-only status sample", () => {
    const status = sample({
      sequence: 1,
      hasPosition: false,
      connected: false,
      onGround: false,
      latitude: 0,
      longitude: 0,
      state: "disconnected"
    });
    const live = sample({
      sequence: 2,
      latitude: 43.6805474,
      longitude: -79.6166645,
      trueHeadingDegrees: 136.56
    });

    expect(
      interpolateOwnship([status, live], Date.parse(live.serverTimestampUtc))
    ).toMatchObject({
      latitude: 43.6805474,
      longitude: -79.6166645,
      heading: 136.56,
      visible: true
    });
  });
});

describe("isPointInsideBounds", () => {
  const cyyz = {
    minLon: -79.6677,
    maxLon: -79.5936,
    minLat: 43.657,
    maxLat: 43.6964
  };

  it("includes the airport perimeter and rejects positions beyond it", () => {
    expect(isPointInsideBounds(-79.62, 43.68, cyyz)).toBe(true);
    expect(isPointInsideBounds(-79.58, 43.68, cyyz)).toBe(false);
  });
});

function sample(
  values: Partial<TelemetrySnapshot> = {}
): TelemetrySnapshot {
  return {
    sequence: 1,
    simulator: "msfs2024",
    connected: true,
    onGround: true,
    latitude: 43.68,
    longitude: -79.61,
    trueHeadingDegrees: 100,
    groundSpeedKnots: 0,
    sourceTimestampUtc: "2026-07-29T20:00:00Z",
    serverTimestampUtc: "2026-07-29T20:00:00Z",
    sourceMonotonicMilliseconds: 100,
    hasPosition: true,
    isStale: false,
    state: "groundTracking",
    ...values
  };
}
