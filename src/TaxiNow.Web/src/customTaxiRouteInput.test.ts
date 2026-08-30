import { describe, expect, it } from "vitest";
import { parseCustomTaxiRouteInput } from "./customTaxiRouteInput";

describe("parseCustomTaxiRouteInput", () => {
  it("keeps the existing comma-separated format", () => {
    expect(parseCustomTaxiRouteInput("D, E, H, T1, RWY01L")).toEqual([
      "D",
      "E",
      "H",
      "T1",
      "RWY01L"
    ]);
  });

  it("accepts spaces as separators", () => {
    expect(parseCustomTaxiRouteInput("D E H T1 RWY01L")).toEqual([
      "D",
      "E",
      "H",
      "T1",
      "RWY01L"
    ]);
  });

  it("accepts mixed commas and whitespace", () => {
    expect(parseCustomTaxiRouteInput(" d,\te  H, t1   rwy01l ")).toEqual([
      "D",
      "E",
      "H",
      "T1",
      "RWY01L"
    ]);
  });

  it("preserves a final gate destination as one token", () => {
    expect(parseCustomTaxiRouteInput("A B GATE B19")).toEqual([
      "A",
      "B",
      "GATE B19"
    ]);
  });

  it("returns no tokens for empty input", () => {
    expect(parseCustomTaxiRouteInput("  ,  ")).toEqual([]);
  });
});
