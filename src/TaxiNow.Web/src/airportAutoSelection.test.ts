import { describe, expect, it } from "vitest";
import type { TelemetrySnapshot } from "./contracts";
import { shouldIdentifyCurrentAirport } from "./airportAutoSelection";

const destinationSample: TelemetrySnapshot = {
  sequence: 10,
  simulator: "msfs2024",
  connected: true,
  onGround: true,
  latitude: 45.4706,
  longitude: -73.7408,
  trueHeadingDegrees: 240,
  groundSpeedKnots: 18,
  sourceTimestampUtc: "2026-09-05T00:00:00Z",
  serverTimestampUtc: "2026-09-05T00:00:00Z",
  sourceMonotonicMilliseconds: 1000,
  hasPosition: true,
  isStale: false,
  state: "groundTracking"
};

describe("automatic airport selection", () => {
  it("identifies a new airport after landing outside the selected map", () => {
    expect(shouldIdentifyCurrentAirport(
      destinationSample,
      {
        minLon: -79.7,
        maxLon: -79.5,
        minLat: 43.6,
        maxLat: 43.8
      },
      false
    )).toBe(true);
  });

  it("does not override a manual map choice while still on the ground", () => {
    expect(shouldIdentifyCurrentAirport(
      destinationSample,
      null,
      true
    )).toBe(false);
  });

  it("does not switch maps while airborne", () => {
    expect(shouldIdentifyCurrentAirport(
      { ...destinationSample, onGround: false, state: "airborne" },
      null,
      false
    )).toBe(false);
  });
});
