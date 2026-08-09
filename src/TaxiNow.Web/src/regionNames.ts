export type AppLocale = "en" | "zh-Hans" | "zh-Hant" | "ja" | "fr" | "de" | "ko";

type LocalizedRegionName = Partial<Record<AppLocale, string>> & {
  en: string;
  "zh-Hans": string;
};

const REGION_NAMES: Record<string, LocalizedRegionName> = {
  "CN-11": { en: "Beijing", "zh-Hans": "北京市" },
  "CN-12": { en: "Tianjin", "zh-Hans": "天津市" },
  "CN-13": { en: "Hebei", "zh-Hans": "河北省" },
  "CN-14": { en: "Shanxi", "zh-Hans": "山西省" },
  "CN-15": { en: "Inner Mongolia", "zh-Hans": "内蒙古自治区" },
  "CN-21": { en: "Liaoning", "zh-Hans": "辽宁省" },
  "CN-22": { en: "Jilin", "zh-Hans": "吉林省" },
  "CN-23": { en: "Heilongjiang", "zh-Hans": "黑龙江省" },
  "CN-31": { en: "Shanghai", "zh-Hans": "上海市" },
  "CN-32": { en: "Jiangsu", "zh-Hans": "江苏省" },
  "CN-33": { en: "Zhejiang", "zh-Hans": "浙江省" },
  "CN-34": { en: "Anhui", "zh-Hans": "安徽省" },
  "CN-35": { en: "Fujian", "zh-Hans": "福建省" },
  "CN-36": { en: "Jiangxi", "zh-Hans": "江西省" },
  "CN-37": { en: "Shandong", "zh-Hans": "山东省" },
  "CN-41": { en: "Henan", "zh-Hans": "河南省" },
  "CN-42": { en: "Hubei", "zh-Hans": "湖北省" },
  "CN-43": { en: "Hunan", "zh-Hans": "湖南省" },
  "CN-44": { en: "Guangdong", "zh-Hans": "广东省" },
  "CN-45": { en: "Guangxi", "zh-Hans": "广西壮族自治区" },
  "CN-46": { en: "Hainan", "zh-Hans": "海南省" },
  "CN-50": { en: "Chongqing", "zh-Hans": "重庆市" },
  "CN-51": { en: "Sichuan", "zh-Hans": "四川省" },
  "CN-52": { en: "Guizhou", "zh-Hans": "贵州省" },
  "CN-53": { en: "Yunnan", "zh-Hans": "云南省" },
  "CN-54": { en: "Tibet", "zh-Hans": "西藏自治区" },
  "CN-61": { en: "Shaanxi", "zh-Hans": "陕西省" },
  "CN-62": { en: "Gansu", "zh-Hans": "甘肃省" },
  "CN-63": { en: "Qinghai", "zh-Hans": "青海省" },
  "CN-64": { en: "Ningxia", "zh-Hans": "宁夏回族自治区" },
  "CN-65": { en: "Xinjiang", "zh-Hans": "新疆维吾尔自治区" },
  "CN-71": { en: "Taiwan", "zh-Hans": "台湾地区" },
  "CN-91": { en: "Hong Kong", "zh-Hans": "香港特别行政区" },
  "CN-92": { en: "Macao", "zh-Hans": "澳门特别行政区" },
  "JP-01": { en: "Hokkaido", "zh-Hans": "北海道" },
  "JP-02": { en: "Aomori", "zh-Hans": "青森县" },
  "JP-03": { en: "Iwate", "zh-Hans": "岩手县" },
  "JP-04": { en: "Miyagi", "zh-Hans": "宫城县" },
  "JP-05": { en: "Akita", "zh-Hans": "秋田县" },
  "JP-06": { en: "Yamagata", "zh-Hans": "山形县" },
  "JP-07": { en: "Fukushima", "zh-Hans": "福岛县" },
  "JP-08": { en: "Ibaraki", "zh-Hans": "茨城县" },
  "JP-09": { en: "Tochigi", "zh-Hans": "栃木县" },
  "JP-10": { en: "Gunma", "zh-Hans": "群马县" },
  "JP-11": { en: "Saitama", "zh-Hans": "埼玉县" },
  "JP-12": { en: "Chiba", "zh-Hans": "千叶县" },
  "JP-13": { en: "Tokyo", "zh-Hans": "东京都" },
  "JP-14": { en: "Kanagawa", "zh-Hans": "神奈川县" },
  "JP-15": { en: "Niigata", "zh-Hans": "新潟县" },
  "JP-16": { en: "Toyama", "zh-Hans": "富山县" },
  "JP-17": { en: "Ishikawa", "zh-Hans": "石川县" },
  "JP-18": { en: "Fukui", "zh-Hans": "福井县" },
  "JP-19": { en: "Yamanashi", "zh-Hans": "山梨县" },
  "JP-20": { en: "Nagano", "zh-Hans": "长野县" },
  "JP-21": { en: "Gifu", "zh-Hans": "岐阜县" },
  "JP-22": { en: "Shizuoka", "zh-Hans": "静冈县" },
  "JP-23": { en: "Aichi", "zh-Hans": "爱知县" },
  "JP-24": { en: "Mie", "zh-Hans": "三重县" },
  "JP-25": { en: "Shiga", "zh-Hans": "滋贺县" },
  "JP-26": { en: "Kyoto", "zh-Hans": "京都府" },
  "JP-27": { en: "Osaka", "zh-Hans": "大阪府" },
  "JP-28": { en: "Hyogo", "zh-Hans": "兵库县" },
  "JP-29": { en: "Nara", "zh-Hans": "奈良县" },
  "JP-30": { en: "Wakayama", "zh-Hans": "和歌山县" },
  "JP-31": { en: "Tottori", "zh-Hans": "鸟取县" },
  "JP-32": { en: "Shimane", "zh-Hans": "岛根县" },
  "JP-33": { en: "Okayama", "zh-Hans": "冈山县" },
  "JP-34": { en: "Hiroshima", "zh-Hans": "广岛县" },
  "JP-35": { en: "Yamaguchi", "zh-Hans": "山口县" },
  "JP-36": { en: "Tokushima", "zh-Hans": "德岛县" },
  "JP-37": { en: "Kagawa", "zh-Hans": "香川县" },
  "JP-38": { en: "Ehime", "zh-Hans": "爱媛县" },
  "JP-39": { en: "Kochi", "zh-Hans": "高知县" },
  "JP-40": { en: "Fukuoka", "zh-Hans": "福冈县" },
  "JP-41": { en: "Saga", "zh-Hans": "佐贺县" },
  "JP-42": { en: "Nagasaki", "zh-Hans": "长崎县" },
  "JP-43": { en: "Kumamoto", "zh-Hans": "熊本县" },
  "JP-44": { en: "Oita", "zh-Hans": "大分县" },
  "JP-45": { en: "Miyazaki", "zh-Hans": "宫崎县" },
  "JP-46": { en: "Kagoshima", "zh-Hans": "鹿儿岛县" },
  "JP-47": { en: "Okinawa", "zh-Hans": "冲绳县" }
};

