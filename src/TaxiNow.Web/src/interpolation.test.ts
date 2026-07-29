import { describe, expect, it } from "vitest";
import { interpolateHeading } from "./interpolation";

describe("interpolateHeading", () => {
  it("uses the shortest arc across north", () => {
    expect(interpolateHeading(359, 1, 0.5)).toBeCloseTo(0);
  });

  it("normalizes negative headings", () => {
    expect(interpolateHeading(-10, 10, 0.5)).toBeCloseTo(0);
  });
});

