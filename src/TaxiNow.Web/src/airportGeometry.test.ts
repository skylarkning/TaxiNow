import { describe, expect, it } from "vitest";
import type { AirportFeature } from "./contracts";
import {
  calculateFeatureBounds,
  filterAirportFeatures
} from "./airportGeometry";

function feature(
  id: string,
  kind: AirportFeature["kind"],
  points: [number, number][]
): AirportFeature {
  return {
    id,
    kind,
    points,
    ref: null,
    name: null,
    widthMeters: null,
    headingDegrees: null,
    closed: false,
    source: "OpenStreetMap"
  };
}

describe("airport geometry filtering", () => {
  it("removes isolated KLGA and KDCA-style facilities", () => {
    const center: [number, number] = [-77.037697, 38.8521];
    const features = [
      feature("runway", "runway", [
        [-77.045, 38.843],
        [-77.035, 38.862]
      ]),
      feature("terminal", "terminal", [
        [-77.041, 38.849],
        [-77.039, 38.851],
        [-77.041, 38.849]
      ]),
      feature("marine-one", "hangar", [
        [-77.0145, 38.8528],
        [-77.0135, 38.8534],
        [-77.0145, 38.8528]
      ]),
      feature("remote-taxiway", "taxiway", [
        [-76.993, 38.866],
        [-76.992, 38.867]
      ])
    ];

    const selected = filterAirportFeatures(features, center);

    expect(selected.map((item) => item.id)).toEqual([
      "runway",
      "terminal"
    ]);
  });

  it("keeps a ZBAA-style terminal complex connected beyond the runway buffer", () => {
    const center: [number, number] = [116.596702, 40.077349];
    const features = [
      feature("runway-west", "runway", [
        [116.59, 40.05],
        [116.59, 40.105]
      ]),
      feature("runway-east", "runway", [
        [116.62, 40.05],
        [116.62, 40.105]
      ]),
      feature("connector-a", "taxiway", [
        [116.602, 40.075],
        [116.606, 40.075]
      ]),
      feature("connector-b", "taxiway", [
        [116.606, 40.075],
        [116.611, 40.075]
      ]),
      feature("terminal-3", "terminal", [
        [116.611, 40.0745],
        [116.616, 40.0745],
        [116.616, 40.0755],
        [116.611, 40.0755],
        [116.611, 40.0745]
      ]),
      feature("unrelated-heliport", "hangar", [
        [116.65, 40.12],
        [116.651, 40.12],
        [116.651, 40.121],
        [116.65, 40.12]
      ])
    ];

    const selected = filterAirportFeatures(
      features,
      center,
      1_000,
      100
    );

    expect(selected.map((item) => item.id)).toEqual([
      "runway-west",
      "runway-east",
      "connector-a",
      "connector-b",
      "terminal-3"
    ]);
  });

  it("calculates fit bounds from the retained airport cluster", () => {
    const center: [number, number] = [-73.872597, 40.777199];
    const selected = [
      feature("runway", "runway", [
        [-73.89, 40.765],
        [-73.86, 40.785]
      ]),
      feature("terminal", "terminal", [
        [-73.88, 40.77],
        [-73.87, 40.78]
      ])
    ];

    const bounds = calculateFeatureBounds(selected, center);

    expect(bounds.minLon).toBeGreaterThan(-73.9);
    expect(bounds.maxLon).toBeLessThan(-73.85);
    expect(bounds.minLat).toBeGreaterThan(40.75);
    expect(bounds.maxLat).toBeLessThan(40.8);
  });
});