const JAPANESE_PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"
];

const CHINESE_REGIONS_JA: Record<string, string> = {
  "CN-11": "北京市", "CN-12": "天津市", "CN-13": "河北省",
  "CN-14": "山西省", "CN-15": "内モンゴル自治区", "CN-21": "遼寧省",
  "CN-22": "吉林省", "CN-23": "黒竜江省", "CN-31": "上海市",
  "CN-32": "江蘇省", "CN-33": "浙江省", "CN-34": "安徽省",
  "CN-35": "福建省", "CN-36": "江西省", "CN-37": "山東省",
  "CN-41": "河南省", "CN-42": "湖北省", "CN-43": "湖南省",
  "CN-44": "広東省", "CN-45": "広西チワン族自治区", "CN-46": "海南省",
  "CN-50": "重慶市", "CN-51": "四川省", "CN-52": "貴州省",
  "CN-53": "雲南省", "CN-54": "チベット自治区", "CN-61": "陝西省",
  "CN-62": "甘粛省", "CN-63": "青海省", "CN-64": "寧夏回族自治区",
  "CN-65": "新疆ウイグル自治区", "CN-71": "台湾", "CN-91": "香港特別行政区",
  "CN-92": "マカオ特別行政区"
};

const traditionalRegionCharacters: Record<string, string> = {
  "东": "東", "广": "廣", "宁": "寧", "辽": "遼", "龙": "龍",
  "湾": "灣", "门": "門", "云": "雲", "贵": "貴", "陕": "陝",
  "肃": "肅", "内": "內", "区": "區", "县": "縣", "庆": "慶",
  "苏": "蘇", "浙": "浙", "赣": "贛", "壮": "壯", "维": "維",
  "尔": "爾", "台": "臺", "澳": "澳"
};

export function formatRegionName(
  code: string,
  locale: AppLocale
): string {
  const value = REGION_NAMES[code.toUpperCase()];
  if (locale === "ja" && /^JP-(\d{2})$/i.test(code)) {
    const index = Number(code.slice(3)) - 1;
    return JAPANESE_PREFECTURES[index] || value?.en || code;
  }
  if (locale === "ja" && CHINESE_REGIONS_JA[code.toUpperCase()]) {
    return CHINESE_REGIONS_JA[code.toUpperCase()]!;
  }
  if (locale === "zh-Hant" && value?.["zh-Hans"]) {
    return [...value["zh-Hans"]].map(
      (character) => traditionalRegionCharacters[character] ?? character
    ).join("");
  }
  return value?.[locale] || value?.en || code;
}

export function formatCountryName(
  code: string,
  locale: AppLocale
): string {
  try {
    return new Intl.DisplayNames(
      [{
        "zh-Hans": "zh-CN",
        "zh-Hant": "zh-TW",
        ja: "ja-JP",
        fr: "fr-FR",
        de: "de-DE",
        ko: "ko-KR",
        en: "en"
      }[locale]],
      { type: "region" }
    ).of(code.toUpperCase()) || code;
  } catch {
    return code;
  }
}
