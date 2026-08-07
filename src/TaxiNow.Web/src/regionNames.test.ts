import { describe, expect, it } from "vitest";
import { formatCountryName, formatRegionName } from "./regionNames";

describe("downloaded asset region names", () => {
  it("shows Chinese province names instead of ISO subdivision codes", () => {
    expect(formatRegionName("CN-11", "en")).toBe("Beijing");
    expect(formatRegionName("CN-11", "zh-Hans")).toBe("北京市");
    expect(formatRegionName("CN-71", "zh-Hant")).toBe("臺灣地區");
  });

  it("shows Japanese prefecture names in both languages", () => {
    expect(formatRegionName("JP-13", "en")).toBe("Tokyo");
    expect(formatRegionName("JP-13", "zh-Hans")).toBe("东京都");
    expect(formatRegionName("JP-13", "ja")).toBe("東京都");
  });

  it("keeps unknown subdivision codes and resolves country names", () => {
    expect(formatRegionName("CA-ON", "en")).toBe("CA-ON");
    expect(formatCountryName("CN", "en")).toBe("China");
    expect(formatCountryName("JP", "zh-Hans")).toBe("日本");
  });
});
