import type { AppLocale } from "./regionNames";
import {
  frenchTranslations,
  germanTranslations
} from "./localization.fr-de";
import { extendedTranslations } from "./localization.extended";

const STORAGE_KEY = "taxinow.language";

const translations: Record<AppLocale, Record<string, string>> = {
  en: {
    "airport.loading": "Loading airport…",
    "airport.select": "Select airport map",
    "airport.search": "Search airport ICAO",
    "airport.searchPlaceholder": "Enter ICAO, e.g. CYUL",
    "airport.download": "Download map",
    "airport.noInstalled": "No downloaded airports match this search.",
    "airport.noMatch": "No matching downloaded airport.",
    "airport.searchHint": "Search by ICAO code or airport name.",
    "airport.starting": "Starting {icao} download…",
    "airport.downloading": "{icao} is downloading. It will open automatically when ready.",
    "airport.installed": "{icao} is installed and displayed.",
    "access.finding": "Access at: finding address…",
    "access.at": "Access at: {address}",
    "access.title": "Open TaxiNow from another device on this network: {addresses}",
    "access.helpAria": "How to access TaxiNow on another device",
    "status.connecting": "Connecting",
    "status.checking": "Checking Microsoft Flight Simulator…",
    "status.reconnecting": "Reconnecting TaxiNow…",
    "status.lost": "TaxiNow connection lost.",
    "status.synced": "Position in sync with MSFS.",
    "status.simulatorStopped": "Simulator is not running.",
    "status.flightStopped": "Flight is not started.",
    "status.refreshing": "Refreshing aircraft position…",
    "status.refreshFailed": "Unable to refresh aircraft position.",
    "actions.assets": "Maps & storage",
    "taxi.open": "Plan Taxi",
    "taxi.eyebrow": "Ground navigation",
    "taxi.title": "Plan Taxi",
    "taxi.close": "Close taxi planner",
    "taxi.panelAria": "Taxi route planner",
    "taxi.where": "Where are you taxiing?",
    "taxi.toRunway": "To a runway",
    "taxi.toGate": "To a gate or stand",
    "taxi.runway": "Choose runway",
    "taxi.gate": "Enter gate or stand",
    "taxi.gatePlaceholder": "e.g. 105 or B19",
    "taxi.find": "Find taxi routes",
    "taxi.routes": "Route options",
    "taxi.empty": "Choose a destination to calculate taxi routes.",
    "taxi.start": "Start guidance",
    "taxi.end": "End",
    "taxi.clear": "Clear route",
    "taxi.advisory": "Advisory only. Follow ATC instructions and airport signage.",
    "taxi.needPosition": "Start the simulator and wait for a synchronized ground position before planning.",
    "taxi.chooseGate": "Enter a gate or stand available at this airport.",
    "taxi.noNetwork": "No connected taxiway route could be found for this destination.",
    "taxi.found": "Found {count} route option(s). Select one to preview it in blue.",
    "taxi.option": "Option {number}",
    "taxi.recommended": "Recommended",
    "taxi.distance": "{distance} · {minutes} min",
    "taxi.guidanceStarted": "Taxi guidance started.",
    "taxi.turnLeft": "Turn left on {taxiway} in {distance}",
    "taxi.turnRight": "Turn right on {taxiway} in {distance}",
    "taxi.continueOn": "Continue onto {taxiway} in {distance}",
    "taxi.continueTo": "Continue to {destination}",
    "taxi.arrive": "Arriving at {destination}",
    "taxi.offRoute": "Off route by {distance}. Recalculate if needed.",
    "taxi.remaining": "{distance} remaining",
    "taxi.completed": "Taxi route completed.",
    "taxi.customToggle": "Enter Customized Taxi Route (Experimental)",
    "taxi.customLabel": "Customized taxi route",
    "taxi.customHelpAria": "Customized taxi route format",
    "taxi.customHelp": "Enter comma-separated taxiways and finish with a runway or gate. Example: D, E, H, T1, RWY01L. Gate example: A, B, GATE B19. Names must match this airport map.",
    "taxi.customPlaceholder": "D, E, H, T1, RWY01L",
    "taxi.customPreview": "Preview customized route",
    "taxi.customOption": "Customized route",
    "taxi.customExperimental": "Experimental",
    "taxi.customNeedFormat": "Enter at least one taxiway followed by a destination, separated by commas.",
    "taxi.customBadDestination": "The final item must be an available runway (RWY01L) or gate (GATE B19).",
    "taxi.customUnknown": "Not found on this airport map: {items}.",
    "taxi.customDidYouMean": " Suggested correction: {route}.",
    "taxi.customNoPath": "These taxiways do not form a connected route in that order. Check the sequence or use automatic route finding.",
    "taxi.customReady": "Customized route is valid and highlighted in blue.",
    "taxi.customApplyFix": "Use suggested correction",
    "taxi.customAuto": "Find route automatically",
    "actions.language": "中文",
    "actions.languageAria": "Choose language",
    "actions.languageMenu": "Language",
    "actions.about": "About",
    "panel.offlineMaps": "Offline maps",
    "panel.title": "Maps & storage",
    "panel.close": "Close map manager",
    "download.by": "Download by",
    "download.modeIcao": "Airport ICAO",
    "download.modeRegion": "Country/region or province/state",
    "download.icao": "ICAO code",
    "download.country": "Country/Region",
    "download.countryInfo": "Where to find two-letter country or region codes",
    "download.region": "Province/State (optional)",
    "download.parallel": "Maximum parallel downloads",
    "download.parallelInfo": "About parallel map downloads",
    "download.parallelRecommended": "1 (recommended for OSM)",
    "download.start": "Download map",
    "download.activity": "Download activity",
    "download.clear": "Clear finished",
    "download.refresh": "Refresh",
    "download.empty": "No downloads in this session.",
    "download.helpLabel": "Why can map downloads be slow?",
    "download.helpAria": "About map download speed and timeouts",
    "download.typical": "Typical: 5–30 seconds",
    "download.busy": "Busy or complex airport: 30–90 seconds",
    "download.rate": "There is no fixed MB/s: OSM server processing usually takes longer than transferring the response. Once bytes begin arriving, transfer normally completes within a few seconds.",
    "download.osmLimit": "TaxiNow stops waiting for OSM after 120 seconds and then tries fallback sources. A complete airport normally finishes or fails within about 3 minutes.",
    "download.normal": "An animated bar with “server processing” is normal while OSM is calculating the map. TaxiNow marks the job Stalled when no meaningful progress is seen for 45 seconds, and Failed only after all sources fail.",
    "storage.title": "Downloaded Asset",
    "storage.location": "Downloaded maps location",
    "storage.finding": "Finding location…",
    "storage.note": "This setting is available in the Windows app only.",
    "storage.change": "Change folder",
    "storage.maps": "TaxiNow maps",
    "storage.free": "Disk free",
    "storage.airports": "Airports",
    "storage.loading": "Loading downloaded maps…",
    "storage.empty": "No maps have been downloaded yet.",
    "storage.newLocation": "New downloads and the asset catalog are stored here.",
    "storage.restartLocation": "Restart TaxiNow to finish moving the storage location.",
    "storage.delete": "Delete",
    "storage.deleteAirport": "Delete {icao}",
    "storage.deleteGroup": "Delete all",
    "storage.otherRegion": "Other",
    "storage.groupMeta": "{count} airports · {size}",
    "storage.confirmAirport": "Delete the downloaded map for {icao}?",
    "storage.confirmGroup": "Delete all {count} downloaded maps under {name}?",
    "storage.deleted": "Deleted {count} downloaded map(s).",
    "job.queued": "Queued",
    "job.running": "Running",
    "job.completed": "Completed",
    "job.failed": "Failed",
    "job.cancelled": "Cancelled",
    "job.stalled": "Stalled",
    "job.cancel": "Cancel",
    "job.active": "active",
    "job.waiting": "waiting for map source response · active for {elapsed}",
    "job.stalledDetail": "no meaningful source progress for {elapsed}; automatic timeout remains active",
    "job.waitingSource": "waiting for source",
    "job.warning": "Completed with {count} warning(s): {warning}",
    "job.airports": "{completed}/{total} airports",
    "job.parallel": "{count} parallel",
    "job.bytes": "{downloaded} / {total}",
    "job.remaining": "about {elapsed} remaining",
    "job.estimating": "estimating remaining time",
    "job.installed": "{size} installed",
    "job.downloadAria": "Download {percentage} complete",
    "job.waitingAria": "Download active; waiting for map source response",
    "job.queuedAria": "Download waiting to start",
    "phase.queued": "Queued",
    "phase.starting": "Starting",
    "phase.catalog": "Preparing airport catalog",
    "phase.downloadingCatalog": "Downloading airport catalog",
    "phase.acquiring": "Acquiring",
    "phase.waitingForMapSource": "OSM server processing",
    "phase.downloadingMap": "Downloading OSM response",
    "phase.downloadingMapPack": "Downloading verified regional map pack",
    "phase.normalizingMap": "Building airport map",
    "phase.waitingForFallbackSource": "Waiting for fallback source",
    "phase.downloadingFallback": "Downloading fallback source",
    "phase.readingCache": "Reading cache",
    "phase.finalizingMap": "Finalizing map",
    "phase.importing": "Installing map",
    "phase.completed": "Completed",
    "phase.failed": "Failed",
    "phase.cancelled": "Cancelled",
    "welcome.dismiss": "Do not show again",
    "welcome.enter": "Enter TaxiNow",
    "about.title": "About",
    "about.info": "Application information",
    "about.close": "Close About TaxiNow",
    "footer.disclaimer": "Flight simulation use only — not for real-world navigation.",
    "footer.fixture": "Bundled TaxiNow fixture",
    "map.aria": "TaxiNow airport map",
    "map.summary": "Offline vector map · {runways} runways · {taxiways} taxiways · {stands} stands",
    "map.fit": "Fit airport",
    "map.refresh": "Force refresh aircraft position",
    "map.zoomIn": "Zoom in",
    "map.zoomOut": "Zoom out",
    "map.compass": "Map rotation: drag to rotate; click to reset north",
    "error.noMaps": "No airport maps are downloaded.",
    "error.mapLoad": "Map failed to load.",
    "error.request": "Request failed ({status}).",
    "error.country": "Enter a two-letter Country/Region code.",
    "error.region": "Province/State code must begin with {country}-.",
    "feedback.queued": "Queuing {scope}…",
    "feedback.downloadQueued": "Download queued.",
    "feedback.cleared": "Finished download activity cleared."
  },
  "zh-Hans": {
    "airport.loading": "正在加载机场…",
    "airport.select": "选择机场地图",
    "airport.search": "搜索机场 ICAO",
    "airport.searchPlaceholder": "输入 ICAO，例如 ZBAA",
    "airport.download": "下载地图",
    "airport.noInstalled": "没有符合搜索条件的已下载机场。",
    "airport.noMatch": "没有匹配的已下载机场。",
    "airport.searchHint": "可按 ICAO 或机场名称搜索。",
    "airport.starting": "正在开始下载 {icao}…",
    "airport.downloading": "{icao} 正在下载，完成后会自动打开。",
    "airport.installed": "{icao} 已安装并显示。",
    "access.finding": "访问地址：正在查找…",
    "access.at": "访问地址：{address}",
    "access.title": "在同一网络的其他设备打开 TaxiNow：{addresses}",
    "access.helpAria": "如何在其他设备上访问 TaxiNow",
    "status.connecting": "正在连接",
    "status.checking": "正在检查 Microsoft Flight Simulator…",
    "status.reconnecting": "正在重新连接 TaxiNow…",
    "status.lost": "TaxiNow 连接已断开。",
    "status.synced": "位置已与 MSFS 同步。",
    "status.simulatorStopped": "模拟器未运行。",
    "status.flightStopped": "飞行尚未开始。",
    "status.refreshing": "正在刷新飞机位置…",
    "status.refreshFailed": "无法刷新飞机位置。",
    "actions.assets": "地图与存储",
    "taxi.open": "规划滑行",
    "taxi.eyebrow": "地面导航",
    "taxi.title": "规划滑行",
    "taxi.close": "关闭滑行规划",
    "taxi.panelAria": "滑行路线规划器",
    "taxi.where": "准备滑行到哪里？",
    "taxi.toRunway": "前往跑道",
    "taxi.toGate": "前往登机口或机位",
    "taxi.runway": "选择跑道",
    "taxi.gate": "输入登机口或机位",
    "taxi.gatePlaceholder": "例如 105 或 B19",
    "taxi.find": "查找滑行路线",
    "taxi.routes": "路线方案",
    "taxi.empty": "选择目的地以计算滑行路线。",
    "taxi.start": "开始引导",
    "taxi.end": "结束",
    "taxi.clear": "清除路线",
    "taxi.advisory": "仅供辅助参考，请始终遵守 ATC 指令和机场标志。",
    "taxi.needPosition": "请启动模拟器，并等待地面位置同步后再规划路线。",
    "taxi.chooseGate": "请输入本机场可用的登机口或机位。",
    "taxi.noNetwork": "无法找到通往该目的地的连通滑行道路线。",
    "taxi.found": "已找到 {count} 个路线方案；选择后将在地图上以蓝色预览。",
    "taxi.option": "方案 {number}",
    "taxi.recommended": "推荐",
    "taxi.distance": "{distance} · 约 {minutes} 分钟",
    "taxi.guidanceStarted": "滑行引导已开始。",
    "taxi.turnLeft": "{distance} 后左转进入 {taxiway}",
    "taxi.turnRight": "{distance} 后右转进入 {taxiway}",
    "taxi.continueOn": "{distance} 后继续进入 {taxiway}",
    "taxi.continueTo": "继续前往 {destination}",
    "taxi.arrive": "即将到达 {destination}",
    "taxi.offRoute": "已偏离路线 {distance}，必要时请重新规划。",
    "taxi.remaining": "剩余 {distance}",
    "taxi.completed": "滑行路线已完成。",
    "taxi.customToggle": "输入自定义滑行路线（实验性）",
    "taxi.customLabel": "自定义滑行路线",
    "taxi.customHelpAria": "自定义滑行路线格式",
    "taxi.customHelp": "请使用逗号分隔滑行道，并以跑道或机位结束。例如：D, E, H, T1, RWY01L。前往机位示例：A, B, GATE B19。名称必须与当前机场地图一致。",
    "taxi.customPlaceholder": "D, E, H, T1, RWY01L",
    "taxi.customPreview": "预览自定义路线",
    "taxi.customOption": "自定义路线",
    "taxi.customExperimental": "实验性",
    "taxi.customNeedFormat": "请至少输入一条滑行道和一个目的地，并使用逗号分隔。",
    "taxi.customBadDestination": "最后一项必须是当前机场可用的跑道（RWY01L）或机位（GATE B19）。",
    "taxi.customUnknown": "当前机场地图中未找到：{items}。",
    "taxi.customDidYouMean": " 建议修正为：{route}。",
    "taxi.customNoPath": "这些滑行道无法按输入顺序组成连通路线。请检查顺序，或使用自动路线规划。",
    "taxi.customReady": "自定义路线有效，已在地图上以蓝色高亮。",
    "taxi.customApplyFix": "采用建议修正",
    "taxi.customAuto": "自动查找路线",
    "actions.language": "EN",
    "actions.languageAria": "选择语言",
    "actions.languageMenu": "语言",
    "actions.about": "关于",
    "panel.offlineMaps": "离线地图",
    "panel.title": "地图与存储",
    "panel.close": "关闭地图管理器",
    "download.by": "下载方式",
    "download.modeIcao": "机场 ICAO",
    "download.modeRegion": "国家/地区或省/州",
    "download.icao": "ICAO 代码",
    "download.country": "国家/地区",
    "download.countryInfo": "如何查找两位国家或地区代码",
    "download.region": "省/州（可选）",
    "download.parallel": "最大并行下载数",
    "download.parallelInfo": "关于并行地图下载",
    "download.parallelRecommended": "1（OSM 推荐）",
    "download.start": "下载地图",
    "download.activity": "下载活动",
    "download.clear": "清除已完成",
    "download.refresh": "刷新",
    "download.empty": "本次运行暂无下载任务。",
    "download.helpLabel": "为什么地图下载可能较慢？",
    "download.helpAria": "关于地图下载速度和超时",
    "download.typical": "通常：5–30 秒",
    "download.busy": "繁忙或复杂机场：30–90 秒",
    "download.rate": "下载速度没有固定的 MB/s：主要等待时间通常来自 OSM 服务器计算，而不是文件传输。开始接收数据后，传输通常会在数秒内完成。",
    "download.osmLimit": "TaxiNow 等待 OSM 最长 120 秒，之后会尝试后备来源。一个机场通常会在约 3 分钟内完成或明确失败。",
    "download.normal": "OSM 正在计算地图且尚未返回数据时，动态进度条和“服务器处理中”属于正常现象。若 45 秒没有有效进展，任务会标记为“疑似卡住”；只有全部来源都失败后才会显示“失败”。",
    "storage.title": "已下载资源",
    "storage.location": "已下载地图位置",
    "storage.finding": "正在查找位置…",
    "storage.note": "此设置仅在 Windows 客户端中可用。",
    "storage.change": "更改文件夹",
    "storage.maps": "TaxiNow 地图",
    "storage.free": "磁盘剩余",
    "storage.airports": "机场数量",
    "storage.loading": "正在加载已下载地图…",
    "storage.empty": "尚未下载任何地图。",
    "storage.newLocation": "新下载内容和资源目录将保存在此处。",
    "storage.restartLocation": "请重启 TaxiNow 以完成存储位置迁移。",
    "storage.delete": "删除",
    "storage.deleteAirport": "删除 {icao}",
    "storage.deleteGroup": "全部删除",
    "storage.otherRegion": "其他",
    "storage.groupMeta": "{count} 个机场 · {size}",
    "storage.confirmAirport": "确定删除 {icao} 的已下载地图吗？",
    "storage.confirmGroup": "确定删除 {name} 下的全部 {count} 张已下载地图吗？",
    "storage.deleted": "已删除 {count} 张地图。",
    "job.queued": "排队中",
    "job.running": "进行中",
    "job.completed": "已完成",
    "job.failed": "失败",
    "job.cancelled": "已取消",
    "job.stalled": "疑似卡住",
    "job.cancel": "取消",
    "job.active": "活动中",
    "job.waiting": "等待地图来源响应 · 已进行 {elapsed}",
    "job.stalledDetail": "已有 {elapsed} 未出现有效来源进展；自动超时仍在运行",
    "job.waitingSource": "正在等待来源",
    "job.warning": "已完成，但有 {count} 条警告：{warning}",
    "job.airports": "{completed}/{total} 个机场",
    "job.parallel": "{count} 个并行任务",
    "job.bytes": "{downloaded} / {total}",
    "job.remaining": "预计还需约 {elapsed}",
    "job.estimating": "正在估算剩余时间",
    "job.installed": "已安装 {size}",
    "job.downloadAria": "下载完成 {percentage}",
    "job.waitingAria": "下载进行中，正在等待地图来源响应",
    "job.queuedAria": "下载等待开始",
    "phase.queued": "排队中",
    "phase.starting": "正在开始",
    "phase.catalog": "正在准备机场目录",
    "phase.downloadingCatalog": "正在下载机场目录",
    "phase.acquiring": "正在获取",
    "phase.waitingForMapSource": "OSM 服务器处理中",
    "phase.downloadingMap": "正在下载 OSM 响应",
    "phase.downloadingMapPack": "正在下载并校验地区地图包",
    "phase.normalizingMap": "正在生成机场地图",
    "phase.waitingForFallbackSource": "正在等待后备来源",
    "phase.downloadingFallback": "正在下载后备来源",
    "phase.readingCache": "正在读取缓存",
    "phase.finalizingMap": "正在完成地图",
    "phase.importing": "正在安装地图",
    "phase.completed": "已完成",
    "phase.failed": "失败",
    "phase.cancelled": "已取消",
    "welcome.dismiss": "不再显示",
    "welcome.enter": "进入 TaxiNow",
    "about.title": "关于",
    "about.info": "应用信息",
    "about.close": "关闭 TaxiNow 关于页面",
    "footer.disclaimer": "仅供模拟飞行使用——严禁用于真实导航。",
    "footer.fixture": "TaxiNow 内置示例",
    "map.aria": "TaxiNow 机场地图",
    "map.summary": "离线矢量地图 · {runways} 条跑道 · {taxiways} 条滑行道 · {stands} 个机位",
    "map.fit": "适配机场范围",
    "map.refresh": "强制刷新飞机位置",
    "map.zoomIn": "放大",
    "map.zoomOut": "缩小",
    "map.compass": "地图旋转：拖动以旋转；单击恢复朝北",
    "error.noMaps": "尚未下载机场地图。",
    "error.mapLoad": "地图加载失败。",
    "error.request": "请求失败（{status}）。",
    "error.country": "请输入两位国家/地区代码。",
    "error.region": "省/州代码必须以 {country}- 开头。",
    "feedback.queued": "正在将 {scope} 加入队列…",
    "feedback.downloadQueued": "下载任务已加入队列。",
    "feedback.cleared": "已清除完成的下载活动。"
  },
  fr: frenchTranslations,
  de: germanTranslations
};

