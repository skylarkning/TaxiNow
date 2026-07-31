import { describe, expect, it } from "vitest";
import type { AirportFeature } from "./contracts";
import {
  buildRunwayDecorations,
  runwayEndDesignators
} from "./runwayGeometry";

const runway: AirportFeature = {
  id: "rwy-05-23",
  kind: "runway",
  points: [[-79.6656, 43.6711], [-79.5938, 43.6957]],
  ref: "05/23",
  name: null,
  widthMeters: 61,
  headingDegrees: 53,
  closed: false,
  source: "fixture"
};

describe("buildRunwayDecorations", () => {
  it("creates markings and one designator per runway end", () => {
    const result = buildRunwayDecorations([runway]);

    expect(result.labels.features.map((feature) => feature.properties?.text))
      .toEqual(["05", "23"]);
    expect(result.markings.features.some(
      (feature) => feature.properties?.kind === "centerline"
    )).toBe(true);
    expect(result.markings.features.filter(
      (feature) => feature.properties?.kind === "threshold"
    )).toHaveLength(2);
  });

  it("matches ZBAA runway designators to physical endpoints", () => {
    expect(runwayEndDesignators(
      "18L/36R",
      [116.6001269, 40.0554562],
      [116.5947729, 40.089469]
    )).toEqual(["36R", "18L"]);

    expect(runwayEndDesignators(
      "01/19",
      [116.6122697, 40.0928638],
      [116.6175833, 40.0588706]
    )).toEqual(["19", "01"]);
  });

  it("corrects mixed source ordering across ZGGG parallel runways", () => {
    expect(runwayEndDesignators(
      "02L/20R",
      [113.3143241, 23.40895],
      [113.3050003, 23.3757]
    )).toEqual(["20R", "02L"]);

    expect(runwayEndDesignators(
      "02R/20L",
      [113.3077131, 23.3694573],
      [113.3170013, 23.4027996]
    )).toEqual(["02R", "20L"]);
  });

  it("keeps a correctly ordered east-west runway unchanged", () => {
    expect(runwayEndDesignators(
      "09/27",
      [-80.0, 25.0],
      [-79.98, 25.0]
    )).toEqual(["09", "27"]);
  });

  it("uses numeric headings while preserving source annotations", () => {
    expect(runwayEndDesignators(
      "07/25(NOTINUSE)",
      [120.0, 30.0],
      [119.99, 29.99]
    )).toEqual(["25(NOTINUSE)", "07"]);
  });
});
