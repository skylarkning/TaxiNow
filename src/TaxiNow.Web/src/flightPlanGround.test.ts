import { describe, expect, it } from "vitest";
import {
  AirportDownloadStartGate,
  LatestAirportActivation,
  TouchdownAirportSelector,
  airportStatusAfterActivation,
  airportsNeedingDownload,
  normalizePlanAirports,
  shouldShowPlanAirportShortcuts
} from "./flightPlanGround";

describe("shouldShowPlanAirportShortcuts", () => {
  it("shows FROM and TO only in the Taxi ground view", () => {
    expect(shouldShowPlanAirportShortcuts("globe")).toBe(false);
    expect(shouldShowPlanAirportShortcuts("ground")).toBe(true);
  });
});

describe("airportStatusAfterActivation", () => {
  it("restores the prior status when a newer navigation supersedes an airport open", () => {
    expect(airportStatusAfterActivation("ready", false)).toBe("ready");
    expect(airportStatusAfterActivation("downloading", false)).toBe("downloading");
    expect(airportStatusAfterActivation("idle", true)).toBe("ready");
  });
});

describe("AirportDownloadStartGate", () => {
  it("shares one download start across overlapping requests for the same ICAO", async () => {
    const gate = new AirportDownloadStartGate();
    let starts = 0;
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const start = async () => { starts += 1; await pending; };

    const first = gate.run("VHHH", start);
    const second = gate.run("vhhh", start);
    expect(starts).toBe(1);
    release();
    await Promise.all([first, second]);
  });
});

describe("LatestAirportActivation", () => {
  it("allows only the latest airport navigation request to commit", () => {
    const activations = new LatestAirportActivation();
    const first = activations.begin();
    const second = activations.begin();

    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
    activations.cancel();
    expect(second.isCurrent()).toBe(false);
  });
});

describe("normalizePlanAirports", () => {
  it("returns normalized origin and destination ICAOs without duplicates", () => {
    expect(normalizePlanAirports({ origin: " vhhh ", destination: "rjtt" }))
      .toEqual(["VHHH", "RJTT"]);
    expect(normalizePlanAirports({ origin: "VHHH", destination: "vhhh" }))
      .toEqual(["VHHH"]);
  });
});

describe("airportsNeedingDownload", () => {
  it("queues only missing airports without an active download", () => {
    expect(airportsNeedingDownload(
      { origin: "VHHH", destination: "RJTT" },
      ["VHHH"],
      [{ icao: "RJTT", state: "running" }]
    )).toEqual([]);

    expect(airportsNeedingDownload(
      { origin: "VHHH", destination: "RJTT" },
      [],
      [{ icao: "VHHH", state: "failed" }]
    )).toEqual(["VHHH", "RJTT"]);

    expect(airportsNeedingDownload(
      { origin: "VHHH", destination: "RJTT" },
      [],
      [{ icao: "RJTT", state: "completed" }]
    )).toEqual(["VHHH", "RJTT"]);
  });
});

describe("TouchdownAirportSelector", () => {
  it("selects the destination once when valid telemetry changes from airborne to on-ground", () => {
    const selector = new TouchdownAirportSelector();
    const airborne = { connected: true, hasPosition: true, isStale: false, onGround: false };
    const landed = { connected: true, hasPosition: true, isStale: false, onGround: true };

    expect(selector.observe(airborne, "VHHH")).toBeNull();
    expect(selector.observe(landed, "VHHH")).toBe("VHHH");
    expect(selector.observe(landed, "VHHH")).toBeNull();
  });

  it("does not switch when the first valid sample is already on the ground", () => {
    const selector = new TouchdownAirportSelector();

    expect(selector.observe(
      { connected: true, hasPosition: true, isStale: false, onGround: true },
      "VHHH"
    )).toBeNull();
  });

  it("re-arms after another takeoff and ignores invalid telemetry", () => {
    const selector = new TouchdownAirportSelector();
    const airborne = { connected: true, hasPosition: true, isStale: false, onGround: false };
    const landed = { connected: true, hasPosition: true, isStale: false, onGround: true };

    selector.observe(airborne, "VHHH");
    expect(selector.observe(landed, "VHHH")).toBe("VHHH");
    selector.observe(airborne, "RJTT");
    selector.observe(
      { connected: false, hasPosition: false, isStale: true, onGround: true },
      "RJTT"
    );
    expect(selector.observe(landed, "RJTT")).toBeNull();
    selector.observe(airborne, "RJTT");
    expect(selector.observe(landed, "RJTT")).toBe("RJTT");
  });
});