for (const locale of Object.keys(translations) as AppLocale[]) {
  Object.assign(translations[locale], extendedTranslations[locale]);
}

let currentLocale: AppLocale = "en";

function storedLocale(): AppLocale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "zh-Hans" || stored === "fr" || stored === "de"
      ? stored
      : "en";
  } catch {
    return "en";
  }
}

export function getLocale(): AppLocale {
  return currentLocale;
}

export function getTranslationKeys(locale: AppLocale): string[] {
  return Object.keys(translations[locale]).sort();
}

export function t(
  key: string,
  values: Record<string, string | number> = {}
): string {
  let value = translations[currentLocale][key] ||
    translations.en[key] ||
    key;
  for (const [name, replacement] of Object.entries(values)) {
    value = value.replaceAll(`{${name}}`, String(replacement));
  }
  return value;
}

export function applyDocumentTranslations(): void {
  document.documentElement.lang = currentLocale;
  document.documentElement.dataset.locale = currentLocale;
  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n!);
  }
  for (
    const element of document.querySelectorAll<HTMLInputElement>(
      "[data-i18n-placeholder]"
    )
  ) {
    element.placeholder = t(element.dataset.i18nPlaceholder!);
  }
  for (
    const element of document.querySelectorAll<HTMLElement>(
      "[data-i18n-aria-label]"
    )
  ) {
    element.setAttribute(
      "aria-label",
      t(element.dataset.i18nAriaLabel!)
    );
  }
  for (
    const element of document.querySelectorAll<HTMLElement>(
      "[data-i18n-title]"
    )
  ) {
    element.title = t(element.dataset.i18nTitle!);
  }
  normalizeSimplifiedChineseSpacing(document);
}

