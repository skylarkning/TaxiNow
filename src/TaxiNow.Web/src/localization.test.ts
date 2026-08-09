import { describe, expect, it } from "vitest";
import {
  getTranslationKeys,
  normalizeSimplifiedChineseText
} from "./localization";
import { extendedTranslations } from "./localization.extended";

describe("application localization", () => {
  it("keeps every translation catalog complete", () => {
    const englishKeys = getTranslationKeys("en");
    expect(getTranslationKeys("fr")).toEqual(englishKeys);
    expect(getTranslationKeys("de")).toEqual(englishKeys);
    expect(getTranslationKeys("zh-Hans")).toEqual(englishKeys);
    expect(getTranslationKeys("zh-Hant")).toEqual(englishKeys);
    expect(getTranslationKeys("ja")).toEqual(englishKeys);
    expect(getTranslationKeys("ko")).toEqual(englishKeys);
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

  it("preserves the approved English NavApron FAQ wording verbatim", () => {
    expect(extendedTranslations.en["faq.navapron.q"]).toBe(
      'There is another app called "NavApron" that looks so similar to TaxiNow; is NavApron related to TaxiNow?/Did you develop NavApron?'
    );
    expect(extendedTranslations.en["faq.navapron.a1"]).toBe(
      "No. I did not develop NavApron, and I have not authorized anyone to create a work derived from TaxiNow. To my knowledge, NavApron appeared within a week of TaxiNow V1.0 Beta and within four days of TaxiNow V1.1. It is understood that timing and appearance alone cannot prove how another product was developed."
    );
    expect(extendedTranslations.en["faq.navapron.a2"]).toBe(
      "However, the unusually close timing, similar UI/UX, apparently AI-generated features, OSM data query and processing logic, and prototype artifacts resembling issues I manually corrected in TaxiNow, including overlapping taxiway markers and level-of-detail transitions, give me reason to suspect that TaxiNow may have been used as a reference for a distilled or derivative work. That is my assessment, not a verified finding. NavApron also places prominent, visually disruptive donation buttons in its main interface. I otherwise have no comment on that project."
    );
    expect(extendedTranslations.en["faq.navapron.a3"]).toBe(
      "TaxiNow remains copyrighted software despite being free. It may not be copied, derived from, reverse engineered, or supplied to AI tools for distillation. If you want to build a better tool using methods or technology demonstrated in TaxiNow, contact me through GitHub. I am willing to discuss parts of my methodology when proper credit is given. Commercial use, including soliciting donations, is strictly prohibited for any work using TaxiNow code, assets, or protected technology. I have invested substantial time and resources in creating TaxiNow as freeware, and I ask other developers to respect that work and contact me directly before attempting to reuse it."
    );
  });
});
