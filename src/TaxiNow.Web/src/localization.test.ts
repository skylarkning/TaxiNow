import { describe, expect, it } from "vitest";
import {
  getTranslationKeys,
  normalizeSimplifiedChineseText
} from "./localization";

describe("application localization", () => {
  it("keeps French and German translation catalogs complete", () => {
    const englishKeys = getTranslationKeys("en");
    expect(getTranslationKeys("fr")).toEqual(englishKeys);
    expect(getTranslationKeys("de")).toEqual(englishKeys);
    expect(getTranslationKeys("zh-Hans")).toEqual(englishKeys);
  });

  it("removes layout whitespace between Simplified Chinese characters", () => {
    expect(
      normalizeSimplifiedChineseText(
        "如果机场航站楼\n  缺失， 请先删除并重新下载。"
      )
    ).toBe("如果机场航站楼缺失，请先删除并重新下载。");
  });

  it("preserves intended spacing around Latin names in Chinese text", () => {
    expect(
      normalizeSimplifiedChineseText("请查看 OpenStreetMap 数据源")
    ).toBe("请查看 OpenStreetMap 数据源");
  });
});