const simplifiedChineseSpacing = new RegExp(
  "(?<=[\\p{Script=Han}\\u3000-\\u303f\\uff00-\\uffef])\\s+" +
  "(?=[\\p{Script=Han}\\u3000-\\u303f\\uff00-\\uffef])",
  "gu"
);

export function normalizeSimplifiedChineseText(value: string): string {
  return value.replace(simplifiedChineseSpacing, "");
}

function normalizeSimplifiedChineseSpacing(root: ParentNode): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.parentElement?.closest("[lang='zh-Hans'], .about-localized")) {
      node.textContent = normalizeSimplifiedChineseText(
        node.textContent ?? ""
      );
    }
    node = walker.nextNode();
  }
}

export function initializeLocalization(): void {
  currentLocale = storedLocale();
  applyDocumentTranslations();
}

export function setupLanguageSelector(): void {
  const button = document.querySelector<HTMLButtonElement>(
    "#language-selector"
  );
  const menu = document.querySelector<HTMLElement>("#language-menu");
  const picker = document.querySelector<HTMLElement>(".language-picker");
  if (!button || !menu || !picker) {
    return;
  }

  const options = Array.from(
    menu.querySelectorAll<HTMLButtonElement>("[data-language-option]")
  );
  const setOpen = (open: boolean): void => {
    menu.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  };
  for (const option of options) {
    const locale = option.dataset.languageOption as AppLocale;
    option.setAttribute("aria-checked", String(locale === currentLocale));
    option.addEventListener("click", () => {
      setOpen(false);
      if (locale === currentLocale) {
        button.focus();
        return;
      }
      try {
        window.localStorage.setItem(STORAGE_KEY, locale);
      } catch {
        // Reload still applies the selected language for this page below.
      }
      currentLocale = locale;
      window.location.reload();
    });
  }

  button.addEventListener("click", () => {
    const open = menu.hidden;
    setOpen(open);
    if (open) {
      options.find(
        (option) => option.dataset.languageOption === currentLocale
      )?.focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (!picker.contains(event.target as Node)) {
      setOpen(false);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || menu.hidden) {
      return;
    }
    setOpen(false);
    button.focus();
  });
}
