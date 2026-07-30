import type { AppLocale } from "./regionNames";

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
    "status.checking": "Checking MSFS 2024…",
    "status.reconnecting": "Reconnecting TaxiNow…",
    "status.lost": "TaxiNow connection lost.",
    "status.synced": "Position in sync with MSFS.",
    "status.simulatorStopped": "Simulator is not running.",
    "status.flightStopped": "Flight is not started.",
    "status.refreshing": "Refreshing aircraft position…",
    "status.refreshFailed": "Unable to refresh aircraft position.",
    "actions.assets": "Maps & storage",
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
    "download.parallelRecommended": "4 (recommended)",
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
    "status.checking": "正在检查 MSFS 2024…",
    "status.reconnecting": "正在重新连接 TaxiNow…",
    "status.lost": "TaxiNow 连接已断开。",
    "status.synced": "位置已与 MSFS 同步。",
    "status.simulatorStopped": "模拟器未运行。",
    "status.flightStopped": "飞行尚未开始。",
    "status.refreshing": "正在刷新飞机位置…",
    "status.refreshFailed": "无法刷新飞机位置。",
    "actions.assets": "地图与存储",
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
    "download.parallelRecommended": "4（推荐）",
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
  }
};

let currentLocale: AppLocale = "en";

function storedLocale(): AppLocale {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "zh-Hans"
      ? "zh-Hans"
      : "en";
  } catch {
    return "en";
  }
}

export function getLocale(): AppLocale {
  return currentLocale;
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
