import { describe, expect, it } from "vitest";
import {
  isTrafficSourceEnabled,
  resolveTrafficSource
} from "./trafficSource";

describe("traffic source selection", () => {
  it("migrates conflicting legacy settings to exactly one source", () => {
    const selected = resolveTrafficSource({
      vatsim: true,
      beyondAtc: true,
      sayIntentions: true
    });

    expect(selected).toBe("sayintentions");
    expect([
      isTrafficSourceEnabled(selected, "vatsim"),
      isTrafficSourceEnabled(selected, "beyondatc"),
      isTrafficSourceEnabled(selected, "sayintentions")
    ].filter(Boolean)).toHaveLength(1);
  });

  it("keeps BeyondATC when it is the newest available legacy source", () => {
    expect(resolveTrafficSource({
      vatsim: true,
      beyondAtc: true,
      sayIntentions: false
    })).toBe("beyondatc");
  });

  it("returns no source when all traffic overlays are disabled", () => {
    expect(resolveTrafficSource({
      vatsim: false,
      beyondAtc: false,
      sayIntentions: false
    })).toBeNull();
  });
});
