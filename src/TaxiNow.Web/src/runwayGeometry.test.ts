import { describe, expect, it } from "vitest";
import type { AirportFeature } from "./contracts";
import { buildRunwayDecorations } from "./runwayGeometry";

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
});
