import {
  HubConnectionBuilder,
  LogLevel
} from "@microsoft/signalr";
import * as maplibregl from "maplibre-gl";
import type {
  GeoJSONSource,
  LngLatBoundsLike,
  Map as MapLibreMap
} from "maplibre-gl";
import type {
  Feature,
  FeatureCollection,
  Geometry,
  LineString,
  Point
} from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import { followAircraft } from './aircraftFollow';
import {
  setupFlightDeck,
  updateFlightDeckPosition,
  updateFlightPlanAirportStatus
} from "./flightDeck";
import {
  AirportDownloadStartGate,
  LatestAirportActivation,
  airportsNeedingDownload,
  normalizeIcao,
  normalizePlanAirports,
  type PlanAirportPair
} from "./flightPlanGround";
import type {
  AppStatus,
  AirportFeature,
  AirportMap,
  BeyondAtcTrafficAircraft,
  BeyondAtcTrafficResponse,
  DownloadJob,
  NearestAirportResponse,
  SayIntentionsTrafficAircraft,
  SayIntentionsTrafficResponse,
  StorageSummary,
  StoredMapAsset,
  TelemetrySnapshot,
  VatsimTrafficAircraft,
  VatsimTrafficResponse
} from "./contracts";
import {
  isTrafficSourceEnabled,
  resolveTrafficSource,
  type TrafficSource
} from "./trafficSource";
import {
  interpolateOwnship,
  isPointInsideBounds,
  type GeographicBounds,
  type InterpolatedOwnship
} from "./interpolation";
import {
  isSameOwnshipFrame,
  ownshipNeedsSynchronization
} from "./ownshipPresentation";
import { parseCustomTaxiRouteInput } from "./customTaxiRouteInput";
import {
  buildRunwayDecorations,
  runwayEndDesignators
} from "./runwayGeometry";
import {
  formatDownloadPercentage,
  isIndeterminateDownload,
  shouldShowDownloadEta
} from "./downloadPresentation";
import {
  calculateFeatureBounds,
  featureCounts,
  filterAirportFeatures
} from "./airportGeometry";
import { shouldIdentifyCurrentAirport } from "./airportAutoSelection";
import {
  getLocale,
  initializeLocalization,
  setupLanguageSelector,
  t
} from "./localization";
import {
  formatCountryName,
  formatRegionName
} from "./regionNames";
import {
  buildTaxiGraph,
  listConnectingTaxiwayRefs,
  listGateDestinations,
  listRunwayDestinations,
  listTaxiwayRefs,
  nearestStandLabel,
  planCustomTaxiRoute,
  planTaxiRoutes,
  suggestReferences,
  suggestTaxiwayRefs,
  updateTaxiRouteProgress,
  type Coordinate,
  type TaxiDestination,
  type TaxiGraph,
  type TaxiRoute
} from "./taxiRouting";

// Vite cannot infer MapLibre's runtime worker URL from the prebuilt module on
// every WebView/browser. Importing it as an asset ensures the worker is
// emitted and prevents the application from unnecessarily entering SVG
// fallback mode because `/assets/maplibre-gl-worker.mjs` was missing.
maplibregl.setWorkerUrl("/assets/maplibre-gl-worker.mjs");

const telemetrySamples: TelemetrySnapshot[] = [];
const lastAirportStorageKey = "taxinow.lastAirport";
const headingFollowStorageKey = "taxinow.map.headingFollow";
const themeStorageKey = "taxinow.theme";
const autoUpdateStorageKey = "taxinow.updates.autoCheck";
const updateCheckedAtStorageKey = "taxinow.updates.lastCheckedAt";
const vatsimTrafficStorageKey = "taxinow.map.vatsimTraffic";
const vatsimTrafficRefreshMilliseconds = 15_000;
const beyondAtcTrafficStorageKey = "taxinow.map.beyondAtcTraffic";
const beyondAtcTrafficRefreshMilliseconds = 1_000;
const sayIntentionsTrafficStorageKey = "taxinow.map.sayIntentionsTraffic";
const sayIntentionsTrafficRefreshMilliseconds = 1_000;
const airportDetectionIntervalMilliseconds = 15_000;
const aircraftPathData =
  "M0 -18 L4 -5 L16 2 L16 6 L4 4 L3 14 L8 18 L0 16 L-8 18 L-3 14 L-4 4 L-16 6 L-16 2 L-4 -5 Z";
let lastOwnshipFrameAt = 0;
let lastRenderedOwnship: InterpolatedOwnship | null = null;
let ownshipVisible = false;
let map: MapLibreMap;
let airportBounds: LngLatBoundsLike;
let airportPerimeter: GeographicBounds | null = null;
let ownshipAnimationStarted = false;
let ownshipMapSynchronized = false;
let fallbackOwnshipSynchronized = false;
let domOwnshipSynchronized = false;
let domOwnshipMarker: maplibregl.Marker | null = null;
let domOwnshipElement: HTMLElement | null = null;
let fallbackOwnship: SVGGElement | null = null;
let fallbackTaxiRouteCasing: SVGPolylineElement | null = null;
let fallbackTaxiRouteHighlight: SVGPolylineElement | null = null;
let fallbackTaxiwaySelectionGroup: SVGGElement | null = null;
let fallbackOverlayCleanup: (() => void) | null = null;
let fallbackOverlayRedraw: (() => void) | null = null;
let renderedTaxiRouteCoordinates: Coordinate[] = [];
let assetRefreshTimer: number | null = null;
let assetPanelOpen = false;
let installedAssets: StoredMapAsset[] = [];
let latestDownloadJobs: DownloadJob[] = [];
const flightPlanAirportIcaos = new Set<string>();
const airportInstallWaiters = new Map<string, Array<{
  resolve: () => void;
  reject: (error: Error) => void;
}>>();
const flightPlanDownloadStartGate = new AirportDownloadStartGate();
const latestAirportActivation = new LatestAirportActivation();
let selectedAirportIcao = "";
let pendingAirportIcao: string | null = null;
let pendingAirportActivation: { isCurrent: () => boolean } | null = null;
let mapInitialized = false;
let assetRefreshPromise: Promise<boolean> | null = null;
let activeDownloads = false;
let currentAirportMap: AirportMap | null = null;
let airportDetectionInFlight = false;
let lastAirportDetectionAt = Number.NEGATIVE_INFINITY;
let lastPromptedAirportIcao: string | null = null;
let automaticAirportSelectionSuspended = false;
let taxiGraph: TaxiGraph | null = null;
let taxiRunways: TaxiDestination[] = [];
let taxiGates: TaxiDestination[] = [];
let taxiRouteOptions: TaxiRoute[] = [];
let selectedTaxiRoute: TaxiRoute | null = null;
let activeTaxiRoute: TaxiRoute | null = null;
let activeTaxiSegmentIndex = 0;
let lastTaxiCameraAt = 0;
let headingFollowEnabled = readBooleanPreference(headingFollowStorageKey);
let pendingCustomTaxiCorrection: string | null = null;
let pendingCustomTaxiDestination: TaxiDestination | null = null;
let selectedTaxiwaySequence: string[] = [];
let manualTaxiStart: Coordinate | null = null;
let manualTaxiDestination: TaxiDestination | null = null;
let activeManualTaxiPopup: maplibregl.Popup | null = null;
let taxiwaySelectionAnimationFrame: number | null = null;
let lastTaxiwaySelectionPaintAt = 0;
let updateRelease: UpdateRelease | null = null;
let selectedTrafficSource: TrafficSource | null = resolveTrafficSource({
  vatsim: readBooleanPreference(vatsimTrafficStorageKey),
  beyondAtc: readBooleanPreference(beyondAtcTrafficStorageKey),
  sayIntentions: readBooleanPreference(sayIntentionsTrafficStorageKey)
});
let vatsimTrafficEnabled = selectedTrafficSource === "vatsim";
let vatsimTrafficRefreshTimer: number | null = null;
let vatsimTrafficRefreshInFlight = false;
const vatsimTrafficMarkers = new Map<string, maplibregl.Marker>();
let beyondAtcTrafficEnabled = selectedTrafficSource === "beyondatc";
let beyondAtcTrafficRefreshTimer: number | null = null;
let beyondAtcTrafficRefreshInFlight = false;
const beyondAtcTrafficMarkers = new Map<number, maplibregl.Marker>();
let sayIntentionsTrafficEnabled = selectedTrafficSource === "sayintentions";
let sayIntentionsTrafficRefreshTimer: number | null = null;
let sayIntentionsTrafficRefreshInFlight = false;
const sayIntentionsTrafficMarkers = new Map<string, maplibregl.Marker>();
const assetGroupOpenState = new Map<string, boolean>();
const downloadProgressWatch = new Map<
  string,
  { fingerprint: string; changedAt: number }
>();

interface DesktopWebViewBridge {
  postMessage(message: unknown): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void
  ): void;
}

interface DesktopStorageMessage {
  type: "storage-location";
  path: string;
  restartRequired: boolean;
}

interface DesktopWindowSettingsMessage {
  type: "window-settings";
  keepVisible: boolean;
  minimizeToTray: boolean;
}

interface DesktopIntegrationSettingsMessage {
  type: "integration-settings";
  vmasPresenceEnabled: boolean;
}

interface DesktopUpdateStatusMessage {
  type: "update-install:status";
  state: "downloading" | "launching" | "error";
  message: string;
}

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  digest?: string | null;
}

interface GitHubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  assets: GitHubReleaseAsset[];
}

interface UpdateRelease {
  version: string;
  build: number;
  changelog: string;
  pageUrl: string;
  installerUrl: string;
  digest: string | null;
}

function readLastAirport(): string | null {
  try {
    const value = window.localStorage.getItem(lastAirportStorageKey)
      ?.trim().toUpperCase();
    return value && /^[A-Z0-9]{3,5}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

function rememberLastAirport(icao: string): void {
  try {
    window.localStorage.setItem(lastAirportStorageKey, icao);
  } catch {
    // The current map remains usable when browser storage is unavailable.
  }
}

function readBooleanPreference(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeBooleanPreference(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Keep the setting for this session when storage is unavailable.
  }
}

async function start(): Promise<void> {
  setupLanguageSelector();
  setupThemeSelector();
  setupTrafficSourceSettings();
  setupResponsiveHeader();
  setupDesktopWindowSettings();
  setupDesktopIntegrationSettings();
  setupTaxiPlanner();
  setupAssetManager();
  setupAirportPicker();
  setupAboutDialog();
  setupWelcomeDialog();
  const appStatus = await getJson<AppStatus>("/api/v1/status");
  applyProductMetadata(appStatus);
  setupUpdateExperience(appStatus);
  const serverLink =
    document.querySelector<HTMLAnchorElement>("#server-url")!;
  serverLink.href = appStatus.localUrl;
  serverLink.textContent = `${t("flightdeck.mobile")}: ${appStatus.localUrl}`;
  serverLink.title = t("access.title", {
    addresses: appStatus.localUrls.join(", ")
  });
  if (!await refreshAssetManager()) {
    for (const icao of flightPlanAirportIcaos) {
      updateFlightPlanAirportStatus(icao, "failed");
    }
    return;
  }
  const lastAirport = readLastAirport();
  const initialIcao =
    lastAirport && installedAssets.some((asset) => asset.icao === lastAirport)
      ? lastAirport
      : installedAssets.some((asset) => asset.icao === appStatus.selectedAirport)
      ? appStatus.selectedAirport
      : installedAssets[0]?.icao;
  if (!initialIcao) {
    throw new Error(t("error.noMaps"));
  }
  await loadAirport(initialIcao);
  await connectTelemetry();
}

function setupThemeSelector(): void {
  const saved = (() => {
    try {
      return window.localStorage.getItem(themeStorageKey);
    } catch {
      return null;
    }
  })();
  const initial = saved === "dark" ? "dark" : "light";
  applyTheme(initial);

  const selector = document.querySelector<HTMLButtonElement>("#theme-selector");
  const menu = document.querySelector<HTMLElement>("#theme-menu");
  if (!selector || !menu) {
    return;
  }
  const options = Array.from(
    menu.querySelectorAll<HTMLButtonElement>("[data-theme-option]")
  );
  const quickToggle = document.querySelector<HTMLButtonElement>("#quick-theme-toggle");
  const sync = (theme: "dark" | "light"): void => {
    if (quickToggle) {
      quickToggle.dataset.currentTheme = theme;
      const label = t(theme === "dark" ? "settings.switchLight" : "settings.switchDark");
      quickToggle.setAttribute("aria-label", label);
      quickToggle.title = label;
    }
    for (const option of options) {
      option.setAttribute(
        "aria-checked",
        String(option.dataset.themeOption === theme)
      );
    }
  };
  const selectTheme = (theme: "dark" | "light"): void => {
    try { window.localStorage.setItem(themeStorageKey, theme); } catch { /* Keep the session usable. */ }
    applyTheme(theme);
    sync(theme);
    menu.hidden = true;
    selector.setAttribute("aria-expanded", "false");
  };
  quickToggle?.addEventListener("click", () => {
    selectTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });
  sync(initial);
  selector.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    selector.setAttribute("aria-expanded", String(open));
    document.querySelector<HTMLElement>("#language-menu")!.hidden = true;
  });
  for (const option of options) {
    option.addEventListener("click", () => {
      const theme = option.dataset.themeOption === "light" ? "light" : "dark";
      selectTheme(theme);
    });
  }
}

function applyTheme(theme: "dark" | "light"): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === "light" ? "only light" : "dark";
  document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
    ?.setAttribute("content", theme === "light" ? "only light" : "dark");
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "light" ? "#eaf2f6" : "#08111d");
  if (mapInitialized && typeof map !== "undefined" && map) {
    try {
      applyMapTheme(map, theme);
      map.triggerRepaint();
    } catch (error) {
      console.warn("TaxiNow Pro could not immediately update the map theme.", error);
    }
  }
}

function setupTrafficSourceSettings(): void {
  const entries: Array<[TrafficSource, string]> = [
    ["vatsim", "#show-vatsim-traffic"],
    ["beyondatc", "#show-beyondatc-traffic"],
    ["sayintentions", "#show-sayintentions-traffic"]
  ];
  for (const [source, selector] of entries) {
    const toggle = document.querySelector<HTMLButtonElement>(selector);
    if (!toggle) {
      continue;
    }
    toggle.addEventListener("click", () => {
      applyTrafficSource(selectedTrafficSource === source ? null : source);
    });
  }
  applyTrafficSource(selectedTrafficSource);
}

function applyTrafficSource(source: TrafficSource | null): void {
  selectedTrafficSource = source;
  vatsimTrafficEnabled = source === "vatsim";
  window.dispatchEvent(new CustomEvent("taxinow:vatsim-traffic-change", {
    detail: { enabled: vatsimTrafficEnabled }
  }));
  beyondAtcTrafficEnabled = source === "beyondatc";
  sayIntentionsTrafficEnabled = source === "sayintentions";
  writeBooleanPreference(vatsimTrafficStorageKey, vatsimTrafficEnabled);
  writeBooleanPreference(beyondAtcTrafficStorageKey, beyondAtcTrafficEnabled);
  writeBooleanPreference(
    sayIntentionsTrafficStorageKey,
    sayIntentionsTrafficEnabled
  );

  if (vatsimTrafficEnabled) {
    startVatsimTrafficPolling();
    void refreshVatsimTraffic();
  } else {
    stopVatsimTrafficPolling();
    clearVatsimTrafficMarkers();
  }
  if (beyondAtcTrafficEnabled) {
    startBeyondAtcTrafficPolling();
    void refreshBeyondAtcTraffic();
  } else {
    stopBeyondAtcTrafficPolling();
    clearBeyondAtcTrafficMarkers();
  }
  if (sayIntentionsTrafficEnabled) {
    startSayIntentionsTrafficPolling();
    void refreshSayIntentionsTraffic();
  } else {
    stopSayIntentionsTrafficPolling();
    clearSayIntentionsTrafficMarkers();
  }

  for (const [trafficSource, selector] of [
    ["vatsim", "#show-vatsim-traffic"],
    ["beyondatc", "#show-beyondatc-traffic"],
    ["sayintentions", "#show-sayintentions-traffic"]
  ] as Array<[TrafficSource, string]>) {
    document.querySelector<HTMLButtonElement>(selector)?.setAttribute(
      "aria-checked",
      String(isTrafficSourceEnabled(selectedTrafficSource, trafficSource))
    );
  }
}

function startVatsimTrafficPolling(): void {
  if (vatsimTrafficRefreshTimer !== null) {
    return;
  }
  vatsimTrafficRefreshTimer = window.setInterval(
    () => void refreshVatsimTraffic(),
    vatsimTrafficRefreshMilliseconds
  );
}

function stopVatsimTrafficPolling(): void {
  if (vatsimTrafficRefreshTimer === null) {
    return;
  }
  window.clearInterval(vatsimTrafficRefreshTimer);
  vatsimTrafficRefreshTimer = null;
}

async function refreshVatsimTraffic(): Promise<void> {
  if (!vatsimTrafficEnabled || !mapInitialized || !currentAirportMap ||
      vatsimTrafficRefreshInFlight) {
    return;
  }

  vatsimTrafficRefreshInFlight = true;
  const targetMap = map;
  const targetAirport = selectedAirportIcao;
  const bounds = currentAirportMap.airport.bounds;
  const longitudePadding = Math.max(
    (bounds.maxLon - bounds.minLon) * 0.15,
    0.01
  );
  const latitudePadding = Math.max(
    (bounds.maxLat - bounds.minLat) * 0.15,
    0.01
  );
  const query = new URLSearchParams({
    west: String(Math.max(-180, bounds.minLon - longitudePadding)),
    south: String(Math.max(-90, bounds.minLat - latitudePadding)),
    east: String(Math.min(180, bounds.maxLon + longitudePadding)),
    north: String(Math.min(90, bounds.maxLat + latitudePadding))
  });

  try {
    const response = await getJson<VatsimTrafficResponse>(
      `/api/v1/integrations/vatsim/traffic?${query}`
    );
    if (!vatsimTrafficEnabled || map !== targetMap ||
        selectedAirportIcao !== targetAirport) {
      return;
    }
    reconcileVatsimTrafficMarkers(response, targetMap);
  } catch (error) {
    console.warn("TaxiNow Pro could not refresh VATSIM traffic.", error);
  } finally {
    vatsimTrafficRefreshInFlight = false;
  }
}

function reconcileVatsimTrafficMarkers(
  response: VatsimTrafficResponse,
  targetMap: MapLibreMap
): void {
  const activeCallsigns = new Set<string>();
  for (const aircraft of response.aircraft) {
    activeCallsigns.add(aircraft.callsign);
    let marker = vatsimTrafficMarkers.get(aircraft.callsign);
    if (!marker) {
      marker = new maplibregl.Marker({
        element: createVatsimTrafficElement(aircraft, targetMap),
        anchor: "center",
        rotationAlignment: "viewport",
        pitchAlignment: "viewport",
        subpixelPositioning: true
      })
        .setLngLat([aircraft.longitude, aircraft.latitude])
        .addTo(targetMap);
      vatsimTrafficMarkers.set(aircraft.callsign, marker);
    }
    marker.setLngLat([aircraft.longitude, aircraft.latitude]);
    updateVatsimTrafficElement(marker.getElement(), aircraft, targetMap);
  }

  for (const [callsign, marker] of vatsimTrafficMarkers) {
    if (!activeCallsigns.has(callsign)) {
      marker.remove();
      vatsimTrafficMarkers.delete(callsign);
    }
  }
}

function createVatsimTrafficElement(
  aircraft: VatsimTrafficAircraft,
  targetMap: MapLibreMap
): HTMLElement {
  const namespace = "http://www.w3.org/2000/svg";
  const element = document.createElement("div");
  element.className = "vatsim-traffic-marker";
  element.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("class", "vatsim-traffic-icon");
  svg.setAttribute("viewBox", "-22 -22 44 44");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(namespace, "path");
  path.setAttribute("d", aircraftPathData);
  path.setAttribute("class", "vatsim-traffic-shape");
  svg.append(path);
  const label = document.createElement("span");
  label.className = "vatsim-traffic-label";
  element.append(svg, label);
  updateVatsimTrafficElement(element, aircraft, targetMap);
  return element;
}

function updateVatsimTrafficElement(
  element: HTMLElement,
  aircraft: VatsimTrafficAircraft,
  targetMap: MapLibreMap
): void {
  const type = aircraft.aircraftType ? ` · ${aircraft.aircraftType}` : "";
  element.title = `${aircraft.callsign}${type} · ${aircraft.altitudeFeet} ft · ${aircraft.groundSpeedKnots} kt`;
  element.dataset.headingDegrees = String(aircraft.headingDegrees);
  element.querySelector<HTMLElement>(".vatsim-traffic-label")!.textContent =
    aircraft.callsign;
  updateVatsimTrafficMarkerHeading(element, targetMap.getBearing());
}

function updateVatsimTrafficMarkerHeading(
  element: HTMLElement,
  mapBearingDegrees: number
): void {
  const headingDegrees = Number(element.dataset.headingDegrees ?? 0);
  element.style.setProperty(
    "--vatsim-screen-heading",
    `${headingDegrees - mapBearingDegrees}deg`
  );
}

function syncVatsimTrafficMarkerHeadings(targetMap: MapLibreMap): void {
  if (!mapInitialized || map !== targetMap) {
    return;
  }
  const bearing = targetMap.getBearing();
  for (const marker of vatsimTrafficMarkers.values()) {
    updateVatsimTrafficMarkerHeading(marker.getElement(), bearing);
  }
}

function clearVatsimTrafficMarkers(): void {
  for (const marker of vatsimTrafficMarkers.values()) {
    marker.remove();
  }
  vatsimTrafficMarkers.clear();
}

function startBeyondAtcTrafficPolling(): void {
  if (beyondAtcTrafficRefreshTimer !== null) {
    return;
  }
  beyondAtcTrafficRefreshTimer = window.setInterval(
    () => void refreshBeyondAtcTraffic(),
    beyondAtcTrafficRefreshMilliseconds
  );
}

function stopBeyondAtcTrafficPolling(): void {
  if (beyondAtcTrafficRefreshTimer === null) {
    return;
  }
  window.clearInterval(beyondAtcTrafficRefreshTimer);
  beyondAtcTrafficRefreshTimer = null;
}

async function refreshBeyondAtcTraffic(): Promise<void> {
  if (!beyondAtcTrafficEnabled || !mapInitialized || !currentAirportMap ||
      beyondAtcTrafficRefreshInFlight) {
    return;
  }

  beyondAtcTrafficRefreshInFlight = true;
  const targetMap = map;
  const targetAirport = selectedAirportIcao;
  const bounds = currentAirportMap.airport.bounds;
  const longitudePadding = Math.max(
    (bounds.maxLon - bounds.minLon) * 0.15,
    0.01
  );
  const latitudePadding = Math.max(
    (bounds.maxLat - bounds.minLat) * 0.15,
    0.01
  );
  const query = new URLSearchParams({
    west: String(Math.max(-180, bounds.minLon - longitudePadding)),
    south: String(Math.max(-90, bounds.minLat - latitudePadding)),
    east: String(Math.min(180, bounds.maxLon + longitudePadding)),
    north: String(Math.min(90, bounds.maxLat + latitudePadding))
  });

  try {
    const response = await getJson<BeyondAtcTrafficResponse>(
      `/api/v1/integrations/beyondatc/traffic?${query}`
    );
    if (!beyondAtcTrafficEnabled || map !== targetMap ||
        selectedAirportIcao !== targetAirport) {
      return;
    }
    if (!response.connected || response.isStale) {
      clearBeyondAtcTrafficMarkers();
      return;
    }
    reconcileBeyondAtcTrafficMarkers(response, targetMap);
  } catch (error) {
    console.warn("TaxiNow Pro could not refresh BeyondATC traffic.", error);
  } finally {
    beyondAtcTrafficRefreshInFlight = false;
  }
}

function reconcileBeyondAtcTrafficMarkers(
  response: BeyondAtcTrafficResponse,
  targetMap: MapLibreMap
): void {
  const activeObjectIds = new Set<number>();
  for (const aircraft of response.aircraft) {
    activeObjectIds.add(aircraft.objectId);
    let marker = beyondAtcTrafficMarkers.get(aircraft.objectId);
    if (!marker) {
      marker = new maplibregl.Marker({
        element: createBeyondAtcTrafficElement(aircraft, targetMap),
        anchor: "center",
        rotationAlignment: "viewport",
        pitchAlignment: "viewport",
        subpixelPositioning: true
      })
        .setLngLat([aircraft.longitude, aircraft.latitude])
        .addTo(targetMap);
      beyondAtcTrafficMarkers.set(aircraft.objectId, marker);
    }
    marker.setLngLat([aircraft.longitude, aircraft.latitude]);
    updateBeyondAtcTrafficElement(marker.getElement(), aircraft, targetMap);
  }

  for (const [objectId, marker] of beyondAtcTrafficMarkers) {
    if (!activeObjectIds.has(objectId)) {
      marker.remove();
      beyondAtcTrafficMarkers.delete(objectId);
    }
  }
}

function createBeyondAtcTrafficElement(
  aircraft: BeyondAtcTrafficAircraft,
  targetMap: MapLibreMap
): HTMLElement {
  const namespace = "http://www.w3.org/2000/svg";
  const element = document.createElement("div");
  element.className = "beyondatc-traffic-marker";
  element.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("class", "beyondatc-traffic-icon");
  svg.setAttribute("viewBox", "-22 -22 44 44");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(namespace, "path");
  path.setAttribute("d", aircraftPathData);
  path.setAttribute("class", "beyondatc-traffic-shape");
  svg.append(path);
  const label = document.createElement("span");
  label.className = "beyondatc-traffic-label";
  element.append(svg, label);
  updateBeyondAtcTrafficElement(element, aircraft, targetMap);
  return element;
}

function updateBeyondAtcTrafficElement(
  element: HTMLElement,
  aircraft: BeyondAtcTrafficAircraft,
  targetMap: MapLibreMap
): void {
  const type = aircraft.aircraftType ? ` · ${aircraft.aircraftType}` : "";
  element.title = `${aircraft.callsign}${type} · ${aircraft.altitudeFeet} ft · ${aircraft.groundSpeedKnots} kt`;
  element.dataset.headingDegrees = String(aircraft.headingDegrees);
  element.querySelector<HTMLElement>(".beyondatc-traffic-label")!.textContent =
    aircraft.callsign;
  updateBeyondAtcTrafficMarkerHeading(element, targetMap.getBearing());
}

function updateBeyondAtcTrafficMarkerHeading(
  element: HTMLElement,
  mapBearingDegrees: number
): void {
  const headingDegrees = Number(element.dataset.headingDegrees ?? 0);
  element.style.setProperty(
    "--beyondatc-screen-heading",
    `${headingDegrees - mapBearingDegrees}deg`
  );
}

function syncBeyondAtcTrafficMarkerHeadings(targetMap: MapLibreMap): void {
  if (!mapInitialized || map !== targetMap) {
    return;
  }
  const bearing = targetMap.getBearing();
  for (const marker of beyondAtcTrafficMarkers.values()) {
    updateBeyondAtcTrafficMarkerHeading(marker.getElement(), bearing);
  }
}

function clearBeyondAtcTrafficMarkers(): void {
  for (const marker of beyondAtcTrafficMarkers.values()) {
    marker.remove();
  }
  beyondAtcTrafficMarkers.clear();
}

function startSayIntentionsTrafficPolling(): void {
  if (sayIntentionsTrafficRefreshTimer !== null) {
    return;
  }
  sayIntentionsTrafficRefreshTimer = window.setInterval(
    () => void refreshSayIntentionsTraffic(),
    sayIntentionsTrafficRefreshMilliseconds
  );
}

function stopSayIntentionsTrafficPolling(): void {
  if (sayIntentionsTrafficRefreshTimer === null) {
    return;
  }
  window.clearInterval(sayIntentionsTrafficRefreshTimer);
  sayIntentionsTrafficRefreshTimer = null;
}

async function refreshSayIntentionsTraffic(): Promise<void> {
  if (!sayIntentionsTrafficEnabled || !mapInitialized ||
      !currentAirportMap || sayIntentionsTrafficRefreshInFlight) {
    return;
  }

  sayIntentionsTrafficRefreshInFlight = true;
  const targetMap = map;
  const targetAirport = selectedAirportIcao;
  const bounds = currentAirportMap.airport.bounds;
  const longitudePadding = Math.max(
    (bounds.maxLon - bounds.minLon) * 0.15,
    0.01
  );
  const latitudePadding = Math.max(
    (bounds.maxLat - bounds.minLat) * 0.15,
    0.01
  );
  const query = new URLSearchParams({
    west: String(Math.max(-180, bounds.minLon - longitudePadding)),
    south: String(Math.max(-90, bounds.minLat - latitudePadding)),
    east: String(Math.min(180, bounds.maxLon + longitudePadding)),
    north: String(Math.min(90, bounds.maxLat + latitudePadding))
  });

  try {
    const response = await getJson<SayIntentionsTrafficResponse>(
      `/api/v1/integrations/sayintentions/traffic?${query}`
    );
    if (!sayIntentionsTrafficEnabled || map !== targetMap ||
        selectedAirportIcao !== targetAirport) {
      return;
    }
    if (!response.clientConnected || !response.activeFlight) {
      clearSayIntentionsTrafficMarkers();
      return;
    }
    reconcileSayIntentionsTrafficMarkers(response, targetMap);
  } catch (error) {
    clearSayIntentionsTrafficMarkers();
    console.warn("TaxiNow Pro could not refresh SayIntentions traffic.", error);
  } finally {
    sayIntentionsTrafficRefreshInFlight = false;
  }
}

function reconcileSayIntentionsTrafficMarkers(
  response: SayIntentionsTrafficResponse,
  targetMap: MapLibreMap
): void {
  const activeIds = new Set<string>();
  for (const aircraft of response.aircraft) {
    activeIds.add(aircraft.id);
    let marker = sayIntentionsTrafficMarkers.get(aircraft.id);
    if (!marker) {
      marker = new maplibregl.Marker({
        element: createSayIntentionsTrafficElement(aircraft, targetMap),
        anchor: "center",
        rotationAlignment: "viewport",
        pitchAlignment: "viewport",
        subpixelPositioning: true
      })
        .setLngLat([aircraft.longitude, aircraft.latitude])
        .addTo(targetMap);
      sayIntentionsTrafficMarkers.set(aircraft.id, marker);
    }
    marker.setLngLat([aircraft.longitude, aircraft.latitude]);
    updateSayIntentionsTrafficElement(marker.getElement(), aircraft, targetMap);
  }

  for (const [id, marker] of sayIntentionsTrafficMarkers) {
    if (!activeIds.has(id)) {
      marker.remove();
      sayIntentionsTrafficMarkers.delete(id);
    }
  }
}

function createSayIntentionsTrafficElement(
  aircraft: SayIntentionsTrafficAircraft,
  targetMap: MapLibreMap
): HTMLElement {
  const namespace = "http://www.w3.org/2000/svg";
  const element = document.createElement("div");
  element.className = "sayintentions-traffic-marker";
  element.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("class", "sayintentions-traffic-icon");
  svg.setAttribute("viewBox", "-22 -22 44 44");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(namespace, "path");
  path.setAttribute("d", aircraftPathData);
  path.setAttribute("class", "sayintentions-traffic-shape");
  svg.append(path);
  const label = document.createElement("span");
  label.className = "sayintentions-traffic-label";
  element.append(svg, label);
  updateSayIntentionsTrafficElement(element, aircraft, targetMap);
  return element;
}

function updateSayIntentionsTrafficElement(
  element: HTMLElement,
  aircraft: SayIntentionsTrafficAircraft,
  targetMap: MapLibreMap
): void {
  const type = aircraft.aircraftType ? ` · ${aircraft.aircraftType}` : "";
  element.title = `${aircraft.callsign}${type} · ${aircraft.altitudeFeet} ft · ${aircraft.groundSpeedKnots} kt`;
  element.dataset.headingDegrees = String(aircraft.headingDegrees);
  element.querySelector<HTMLElement>(
    ".sayintentions-traffic-label"
  )!.textContent = aircraft.callsign;
  updateSayIntentionsTrafficMarkerHeading(element, targetMap.getBearing());
}

function updateSayIntentionsTrafficMarkerHeading(
  element: HTMLElement,
  mapBearingDegrees: number
): void {
  const headingDegrees = Number(element.dataset.headingDegrees ?? 0);
  element.style.setProperty(
    "--sayintentions-screen-heading",
    `${headingDegrees - mapBearingDegrees}deg`
  );
}

function syncSayIntentionsTrafficMarkerHeadings(
  targetMap: MapLibreMap
): void {
  if (!mapInitialized || map !== targetMap) {
    return;
  }
  const bearing = targetMap.getBearing();
  for (const marker of sayIntentionsTrafficMarkers.values()) {
    updateSayIntentionsTrafficMarkerHeading(marker.getElement(), bearing);
  }
}

function clearSayIntentionsTrafficMarkers(): void {
  for (const marker of sayIntentionsTrafficMarkers.values()) {
    marker.remove();
  }
  sayIntentionsTrafficMarkers.clear();
}

function setupUpdateExperience(appStatus: AppStatus): void {
  const toggle = document.querySelector<HTMLButtonElement>("#auto-check-updates")!;
  const checkNow = document.querySelector<HTMLButtonElement>("#check-updates-now")!;
  const install = document.querySelector<HTMLButtonElement>("#install-update")!;
  const bridge = (
    window as typeof window & { chrome?: { webview?: DesktopWebViewBridge } }
  ).chrome?.webview;
  const cleanup = document.querySelector<HTMLButtonElement>("#cleanup-updates")!;
  cleanup.hidden = !bridge;
  cleanup.addEventListener("click", () => bridge?.postMessage({ type: "update-install:open-folder" }));
  let enabled = true;
  try {
    enabled = window.localStorage.getItem(autoUpdateStorageKey) !== "false";
  } catch {
    // Automatic checks are enabled by default.
  }
  toggle.setAttribute("aria-checked", String(enabled));
  toggle.addEventListener("click", () => {
    enabled = toggle.getAttribute("aria-checked") !== "true";
    toggle.setAttribute("aria-checked", String(enabled));
    try {
      window.localStorage.setItem(autoUpdateStorageKey, String(enabled));
    } catch {
      // Keep the choice for this session.
    }
  });
  checkNow.addEventListener("click", () => {
    void checkForUpdates(appStatus, true);
  });
  install.hidden = !bridge;
  install.addEventListener("click", () => {
    if (!bridge || !updateRelease) {
      return;
    }
    install.disabled = true;
    bridge.postMessage({
      type: "update-install:start",
      downloadUrl: updateRelease.installerUrl,
      digest: updateRelease.digest
    });
  });
  bridge?.addEventListener("message", (event) => {
    const message = event.data as Partial<DesktopUpdateStatusMessage> | null;
    if (message?.type !== "update-install:status" ||
        typeof message.message !== "string") {
      return;
    }
    const feedback = document.querySelector<HTMLElement>("#update-feedback")!;
    feedback.textContent = message.message;
    feedback.className = message.state === "error" ? "feedback error" : "feedback";
    if (message.state === "error") {
      install.disabled = false;
    }
  });

  if (enabled && shouldRunAutomaticUpdateCheck()) {
    void checkForUpdates(appStatus, false);
  }
}

function shouldRunAutomaticUpdateCheck(): boolean {
  try {
    const previous = Number(window.localStorage.getItem(updateCheckedAtStorageKey));
    return !Number.isFinite(previous) || Date.now() - previous >= 12 * 60 * 60 * 1000;
  } catch {
    return true;
  }
}

async function checkForUpdates(
  appStatus: AppStatus,
  userInitiated: boolean
): Promise<void> {
  try {
    const response = await fetch(
      "https://api.github.com/repos/skylarkning/TaxiNow-Release/releases/latest",
      { headers: { Accept: "application/vnd.github+json" } }
    );
    if (!response.ok) {
      throw new Error(t("updates.checkFailed"));
    }
    const release = await response.json() as GitHubRelease;
    try {
      window.localStorage.setItem(updateCheckedAtStorageKey, String(Date.now()));
    } catch {
      // A failed preference write must not hide a valid update.
    }
    const installers = release.assets
      .map((asset) => ({
        asset,
        build: Number(/Build[-_ ]?(\d+)/i.exec(asset.name)?.[1] ?? 0)
      }))
      .filter((item) => item.build > 0 && /Setup\.exe$/i.test(item.asset.name))
      .sort((left, right) => right.build - left.build);
    const latest = installers[0];
    if (!latest || latest.build <= appStatus.internalBuildId) {
      if (userInitiated) {
        showUpdateDialog(null, t("updates.current", {
          version: appStatus.displayVersion,
          build: appStatus.internalBuildId
        }));
      }
      return;
    }
    updateRelease = {
      version: release.name?.trim() || release.tag_name,
      build: latest.build,
      changelog: release.body?.trim() || t("updates.noChangelog"),
      pageUrl: release.html_url,
      installerUrl: latest.asset.browser_download_url,
      digest: latest.asset.digest ?? null
    };
    showUpdateDialog(updateRelease);
  } catch (error) {
    if (userInitiated) {
      showUpdateDialog(null, error instanceof Error
        ? error.message
        : t("updates.checkFailed"), true);
    }
  }
}

function showUpdateDialog(release: UpdateRelease | null, message = "", failed = false): void {
  const dialog = document.querySelector<HTMLElement>("#update-dialog")!;
  const backdrop = document.querySelector<HTMLButtonElement>("#update-backdrop")!;
  const version = document.querySelector<HTMLElement>("#update-version")!;
  const changelog = document.querySelector<HTMLElement>("#update-changelog")!;
  const feedback = document.querySelector<HTMLElement>("#update-feedback")!;
  const actions = document.querySelector<HTMLElement>(".update-actions")!;
  const github = document.querySelector<HTMLAnchorElement>("#update-github-link")!;
  const heading = document.querySelector<HTMLElement>("#update-heading")!;
  const eyebrow = dialog.querySelector<HTMLElement>(".eyebrow")!;
  const headingKey = release ? "updates.title" : failed ? "updates.errorTitle" : "updates.none";
  const eyebrowKey = release ? "updates.available" : "updates.checkNow";
  heading.dataset.i18n = headingKey;
  heading.textContent = t(headingKey);
  eyebrow.dataset.i18n = eyebrowKey;
  eyebrow.textContent = t(eyebrowKey);
  version.hidden = !release;
  version.textContent = release
    ? t("updates.version", { version: release.version, build: release.build })
    : t("updates.none");
  changelog.textContent = release?.changelog ?? "";
  changelog.hidden = !release?.changelog.trim();
  feedback.textContent = message;
  feedback.className = failed ? "feedback error" : "feedback";
  feedback.hidden = !message;
  actions.hidden = !release;
  if (release) {
    github.href = release.pageUrl;
  }
  dialog.hidden = false;
  backdrop.hidden = false;
  dialog.focus();
  const close = (): void => {
    dialog.hidden = true;
    backdrop.hidden = true;
  };
  document.querySelector<HTMLButtonElement>("#close-update")!.onclick = close;
  backdrop.onclick = close;
}

const headerCollapseClasses = [
  "header-collapse-airport-name",
  "header-collapse-network",
  "header-collapse-status",
  "header-collapse-about"
] as const;

function setupResponsiveHeader(): void {
  const header = document.querySelector<HTMLElement>("header");
  const primary = header?.querySelector<HTMLElement>(".header-primary");
  const airportToggle = header?.querySelector<HTMLElement>(
    ".fd-flight-identity, .airport-picker-toggle"
  );
  const actions = header?.querySelector<HTMLElement>(".actions");
  if (!header || !primary || !airportToggle || !actions) {
    return;
  }

  let frame: number | null = null;
  const overlaps = (): boolean => {
    const headerRect = header.getBoundingClientRect();
    const primaryRect = primary.getBoundingClientRect();
    const airportRect = airportToggle.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    const gap = Number.parseFloat(getComputedStyle(header).columnGap) || 0;
    return airportRect.right + gap > actionsRect.left + 1 ||
      primaryRect.left < headerRect.left - 1 ||
      actionsRect.right > headerRect.right + 1;
  };

  const fit = (): void => {
    frame = null;
    header.classList.remove(...headerCollapseClasses);
    for (const className of headerCollapseClasses) {
      if (!overlaps()) {
        break;
      }
      header.classList.add(className);
    }
  };

  const schedule = (): void => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
    }
    frame = requestAnimationFrame(fit);
  };

  const resizeObserver = new ResizeObserver(schedule);
  resizeObserver.observe(header);
  resizeObserver.observe(primary);
  resizeObserver.observe(actions);
  const textObserver = new MutationObserver(schedule);
  textObserver.observe(header, {
    characterData: true,
    childList: true,
    subtree: true
  });
  document.fonts.ready.then(schedule).catch(schedule);
  window.addEventListener("resize", schedule, { passive: true });
  schedule();
}

function setupAboutDialog(): void {
  const dialog = document.querySelector<HTMLElement>("#about-dialog")!;
  const backdrop =
    document.querySelector<HTMLButtonElement>("#about-backdrop")!;
  const openButton =
    document.querySelector<HTMLButtonElement>("#open-about")!;
  let returnFocus: HTMLElement | null = null;

  const setOpen = (open: boolean): void => {
    dialog.hidden = !open;
    backdrop.hidden = !open;
    if (open) {
      returnFocus = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      dialog.focus();
    } else {
      returnFocus?.focus();
      returnFocus = null;
    }
  };

  openButton.addEventListener("click", () => setOpen(true));
  document
    .querySelector("#close-about")!
    .addEventListener("click", () => setOpen(false));
  backdrop.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dialog.hidden) {
      setOpen(false);
    }
  });
}

function setupWelcomeDialog(): void {
  const storageKey = "taxinow.welcome.v2.dismissed";
  const dialog = document.querySelector<HTMLElement>("#welcome-dialog")!;
  const backdrop =
    document.querySelector<HTMLButtonElement>("#welcome-backdrop")!;
  const doNotShow =
    document.querySelector<HTMLInputElement>("#welcome-do-not-show")!;
  const close =
    document.querySelector<HTMLButtonElement>("#close-welcome")!;

  let dismissed = false;
  try {
    dismissed = window.localStorage.getItem(storageKey) === "true";
  } catch {
    // If storage is unavailable, show the welcome on each new launch.
  }
  if (dismissed) {
    return;
  }

  dialog.hidden = false;
  backdrop.hidden = false;
  dialog.focus();
  close.addEventListener("click", () => {
    if (doNotShow.checked) {
      try {
        window.localStorage.setItem(storageKey, "true");
      } catch {
        // Closing the welcome must still work if storage is unavailable.
      }
    }
    dialog.hidden = true;
    backdrop.hidden = true;
  });
}

function setupTaxiPlanner(): void {
  const panel = document.querySelector<HTMLElement>("#taxi-plan-panel")!;
  const backdrop = document.querySelector<HTMLButtonElement>(
    "#taxi-plan-backdrop"
  )!;
  const openButton = document.querySelector<HTMLButtonElement>(
    "#open-taxi-plan"
  )!;
  const closeButton = document.querySelector<HTMLButtonElement>(
    "#close-taxi-plan"
  )!;
  const kind = document.querySelector<HTMLSelectElement>(
    "#taxi-destination-kind"
  )!;
  const customToggle = document.querySelector<HTMLButtonElement>(
    "#toggle-custom-taxi-route"
  )!;
  const customSection = document.querySelector<HTMLElement>(
    "#taxi-custom-route"
  )!;

  const setOpen = (open: boolean): void => {
    panel.classList.toggle("open", open);
    panel.setAttribute("aria-hidden", String(!open));
    // Taxi planning is a map tool, not a blocking modal. Keep the former
    // backdrop hidden so users can pan, zoom and right-click the map while the
    // planner is open (including manual start/destination placement).
    backdrop.hidden = true;
    if (open) {
      populateTaxiDestinations();
      renderTaxiwayBuilder();
      document.querySelector<HTMLElement>("#taxi-runway")?.focus();
    }
  };
  const syncKind = (): void => {
    if (manualTaxiDestination) {
      manualTaxiDestination = null;
      updateManualTaxiPoints();
    }
    const runway = kind.value === "runway";
    document.querySelector<HTMLElement>("#taxi-runway-field")!.hidden = !runway;
    document.querySelector<HTMLElement>("#taxi-gate-field")!.hidden = runway;
  };

  openButton.addEventListener("click", () => setOpen(true));
  closeButton.addEventListener("click", () => setOpen(false));
  backdrop.addEventListener("click", () => setOpen(false));
  kind.addEventListener("change", syncKind);
  document.querySelector("#taxi-runway")?.addEventListener("change", () => {
    manualTaxiDestination = null;
    updateManualTaxiPoints();
  });
  document.querySelector("#taxi-gate")?.addEventListener("input", () => {
    manualTaxiDestination = null;
    updateManualTaxiPoints();
  });
  customToggle.addEventListener("click", () => {
    const open = customSection.hidden;
    customSection.hidden = !open;
    customToggle.setAttribute("aria-expanded", String(open));
    if (open) {
      renderTaxiwayBuilder();
      document.querySelector<HTMLInputElement>(
        "#taxi-custom-route-input"
      )?.focus();
    }
  });
  document.querySelector("#find-taxi-routes")!.addEventListener("click", () => {
    findTaxiRoutes();
  });
  document.querySelector("#preview-custom-taxi-route")!
    .addEventListener("click", previewCustomTaxiRoute);
  document.querySelector("#apply-custom-correction")!
    .addEventListener("click", () => {
      if (!pendingCustomTaxiCorrection) {
        return;
      }
      document.querySelector<HTMLInputElement>(
        "#taxi-custom-route-input"
      )!.value = pendingCustomTaxiCorrection;
      previewCustomTaxiRoute();
    });
  document.querySelector("#custom-auto-route")!.addEventListener("click", () => {
    if (pendingCustomTaxiDestination) {
      findTaxiRoutes(pendingCustomTaxiDestination);
    }
  });
  document.querySelector("#start-taxi-guidance")!.addEventListener("click", () => {
    startTaxiGuidance();
    setOpen(false);
  });
  document.querySelector("#clear-taxi-route")!.addEventListener("click", () => {
    clearTaxiRoute();
  });
  document.querySelector("#stop-taxi-guidance")!.addEventListener("click", () => {
    clearTaxiRoute();
  });
  document.querySelector<HTMLInputElement>("#taxi-custom-route-input")!
    .addEventListener("input", syncTaxiwayBuilderFromInput);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel.classList.contains("open")) {
      setOpen(false);
    }
  });
  syncKind();
}

function syncTaxiwayBuilderFromInput(): void {
  if (!taxiGraph) {
    return;
  }
  const available = new Set(listTaxiwayRefs(taxiGraph));
  const tokens = parseCustomTaxiRouteInput(
    document.querySelector<HTMLInputElement>(
      "#taxi-custom-route-input"
    )!.value
  )
    .filter((token) => available.has(token));
  selectedTaxiwaySequence = tokens;
  renderTaxiwayBuilder();
}

function renderTaxiwayBuilder(): void {
  const selected = document.querySelector<HTMLElement>(
    "#selected-taxiway-pills"
  );
  const available = document.querySelector<HTMLElement>(
    "#available-taxiway-pills"
  );
  const feedback = document.querySelector<HTMLElement>(
    "#taxiway-builder-feedback"
  );
  if (!selected || !available || !feedback) {
    return;
  }
  selected.replaceChildren();
  available.replaceChildren();
  updateSelectedTaxiwayHighlight();
  if (!taxiGraph) {
    feedback.textContent = t("taxi.noNetwork");
    return;
  }

  selectedTaxiwaySequence.forEach((ref, index) => {
    const pill = document.createElement("span");
    pill.className = "selected-taxiway-pill";
    pill.append(document.createTextNode(ref));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = t("taxi.removeTaxiway", { taxiway: ref });
    remove.setAttribute("aria-label", remove.title);
    remove.addEventListener("click", () => {
      // Later choices depend on this intersection, so truncate the invalid tail.
      selectedTaxiwaySequence = selectedTaxiwaySequence.slice(0, index);
      writeTaxiwayBuilderInput();
      renderTaxiwayBuilder();
    });
    pill.append(remove);
    selected.append(pill);
  });

  const previous = selectedTaxiwaySequence.at(-1);
  const candidates = previous
    ? listConnectingTaxiwayRefs(taxiGraph, previous)
    : listTaxiwayRefs(taxiGraph);
  const remaining = candidates.filter(
    (ref) => !selectedTaxiwaySequence.includes(ref)
  );
  for (const ref of remaining) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "available-taxiway-pill";
    button.textContent = ref;
    button.addEventListener("click", () => {
      selectedTaxiwaySequence.push(ref);
      writeTaxiwayBuilderInput();
      renderTaxiwayBuilder();
    });
    available.append(button);
  }
  feedback.textContent = previous
    ? remaining.length > 0
      ? t("taxi.clickNext", { taxiway: previous })
      : t("taxi.clickDeadEnd", { taxiway: previous })
    : t("taxi.clickHint");
  updateSelectedTaxiwayHighlight();
}

function writeTaxiwayBuilderInput(): void {
  document.querySelector<HTMLInputElement>("#taxi-custom-route-input")!.value =
    selectedTaxiwaySequence.join(", ");
}

function populateTaxiDestinations(): void {
  const runwaySelect = document.querySelector<HTMLSelectElement>("#taxi-runway");
  const gateOptions = document.querySelector<HTMLDataListElement>(
    "#taxi-gate-options"
  );
  if (!runwaySelect || !gateOptions) {
    return;
  }
  const selectedRunway = runwaySelect.value;
  runwaySelect.replaceChildren();
  for (const runway of taxiRunways) {
    const option = document.createElement("option");
    option.value = runway.ref;
    option.textContent = runway.label;
    runwaySelect.append(option);
  }
  if (taxiRunways.some((runway) => runway.ref === selectedRunway)) {
    runwaySelect.value = selectedRunway;
  }
  gateOptions.replaceChildren();
  for (const gate of taxiGates) {
    const option = document.createElement("option");
    option.value = gate.ref;
    option.label = gate.label;
    gateOptions.append(option);
  }
}

function previewCustomTaxiRoute(): void {
  const feedback = document.querySelector<HTMLElement>(
    "#taxi-custom-feedback"
  )!;
  const position = taxiPlanningStart();
  if (!position || !currentAirportMap || !taxiGraph) {
    showCustomTaxiFeedback(
      !position ? t("taxi.needStart") : t("taxi.needPosition"),
      true
    );
    return;
  }
  // Never leave an older blue route on screen while reporting that the newly
  // entered custom route is invalid.
  clearTaxiRoute();
  const input = document.querySelector<HTMLInputElement>(
    "#taxi-custom-route-input"
  )!;
  const tokens = parseCustomTaxiRouteInput(input.value);
  if (tokens.length < 1) {
    showCustomTaxiFeedback(t("taxi.customNeedFormat"), true);
    input.focus();
    return;
  }

  const destinationToken = tokens.at(-1)!;
  let destinationMatch = resolveCustomTaxiDestination(destinationToken);
  let requestedRefs = tokens.slice(0, -1);
  const graph = taxiGraph;
  const taxiwayRefs = new Set(listTaxiwayRefs(graph));
  const builderOwnsSequence = selectedTaxiwaySequence.length === tokens.length &&
    selectedTaxiwaySequence.every((ref, index) => ref === tokens[index]);
  if ((builderOwnsSequence || !destinationMatch.destination) &&
      tokens.every((token) => taxiwayRefs.has(token))) {
    const selectedDestination = selectedPlannerDestination();
    if (selectedDestination) {
      destinationMatch = {
        destination: selectedDestination,
        token: selectedDestination.kind === "runway"
          ? `RWY${selectedDestination.ref}`
          : selectedDestination.label,
        suggestion: null
      };
      requestedRefs = tokens;
    }
  }
  if (!destinationMatch.destination) {
    const correction = destinationMatch.suggestion
      ? [...tokens.slice(0, -1), destinationMatch.suggestion].join(", ")
      : null;
    const suggestion = correction
      ? t("taxi.customDidYouMean", { route: correction })
      : "";
    showCustomTaxiFeedback(
      `${t("taxi.customBadDestination")}${suggestion}`,
      true,
      correction
    );
    return;
  }

  const availableRefs = new Set(listTaxiwayRefs(taxiGraph));
  const unknown = requestedRefs.filter((ref) => !availableRefs.has(ref));
  if (unknown.length > 0) {
    const suggestions = new Map<string, string | undefined>();
    for (const ref of unknown) {
      const index = requestedRefs.indexOf(ref);
      const adjacent = new Set([
        requestedRefs[index - 1],
        requestedRefs[index + 1]
      ].filter(Boolean));
      const candidates = suggestTaxiwayRefs(taxiGraph, ref, 4);
      suggestions.set(
        ref,
        candidates.find((candidate) => !adjacent.has(candidate)) ?? candidates[0]
      );
    }
    const correctionTokens = requestedRefs.map((ref) =>
      suggestions.get(ref) ?? ref
    );
    const canCorrect = unknown.every((ref) => Boolean(suggestions.get(ref)));
    const correction = canCorrect
      ? [...correctionTokens, destinationMatch.token].join(", ")
      : null;
    const unknownLabels = unknown.map((ref) => {
      const suggestion = suggestions.get(ref);
      return suggestion ? `${ref} → ${suggestion}` : ref;
    }).join(", ");
    showCustomTaxiFeedback(
      `${t("taxi.customUnknown", { items: unknownLabels })}${
        correction ? t("taxi.customDidYouMean", { route: correction }) : ""
      }`,
      true,
      correction,
      destinationMatch.destination
    );
    return;
  }

  const route = planCustomTaxiRoute(
    taxiGraph,
    position,
    destinationMatch.destination,
    requestedRefs,
    manualTaxiStart
      ? t("taxi.manualStart")
      : nearestStandLabel(currentAirportMap.features, position)
  );
  if (!route) {
    showCustomTaxiFeedback(
      t("taxi.customNoPath"),
      true,
      null,
      destinationMatch.destination
    );
    return;
  }

  taxiRouteOptions = [route];
  selectTaxiRoute(route);
  renderTaxiRouteOptions();
  feedback.textContent = t("taxi.customReady");
  feedback.className = "feedback success";
  setCustomTaxiRecovery(null, null);
}

function resolveCustomTaxiDestination(
  value: string
): { destination: TaxiDestination | null; token: string; suggestion: string | null } {
  const normalized = value.replace(/\s+/g, "").toUpperCase();
  const candidates: Array<{ token: string; key: string; destination: TaxiDestination }> = [];
  for (const runway of taxiRunways) {
    candidates.push({
      token: `RWY${runway.ref}`,
      key: `RWY${runway.ref}`.replace(/\s+/g, "").toUpperCase(),
      destination: runway
    });
  }
  for (const gate of taxiGates) {
    for (const ref of gate.ref.split(/[\/,]/).map((part) => part.trim()).filter(Boolean)) {
      candidates.push({
        token: `GATE ${ref}`,
        key: `GATE${ref}`.replace(/\s+/g, "").toUpperCase(),
        destination: gate
      });
    }
  }
  const exact = candidates.find((candidate) =>
    candidate.key === normalized ||
    (candidate.destination.kind === "gate" &&
      candidate.destination.ref.toUpperCase() === value.trim().toUpperCase())
  );
  if (exact) {
    return { destination: exact.destination, token: exact.token, suggestion: null };
  }
  const suggestedKey = suggestReferences(
    normalized,
    candidates.map((candidate) => candidate.key),
    1
  )[0];
  const suggestion = candidates.find((candidate) => candidate.key === suggestedKey);
  return {
    destination: null,
    token: value,
    suggestion: suggestion?.token ?? null
  };
}

function showCustomTaxiFeedback(
  message: string,
  error: boolean,
  correction: string | null = null,
  automaticDestination: TaxiDestination | null = null
): void {
  const feedback = document.querySelector<HTMLElement>(
    "#taxi-custom-feedback"
  )!;
  feedback.textContent = message;
  feedback.className = `feedback ${error ? "error" : "success"}`;
  setCustomTaxiRecovery(correction, automaticDestination);
}

function setCustomTaxiRecovery(
  correction: string | null,
  automaticDestination: TaxiDestination | null
): void {
  pendingCustomTaxiCorrection = correction;
  pendingCustomTaxiDestination = automaticDestination;
  const recovery = document.querySelector<HTMLElement>(
    "#taxi-custom-recovery"
  )!;
  const correctionButton = document.querySelector<HTMLButtonElement>(
    "#apply-custom-correction"
  )!;
  const automaticButton = document.querySelector<HTMLButtonElement>(
    "#custom-auto-route"
  )!;
  correctionButton.hidden = !correction;
  automaticButton.hidden = !automaticDestination;
  recovery.hidden = !correction && !automaticDestination;
}

function findTaxiRoutes(destinationOverride?: TaxiDestination): void {
  const feedback = document.querySelector<HTMLElement>("#taxi-plan-feedback")!;
  if (destinationOverride) {
    const customFeedback = document.querySelector<HTMLElement>(
      "#taxi-custom-feedback"
    );
    if (customFeedback) {
      customFeedback.textContent = "";
      customFeedback.className = "feedback";
    }
    setCustomTaxiRecovery(null, null);
  }
  const position = taxiPlanningStart();
  if (!position || !currentAirportMap || !taxiGraph) {
    feedback.textContent = !position
      ? t("taxi.needStart")
      : t("taxi.needPosition");
    feedback.className = "feedback error";
    return;
  }
  let destination: TaxiDestination | undefined =
    destinationOverride ?? manualTaxiDestination ?? undefined;
  if (!destination) {
    const kind = document.querySelector<HTMLSelectElement>(
      "#taxi-destination-kind"
    )!.value;
    if (kind === "runway") {
      const ref = document.querySelector<HTMLSelectElement>("#taxi-runway")!.value;
      destination = taxiRunways.find((item) => item.ref === ref);
    } else {
      const input = document.querySelector<HTMLInputElement>("#taxi-gate")!;
      const ref = input.value.trim().toUpperCase();
      destination = taxiGates.find((item) =>
        item.ref.toUpperCase() === ref ||
        item.ref.toUpperCase().split(/[\/,]/).includes(ref)
      );
      if (!destination) {
        feedback.textContent = t("taxi.chooseGate");
        feedback.className = "feedback error";
        input.focus();
        return;
      }
    }
  }
  if (!destination) {
    feedback.textContent = t("taxi.noNetwork");
    feedback.className = "feedback error";
    return;
  }

  taxiRouteOptions = planTaxiRoutes(
    taxiGraph,
    position,
    destination,
    manualTaxiStart
      ? t("taxi.manualStart")
      : nearestStandLabel(currentAirportMap.features, position),
    5,
    {
      startHeadingDegrees: manualTaxiStart
        ? undefined
        : currentAircraftHeading() ?? undefined
    }
  );
  if (taxiRouteOptions.length === 0) {
    feedback.textContent = t("taxi.noNetwork");
    feedback.className = "feedback error";
    renderTaxiRouteOptions();
    return;
  }
  feedback.textContent = t("taxi.found", { count: taxiRouteOptions.length });
  feedback.className = "feedback success";
  selectTaxiRoute(taxiRouteOptions[0]!);
  renderTaxiRouteOptions();
}

function selectedPlannerDestination(): TaxiDestination | undefined {
  if (manualTaxiDestination) {
    return manualTaxiDestination;
  }
  const kind = document.querySelector<HTMLSelectElement>(
    "#taxi-destination-kind"
  )?.value;
  if (kind === "runway") {
    const ref = document.querySelector<HTMLSelectElement>("#taxi-runway")?.value;
    return taxiRunways.find((item) => item.ref === ref);
  }
  const ref = document.querySelector<HTMLInputElement>("#taxi-gate")
    ?.value.trim().toUpperCase();
  return taxiGates.find((item) =>
    item.ref.toUpperCase() === ref ||
    item.ref.toUpperCase().split(/[\/,]/).includes(ref ?? "")
  );
}

function renderTaxiRouteOptions(): void {
  const container = document.querySelector<HTMLElement>("#taxi-route-options")!;
  container.replaceChildren();
  if (taxiRouteOptions.length === 0) {
    container.append(createEmptyState(t("taxi.empty")));
    return;
  }
  taxiRouteOptions.forEach((route, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `taxi-route-option${
      selectedTaxiRoute?.id === route.id ? " selected" : ""
    }`;
    const heading = document.createElement("span");
    heading.className = "taxi-route-option-heading";
    const title = document.createElement("strong");
    title.textContent = route.custom
      ? t("taxi.customOption")
      : t("taxi.option", { number: index + 1 });
    heading.append(title);
    if (route.custom) {
      const badge = document.createElement("small");
      badge.textContent = t("taxi.customExperimental");
      heading.append(badge);
    } else if (index === 0) {
      const badge = document.createElement("small");
      badge.textContent = t("taxi.recommended");
      heading.append(badge);
    }
    const summary = document.createElement("span");
    summary.className = "taxi-route-summary";
    summary.textContent = route.summary;
    const details = document.createElement("small");
    details.textContent = t("taxi.distance", {
      distance: formatTaxiDistance(route.distanceMeters),
      minutes: Math.max(1, Math.round(route.distanceMeters / 7.7 / 60))
    });
    button.append(heading, summary, details);
    button.addEventListener("click", () => {
      selectTaxiRoute(route);
      renderTaxiRouteOptions();
    });
    container.append(button);
  });
}

function selectTaxiRoute(route: TaxiRoute): void {
  activeTaxiRoute = null;
  activeTaxiSegmentIndex = 0;
  selectedTaxiRoute = route;
  document.querySelector<HTMLButtonElement>("#start-taxi-guidance")!.disabled = false;
  document.querySelector<HTMLElement>("#taxi-guidance")!.hidden = true;
  setTaxiRouteGeometry(route.coordinates);
  fitTaxiRoute(route.coordinates);
}

function startTaxiGuidance(): void {
  if (!selectedTaxiRoute) {
    return;
  }
  activeTaxiRoute = selectedTaxiRoute;
  activeTaxiSegmentIndex = 0;
  lastTaxiCameraAt = 0;
  const guidance = document.querySelector<HTMLElement>("#taxi-guidance")!;
  guidance.hidden = false;
  document.querySelector<HTMLElement>("#taxi-guidance-route")!.textContent =
    selectedTaxiRoute.summary;
  const feedback = document.querySelector<HTMLElement>("#taxi-plan-feedback")!;
  feedback.textContent = t("taxi.guidanceStarted");
  feedback.className = "feedback success";
  const position = currentAircraftCoordinate();
  if (position) {
    updateActiveTaxiGuidance(position, lastRenderedOwnship?.heading ?? 0);
  }
}

function clearTaxiRoute(): void {
  taxiRouteOptions = [];
  selectedTaxiRoute = null;
  activeTaxiRoute = null;
  activeTaxiSegmentIndex = 0;
  document.querySelector<HTMLElement>("#taxi-guidance")?.setAttribute("hidden", "");
  const startButton = document.querySelector<HTMLButtonElement>(
    "#start-taxi-guidance"
  );
  if (startButton) {
    startButton.disabled = true;
  }
  const feedback = document.querySelector<HTMLElement>("#taxi-plan-feedback");
  if (feedback) {
    feedback.textContent = "";
    feedback.className = "feedback";
  }
  const customFeedback = document.querySelector<HTMLElement>(
    "#taxi-custom-feedback"
  );
  if (customFeedback) {
    customFeedback.textContent = "";
    customFeedback.className = "feedback";
  }
  if (document.querySelector("#taxi-custom-recovery")) {
    setCustomTaxiRecovery(null, null);
  }
  if (document.querySelector("#taxi-route-options")) {
    renderTaxiRouteOptions();
  }
  setTaxiRouteGeometry([]);
}

function currentAircraftCoordinate(): Coordinate | null {
  if (lastRenderedOwnship?.visible) {
    return [lastRenderedOwnship.longitude, lastRenderedOwnship.latitude];
  }
  const sample = telemetrySamples.at(-1);
  return sample?.hasPosition && sample.onGround
    ? [sample.longitude, sample.latitude]
    : null;
}

function taxiPlanningStart(): Coordinate | null {
  return manualTaxiStart ?? currentAircraftCoordinate();
}

function currentAircraftHeading(): number | null {
  if (lastRenderedOwnship?.visible) {
    return lastRenderedOwnship.heading;
  }
  const sample = telemetrySamples.at(-1);
  return sample?.hasPosition && sample.onGround
    ? sample.trueHeadingDegrees
    : null;
}

function applyProductMetadata(status: AppStatus): void {
  document.title = `TaxiNow Pro ${status.displayVersion}`;
  document.querySelector("#footer-version")!.textContent =
    status.displayVersion;
  const localizedVersion = document.querySelector("#about-version-localized");
  if (localizedVersion) {
    localizedVersion.textContent = status.displayVersion;
  }
  const localizedBuildDate = document.querySelector(
    "#about-build-date-localized"
  );
  if (localizedBuildDate) {
    const parsedBuildDate = new Date(`${status.buildDate} 00:00:00 UTC`);
    const dateLocales: Record<ReturnType<typeof getLocale>, string> = {
      en: "en-US",
      "zh-Hans": "zh-CN",
      "zh-Hant": "zh-TW",
      ja: "ja-JP",
      fr: "fr-FR",
      de: "de-DE",
      ko: "ko-KR"
    };
    localizedBuildDate.textContent = Number.isNaN(parsedBuildDate.valueOf())
      ? status.buildDate
      : new Intl.DateTimeFormat(dateLocales[getLocale()], {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC"
      }).format(parsedBuildDate);
  }
  const localizedBuildId = document.querySelector(
    "#about-build-id-localized"
  );
  if (localizedBuildId) {
    localizedBuildId.textContent = String(status.internalBuildId);
  }
  document.querySelector("#about-version")!.textContent =
    status.displayVersion;
  document.querySelector("#about-build-date")!.textContent =
    status.buildDate;
  document.querySelector("#about-build-id")!.textContent =
    String(status.internalBuildId);
  const chineseVersion = document.querySelector("#about-version-zh");
  if (chineseVersion) {
    chineseVersion.textContent = status.displayVersion;
  }
  const chineseBuildDate = document.querySelector("#about-build-date-zh");
  if (chineseBuildDate) {
    const parsedBuildDate = new Date(`${status.buildDate} 00:00:00 UTC`);
    chineseBuildDate.textContent = Number.isNaN(parsedBuildDate.valueOf())
      ? status.buildDate
      : new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC"
      }).format(parsedBuildDate);
  }
  const chineseBuildId = document.querySelector("#about-build-id-zh");
  if (chineseBuildId) {
    chineseBuildId.textContent = String(status.internalBuildId);
  }
}

async function loadAirport(
  icao: string,
  shouldCommit?: () => boolean
): Promise<void> {
  if (!shouldCommit) {
    const activation = latestAirportActivation.begin();
    cancelAirportInstallWaiters();
    shouldCommit = activation.isCurrent;
  }
  const downloadedAirport = await getJson<AirportMap>(
    `/api/v1/airports/${encodeURIComponent(icao)}/map`
  );
  if (!shouldCommit()) return;
  closeManualTaxiContextMenu();
  stopTaxiwaySelectionAnimation();
  clearTaxiRoute();
  manualTaxiStart = null;
  manualTaxiDestination = null;
  selectedTaxiwaySequence = [];
  const visibleFeatures = filterAirportFeatures(
    downloadedAirport.features,
    downloadedAirport.airport.center
  );
  const airport: AirportMap = {
    ...downloadedAirport,
    airport: {
      ...downloadedAirport.airport,
      bounds: calculateFeatureBounds(
        visibleFeatures,
        downloadedAirport.airport.center
      )
    },
    features: visibleFeatures,
    counts: featureCounts(visibleFeatures)
  };
  currentAirportMap = airport;
  taxiGraph = buildTaxiGraph(airport.features);
  taxiRunways = listRunwayDestinations(airport.features);
  taxiGates = listGateDestinations(airport.features);
  populateTaxiDestinations();
  selectedAirportIcao = airport.airport.icao;
  rememberLastAirport(selectedAirportIcao);
  airportBounds = [
    [airport.airport.bounds.minLon, airport.airport.bounds.minLat],
    [airport.airport.bounds.maxLon, airport.airport.bounds.maxLat]
  ];
  airportPerimeter = { ...airport.airport.bounds };
  document.querySelector("#airport-code")!.textContent = airport.airport.icao;
  document.querySelector("#airport-name")!.textContent =
    airport.airport.name;
  document.querySelector("#attribution")!.textContent = airport.sources
    .map((source) =>
      source.name.toLowerCase().includes("openstreetmap")
        ? `© ${source.name}`
        : source.name
    )
    .join(" · ");
  document.querySelector("#map-summary")!.textContent = t("map.summary", {
    runways: airport.counts.runways,
    taxiways: airport.counts.taxiways,
    stands: airport.counts.stands
  });

  if (mapInitialized) {
    clearVatsimTrafficMarkers();
    clearBeyondAtcTrafficMarkers();
    clearSayIntentionsTrafficMarkers();
    domOwnshipMarker?.remove();
    domOwnshipMarker = null;
    domOwnshipElement = null;
    fallbackOverlayCleanup?.();
    fallbackOverlayCleanup = null;
    map.remove();
    document.querySelector("#airport-fallback")?.remove();
    fallbackOwnship = null;
    fallbackTaxiRouteCasing = null;
    fallbackTaxiRouteHighlight = null;
    fallbackTaxiwaySelectionGroup = null;
  }
  ownshipMapSynchronized = false;
  fallbackOwnshipSynchronized = false;
  domOwnshipSynchronized = false;
  map = createMap(airport);
  mapInitialized = true;
  const activeMap = map;
  activeMap.on("rotate", () => {
    syncVatsimTrafficMarkerHeadings(activeMap);
    syncBeyondAtcTrafficMarkerHeadings(activeMap);
    syncSayIntentionsTrafficMarkerHeadings(activeMap);
  });
  if (vatsimTrafficEnabled) {
    void refreshVatsimTraffic();
  }
  if (beyondAtcTrafficEnabled) {
    void refreshBeyondAtcTraffic();
  }
  if (sayIntentionsTrafficEnabled) {
    void refreshSayIntentionsTraffic();
  }
  renderAirportPicker(
    document.querySelector<HTMLInputElement>("#airport-search")!.value
  );
}

function setupAirportPicker(): void {
  const toggle =
    document.querySelector<HTMLButtonElement>("#airport-picker-toggle")!;
  const panel =
    document.querySelector<HTMLElement>("#airport-picker-panel")!;
  const search =
    document.querySelector<HTMLInputElement>("#airport-search")!;
  const quickDownload =
    document.querySelector<HTMLButtonElement>("#quick-download")!;

  toggle.addEventListener("click", () => setAirportPickerOpen(panel.hidden));
  search.addEventListener("input", () => {
    search.value = search.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    renderAirportPicker(search.value);
  });
  quickDownload.addEventListener("click", () => {
    const icao = search.value.trim().toUpperCase();
    void queueIcaoDownload(
      icao,
      document.querySelector<HTMLElement>("#airport-picker-feedback")!
    );
  });
  document.addEventListener("click", (event) => {
    if (!panel.hidden &&
        event.target instanceof Node &&
        !document.querySelector(".airport-switcher")!.contains(event.target)) {
      setAirportPickerOpen(false);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      setAirportPickerOpen(false);
    }
  });
}

function setAirportPickerOpen(open: boolean): void {
  const toggle =
    document.querySelector<HTMLButtonElement>("#airport-picker-toggle")!;
  const panel =
    document.querySelector<HTMLElement>("#airport-picker-panel")!;
  const search =
    document.querySelector<HTMLInputElement>("#airport-search")!;
  panel.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
  if (open) {
    search.focus();
    search.select();
    renderAirportPicker(search.value);
  }
}

function renderAirportPicker(query: string): void {
  const normalized = query.trim().toUpperCase();
  const results = document.querySelector<HTMLElement>("#airport-results")!;
  const quickDownload =
    document.querySelector<HTMLButtonElement>("#quick-download")!;
  const feedback =
    document.querySelector<HTMLElement>("#airport-picker-feedback")!;
  const matches = installedAssets
    .filter((asset) =>
      !normalized ||
      asset.icao.includes(normalized) ||
      asset.name.toUpperCase().includes(normalized) ||
      asset.municipality?.toUpperCase().includes(normalized)
    )
    .slice(0, 12);
  results.replaceChildren();

  for (const asset of matches) {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      `airport-result${asset.icao === selectedAirportIcao ? " selected" : ""}`;
    const code = document.createElement("strong");
    code.textContent = asset.icao;
    const name = document.createElement("span");
    name.textContent = asset.name;
    const location = document.createElement("small");
    location.textContent =
      [
        asset.municipality,
        asset.regionCode
          ? formatRegionName(asset.regionCode, getLocale())
          : null,
        asset.countryCode
          ? formatCountryName(asset.countryCode, getLocale())
          : null
      ]
        .filter(Boolean)
        .join(" · ");
    button.append(code, name, location);
    button.addEventListener("click", async () => {
      automaticAirportSelectionSuspended = true;
      feedback.textContent = t("airport.loading");
      feedback.className = "feedback";
      try {
        await loadAirport(asset.icao);
        document.querySelector<HTMLElement>("#airport-picker-panel")!.hidden =
          true;
        document
          .querySelector("#airport-picker-toggle")!
          .setAttribute("aria-expanded", "false");
      } catch (error) {
        feedback.textContent =
          error instanceof Error ? error.message : String(error);
        feedback.className = "feedback error";
      }
    });
    results.append(button);
  }

  const exactInstalled = installedAssets.some(
    (asset) => asset.icao === normalized
  );
  const downloadable = /^[A-Z0-9]{4}$/.test(normalized) && !exactInstalled;
  quickDownload.hidden = !downloadable;
  quickDownload.textContent = downloadable
    ? `${t("airport.download")} ${normalized}`
    : t("airport.download");
  if (matches.length === 0 && !downloadable) {
    results.append(createEmptyState(
      normalized
        ? t("airport.noInstalled")
        : t("error.noMaps")
    ));
  }
  if (!pendingAirportIcao) {
    feedback.textContent = downloadable
      ? t("airport.noMatch")
      : "";
    feedback.className = "feedback";
  }
}

async function queueIcaoDownload(
  icao: string,
  feedback: HTMLElement
): Promise<void> {
  if (!/^[A-Z0-9]{4}$/.test(icao)) {
    feedback.textContent = t("airport.searchHint");
    feedback.className = "feedback error";
    return;
  }
  const activation = latestAirportActivation.begin();
  cancelAirportInstallWaiters();
  const quickDownload =
    document.querySelector<HTMLButtonElement>("#quick-download")!;
  quickDownload.disabled = true;
  feedback.textContent = t("airport.starting", { icao });
  feedback.className = "feedback";
  try {
    await requestJson<DownloadJob>("/api/v1/downloads", {
      method: "POST",
      body: JSON.stringify({
        mode: "icao",
        icao,
        countryCode: null,
        regionCode: null
      })
    });
    pendingAirportIcao = icao;
    pendingAirportActivation = activation;
    feedback.textContent = t("airport.downloading", { icao });
    feedback.className = "feedback success";
    ensureAssetPolling();
    await refreshAssetManager();
  } catch (error) {
    feedback.textContent =
      error instanceof Error ? error.message : String(error);
    feedback.className = "feedback error";
  } finally {
    quickDownload.disabled = false;
  }
}

async function ensureFlightPlanAirports(plan: PlanAirportPair): Promise<void> {
  latestAirportActivation.cancel();
  cancelAirportInstallWaiters();
  flightPlanAirportIcaos.clear();
  for (const icao of normalizePlanAirports(plan)) {
    flightPlanAirportIcaos.add(icao);
    updateFlightPlanAirportStatus(icao, "checking");
  }

  if (!await refreshAssetManager()) {
    for (const icao of flightPlanAirportIcaos) {
      updateFlightPlanAirportStatus(icao, "failed");
    }
    return;
  }
  const missing = airportsNeedingDownload(
    plan,
    installedAssets.map(asset => asset.icao),
    latestDownloadJobs.flatMap(job => job.currentIcao
      ? [{ icao: job.currentIcao, state: job.state }]
      : [])
  );
  await Promise.allSettled(missing.map(startFlightPlanAirportDownload));
}

async function startFlightPlanAirportDownload(icao: string): Promise<void> {
  return flightPlanDownloadStartGate.run(icao, async () => {
    updateFlightPlanAirportStatus(icao, "downloading");
    try {
      await requestJson<DownloadJob>("/api/v1/downloads", {
        method: "POST",
        body: JSON.stringify({
          mode: "icao",
          icao,
          countryCode: null,
          regionCode: null
        })
      });
      ensureAssetPolling();
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      updateFlightPlanAirportStatus(icao, "failed");
      rejectAirportInstallWaiters(icao, failure);
      throw failure;
    }
  });
}

class AirportNavigationCancelledError extends Error {}

async function openFlightPlanAirport(icao: string): Promise<boolean> {
  const normalized = normalizeIcao(icao);
  if (!normalized) throw new Error(`Invalid airport ICAO: ${icao}`);
  const activation = latestAirportActivation.begin();
  cancelAirportInstallWaiters();
  flightPlanAirportIcaos.add(normalized);
  try {
    if (!await refreshAssetManager()) {
      throw new Error("Could not refresh airport downloads.");
    }
    if (!activation.isCurrent()) return false;
    if (!installedAssets.some(asset => asset.icao === normalized)) {
      const active = latestDownloadJobs.some(job =>
        job.currentIcao === normalized &&
        (job.state === "queued" || job.state === "running")
      );
      if (!active) await startFlightPlanAirportDownload(normalized);
      if (!activation.isCurrent()) return false;
      await waitForAirportInstall(normalized);
    }
    if (!activation.isCurrent()) return false;
    await loadAirport(normalized, activation.isCurrent);
    return activation.isCurrent();
  } catch (error) {
    if (error instanceof AirportNavigationCancelledError) return false;
    throw error;
  }
}

function waitForAirportInstall(icao: string): Promise<void> {
  if (installedAssets.some(asset => asset.icao === icao)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const waiters = airportInstallWaiters.get(icao) || [];
    waiters.push({ resolve, reject });
    airportInstallWaiters.set(icao, waiters);
  });
}

function resolveAirportInstallWaiters(icao: string): void {
  for (const waiter of airportInstallWaiters.get(icao) || []) waiter.resolve();
  airportInstallWaiters.delete(icao);
}

function rejectAirportInstallWaiters(icao: string, error: Error): void {
  for (const waiter of airportInstallWaiters.get(icao) || []) waiter.reject(error);
  airportInstallWaiters.delete(icao);
}

function cancelAirportInstallWaiters(): void {
  const cancellation = new AirportNavigationCancelledError("Airport navigation superseded.");
  for (const icao of [...airportInstallWaiters.keys()]) {
    rejectAirportInstallWaiters(icao, cancellation);
  }
}

function syncFlightPlanAirportStatuses(jobs: readonly DownloadJob[]): void {
  for (const icao of flightPlanAirportIcaos) {
    if (installedAssets.some(asset => asset.icao === icao)) {
      updateFlightPlanAirportStatus(icao, "ready");
      resolveAirportInstallWaiters(icao);
      continue;
    }
    const job = jobs.find(candidate => candidate.currentIcao === icao);
    if (job?.state === "failed" || job?.state === "cancelled") {
      updateFlightPlanAirportStatus(icao, "failed");
      rejectAirportInstallWaiters(icao, new Error(job.error || `${icao} download failed.`));
    } else if (job) {
      updateFlightPlanAirportStatus(icao, "downloading");
    }
  }
}

function setupAssetManager(): void {
  const panel = document.querySelector<HTMLElement>("#asset-panel")!;
  const backdrop = document.querySelector<HTMLButtonElement>("#asset-backdrop")!;
  const mode = document.querySelector<HTMLSelectElement>("#download-mode")!;
  const form = document.querySelector<HTMLFormElement>("#download-form")!;
  setupDesktopStorageLocation();

  const open = (): void => {
    assetPanelOpen = true;
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    backdrop.hidden = false;
    void refreshAssetManager();
    ensureAssetPolling();
  };
  const close = (): void => {
    assetPanelOpen = false;
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    backdrop.hidden = true;
    if (assetRefreshTimer !== null &&
        pendingAirportIcao === null &&
        !activeDownloads) {
      window.clearInterval(assetRefreshTimer);
      assetRefreshTimer = null;
    }
  };

  document.querySelector("#open-assets")!.addEventListener("click", open);
  document.querySelector("#close-assets")!.addEventListener("click", close);
  backdrop.addEventListener("click", close);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel.classList.contains("open")) {
      close();
    }
  });
  document.querySelector("#refresh-assets")!.addEventListener(
    "click",
    () => void refreshAssetManager()
  );
  document.querySelector("#clear-downloads")!.addEventListener(
    "click",
    async () => {
      await requestJson<{ removed: number }>("/api/v1/downloads/completed", {
        method: "DELETE"
      });
      await refreshAssetManager();
    }
  );
  mode.addEventListener("change", updateDownloadMode);
  updateDownloadMode();
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitDownload(form);
  });
}

function setupDesktopStorageLocation(): void {
  const bridge = (
    window as typeof window & {
      chrome?: { webview?: DesktopWebViewBridge };
    }
  ).chrome?.webview;
  if (!bridge) {
    return;
  }

  const section =
    document.querySelector<HTMLElement>("#desktop-storage-location")!;
  const path =
    document.querySelector<HTMLElement>("#storage-location-path")!;
  const note =
    document.querySelector<HTMLElement>("#storage-location-note")!;
  const change =
    document.querySelector<HTMLButtonElement>("#change-storage-location")!;
  section.hidden = false;
  change.addEventListener("click", () => {
    bridge.postMessage({ type: "storage-location:choose" });
  });
  bridge.addEventListener("message", (event) => {
    const message = event.data as Partial<DesktopStorageMessage> | null;
    if (message?.type !== "storage-location" ||
        typeof message.path !== "string") {
      return;
    }
    path.textContent = message.path;
    path.title = message.path;
    note.textContent = message.restartRequired
      ? t("storage.restartLocation")
      : t("storage.newLocation");
  });
  bridge.postMessage({ type: "storage-location:get" });
}

function setupDesktopWindowSettings(): void {
  const bridge = (
    window as typeof window & {
      chrome?: { webview?: DesktopWebViewBridge };
    }
  ).chrome?.webview;
  const toggle = document.querySelector<HTMLButtonElement>(
    "#keep-window-visible"
  );
  if (!bridge || !toggle) {
    return;
  }

  toggle.hidden = false;
  const minimizeToggle = document.querySelector<HTMLButtonElement>("#minimize-to-tray");
  if (minimizeToggle) {
    minimizeToggle.hidden = false;
    minimizeToggle.addEventListener("click", () => bridge.postMessage({
      type: "window-settings:set",
      minimizeToTray: minimizeToggle.getAttribute("aria-checked") !== "true"
    }));
  }
  toggle.addEventListener("click", () => {
    const enabled = toggle.getAttribute("aria-checked") !== "true";
    bridge.postMessage({
      type: "window-settings:set",
      keepVisible: enabled
    });
  });
  bridge.addEventListener("message", (event) => {
    const message = event.data as Partial<DesktopWindowSettingsMessage> | null;
    if (message?.type !== "window-settings" ||
        typeof message.keepVisible !== "boolean") {
      return;
    }
    toggle.setAttribute("aria-checked", String(message.keepVisible));
    if (minimizeToggle && typeof message.minimizeToTray === "boolean") {
      minimizeToggle.setAttribute("aria-checked", String(message.minimizeToTray));
    }
  });
  bridge.postMessage({ type: "window-settings:get" });
}

function setupDesktopIntegrationSettings(): void {
  const bridge = (
    window as typeof window & {
      chrome?: { webview?: DesktopWebViewBridge };
    }
  ).chrome?.webview;
  const toggle = document.querySelector<HTMLButtonElement>(
    "#enable-vmas-presence"
  );
  if (!bridge || !toggle) {
    return;
  }

  toggle.hidden = false;
  toggle.addEventListener("click", () => {
    const enabled = toggle.getAttribute("aria-checked") !== "true";
    bridge.postMessage({
      type: "integration-settings:set",
      vmasPresenceEnabled: enabled
    });
  });
  bridge.addEventListener("message", (event) => {
    const message = event.data as
      Partial<DesktopIntegrationSettingsMessage> | null;
    if (message?.type !== "integration-settings" ||
        typeof message.vmasPresenceEnabled !== "boolean") {
      return;
    }
    toggle.setAttribute(
      "aria-checked",
      String(message.vmasPresenceEnabled)
    );
  });
  bridge.postMessage({ type: "integration-settings:get" });
}

function ensureAssetPolling(): void {
  if (assetRefreshTimer === null) {
    assetRefreshTimer = window.setInterval(
      () => void refreshAssetManager(),
      500
    );
  }
}

function updateDownloadMode(): void {
  const countryMode =
    document.querySelector<HTMLSelectElement>("#download-mode")!.value ===
    "country";
  const icaoFields = document.querySelector<HTMLElement>("#icao-fields")!;
  const countryFields =
    document.querySelector<HTMLElement>("#country-fields")!;
  const icao = document.querySelector<HTMLInputElement>("#download-icao")!;
  const country =
    document.querySelector<HTMLInputElement>("#download-country")!;
  icaoFields.hidden = countryMode;
  countryFields.hidden = !countryMode;
  icao.required = !countryMode;
  country.required = countryMode;
}

async function submitDownload(form: HTMLFormElement): Promise<void> {
  const button =
    document.querySelector<HTMLButtonElement>("#start-download")!;
  const feedback = document.querySelector<HTMLElement>("#download-feedback")!;
  const mode =
    document.querySelector<HTMLSelectElement>("#download-mode")!.value;
  const icao = document
    .querySelector<HTMLInputElement>("#download-icao")!
    .value.trim()
    .toUpperCase();
  const countryCode = document
    .querySelector<HTMLInputElement>("#download-country")!
    .value.trim()
    .toUpperCase();
  const regionCode = document
    .querySelector<HTMLInputElement>("#download-region")!
    .value.trim()
    .toUpperCase();
  const maxParallel = Number(
    document.querySelector<HTMLSelectElement>("#download-parallel")!.value
  );

  if (!form.reportValidity()) {
    return;
  }
  if (mode === "country" &&
      regionCode &&
      !regionCode.startsWith(`${countryCode}-`)) {
    feedback.textContent = t("error.region", { country: countryCode });
    feedback.className = "feedback error";
    return;
  }

  button.disabled = true;
  feedback.textContent =
    t("feedback.queued", {
      scope: mode === "icao" ? icao : regionCode || countryCode
    });
  feedback.className = "feedback";
  try {
    await requestJson<DownloadJob>("/api/v1/downloads", {
      method: "POST",
      body: JSON.stringify({
        mode,
        icao: mode === "icao" ? icao : null,
        countryCode: mode === "country" ? countryCode : null,
        regionCode: mode === "country" && regionCode ? regionCode : null,
        maxParallel: mode === "country" ? maxParallel : 1
      })
    });
    feedback.textContent = t("feedback.downloadQueued");
    feedback.className = "feedback success";
    ensureAssetPolling();
    await refreshAssetManager();
  } catch (error) {
    feedback.textContent =
      error instanceof Error ? error.message : String(error);
    feedback.className = "feedback error";
  } finally {
    button.disabled = false;
  }
}

function refreshAssetManager(): Promise<boolean> {
  if (assetRefreshPromise) return assetRefreshPromise;
  assetRefreshPromise = performAssetRefresh().finally(() => {
    assetRefreshPromise = null;
  });
  return assetRefreshPromise;
}

async function performAssetRefresh(): Promise<boolean> {
  try {
    const [storage, jobs] = await Promise.all([
      getJson<StorageSummary>("/api/v1/storage"),
      getJson<DownloadJob[]>("/api/v1/downloads")
    ]);
    installedAssets = storage.assets;
    latestDownloadJobs = jobs;
    syncFlightPlanAirportStatuses(jobs);
    renderStorage(storage);
    renderDownloadJobs(jobs);
    renderAirportPicker(
      document.querySelector<HTMLInputElement>("#airport-search")!.value
    );

    if (pendingAirportIcao &&
        installedAssets.some((asset) => asset.icao === pendingAirportIcao)) {
      const downloadedIcao = pendingAirportIcao;
      const activation = pendingAirportActivation;
      pendingAirportIcao = null;
      pendingAirportActivation = null;
      if (!activation || activation.isCurrent()) {
        await loadAirport(downloadedIcao, activation?.isCurrent);
        if (!activation || activation.isCurrent()) {
          const feedback =
            document.querySelector<HTMLElement>("#airport-picker-feedback")!;
          feedback.textContent = t("airport.installed", {
            icao: downloadedIcao
          });
          feedback.className = "feedback success";
        }
      }
    }

    activeDownloads = jobs.some(
      (job) => job.state === "queued" || job.state === "running"
    );
    if (activeDownloads || pendingAirportIcao || assetPanelOpen) {
      ensureAssetPolling();
    } else if (assetRefreshTimer !== null) {
      window.clearInterval(assetRefreshTimer);
      assetRefreshTimer = null;
    }
    return true;
  } catch (error) {
    const feedback =
      document.querySelector<HTMLElement>("#download-feedback");
    if (feedback) {
      feedback.textContent =
        `${t("error.request", { status: "asset refresh" })} ${
          error instanceof Error ? error.message : String(error)
        }`;
      feedback.className = "feedback error";
    }
    return false;
  }
}

function renderStorage(storage: StorageSummary): void {
  document.querySelector("#storage-used")!.textContent =
    formatBytes(storage.totalBytes);
  document.querySelector("#storage-free")!.textContent =
    formatBytes(storage.freeBytes);
  document.querySelector("#storage-count")!.textContent =
    String(storage.airportCount);

  const list = document.querySelector<HTMLElement>("#asset-list")!;
  for (const group of list.querySelectorAll<HTMLDetailsElement>(
    "details[data-group-key]"
  )) {
    assetGroupOpenState.set(group.dataset.groupKey!, group.open);
  }
  list.replaceChildren();
  if (storage.assets.length === 0) {
    list.append(createEmptyState(t("storage.empty")));
    return;
  }

  const countries = groupBy(
    storage.assets,
    (asset) => asset.countryCode || "ZZ"
  );
  for (const [countryCode, countryAssets] of [...countries].sort()) {
    const countryKey = `country:${countryCode}`;
    const country = document.createElement("details");
    country.className = "asset-group asset-country";
    country.dataset.groupKey = countryKey;
    country.open = assetGroupOpenState.get(countryKey) ?? true;
    country.addEventListener("toggle", () => {
      assetGroupOpenState.set(countryKey, country.open);
    });
    country.append(
      createAssetGroupSummary(
        formatCountryName(countryCode, getLocale()),
        countryAssets,
        "country"
      )
    );

    const regions = groupBy(
      countryAssets,
      (asset) => asset.regionCode || "__other__"
    );
    for (const [regionCode, regionAssets] of [...regions].sort()) {
      const regionKey = `${countryKey}/region:${regionCode}`;
      const region = document.createElement("details");
      region.className = "asset-group asset-region";
      region.dataset.groupKey = regionKey;
      region.open = assetGroupOpenState.get(regionKey) ?? true;
      region.addEventListener("toggle", () => {
        assetGroupOpenState.set(regionKey, region.open);
      });
      region.append(
        createAssetGroupSummary(
          regionCode === "__other__"
            ? t("storage.otherRegion")
            : formatRegionName(regionCode, getLocale()),
          regionAssets,
          "region"
        )
      );
      const airports = document.createElement("div");
      airports.className = "asset-airports";
      for (const asset of regionAssets.sort((left, right) =>
        left.icao.localeCompare(right.icao))) {
        airports.append(createAssetRow(asset));
      }
      region.append(airports);
      country.append(region);
    }
    list.append(country);
  }
}

function createAssetGroupSummary(
  label: string,
  assets: StoredMapAsset[],
  groupType: "country" | "region"
): HTMLElement {
  const summary = document.createElement("summary");
  const name = document.createElement("strong");
  name.textContent = label;
  const metadata = document.createElement("span");
  metadata.className = "asset-group-metadata";
  metadata.textContent = t(
    assets.length === 1 ? "storage.groupMetaOne" : "storage.groupMeta",
    {
      count: assets.length,
      size: formatBytes(
        assets.reduce((sum, asset) => sum + asset.sizeBytes, 0)
      )
    }
  );
  const actions = document.createElement("span");
  actions.className = "asset-group-actions";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger-button asset-group-delete";
  remove.textContent = t("storage.deleteGroup");
  remove.title = t("storage.deleteGroup");
  remove.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void deleteAssetGroup(label, groupType, assets, remove);
  });
  actions.append(metadata, remove);
  summary.append(name, actions);
  return summary;
}

async function deleteAssetGroup(
  label: string,
  groupType: "country" | "region",
  assets: StoredMapAsset[],
  button: HTMLButtonElement
): Promise<void> {
  const confirmed = window.confirm(
    t("storage.confirmGroup", {
      count: assets.length,
      name: label
    })
  );
  if (!confirmed) {
    return;
  }
  button.disabled = true;
  const failures: string[] = [];
  for (const asset of assets) {
    try {
      await requestJson<void>(
        `/api/v1/assets/${encodeURIComponent(asset.icao)}`,
        { method: "DELETE" }
      );
    } catch {
      failures.push(asset.icao);
    }
  }
  await refreshAssetManager();
  if (failures.length > 0) {
    window.alert(`${t("error.request", { status: "delete" })} ${
      failures.join(", ")
    }.`);
  }
}

function groupBy<T>(
  values: T[],
  keySelector: (value: T) => string
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keySelector(value);
    const group = groups.get(key);
    if (group) {
      group.push(value);
    } else {
      groups.set(key, [value]);
    }
  }
  return groups;
}

function createAssetRow(asset: StoredMapAsset): HTMLElement {
  const row = document.createElement("article");
  row.className = "asset-row";
  const details = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = asset.icao;
  const name = document.createElement("span");
  name.textContent = asset.name;
  const metadata = document.createElement("small");
  const country = asset.countryCode
    ? formatCountryName(asset.countryCode, getLocale())
    : "";
  const region = asset.regionCode
    ? formatRegionName(asset.regionCode, getLocale())
    : "";
  metadata.textContent =
    `${country}${region ? ` · ${region}` : ""}` +
    ` · ${formatBytes(asset.sizeBytes)} · ${asset.sourceMix}`;
  details.append(title, name, metadata);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger-button";
  remove.textContent = t("storage.delete");
  remove.title = t("storage.deleteAirport", { icao: asset.icao });
  remove.addEventListener("click", async () => {
    if (!window.confirm(t("storage.confirmAirport", { icao: asset.icao }))) {
      return;
    }
    remove.disabled = true;
    try {
      await requestJson<void>(
        `/api/v1/assets/${encodeURIComponent(asset.icao)}`,
        { method: "DELETE" }
      );
      await refreshAssetManager();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
      remove.disabled = false;
    }
  });
  row.append(details, remove);
  return row;
}

function renderDownloadJobs(jobs: DownloadJob[]): void {
  const list = document.querySelector<HTMLElement>("#download-jobs")!;
  const clear =
    document.querySelector<HTMLButtonElement>("#clear-downloads")!;
  clear.disabled = !jobs.some(
    (job) => job.state === "completed" ||
      job.state === "failed" ||
      job.state === "cancelled"
  );
  list.replaceChildren();
  if (jobs.length === 0) {
    list.append(createEmptyState(t("download.empty")));
    return;
  }

  const activeJobIds = new Set(jobs.map((job) => job.jobId));
  for (const jobId of downloadProgressWatch.keys()) {
    if (!activeJobIds.has(jobId)) {
      downloadProgressWatch.delete(jobId);
    }
  }

  for (const job of jobs) {
    const now = Date.now();
    const fingerprint = [
      job.state,
      job.phase,
      job.airportsCompleted,
      job.bytesDownloaded,
      Math.round(job.percentage * 10),
      job.currentIcao,
      job.currentSource
    ].join("|");
    const previousWatch = downloadProgressWatch.get(job.jobId);
    const watch = !previousWatch || previousWatch.fingerprint !== fingerprint
      ? { fingerprint, changedAt: now }
      : previousWatch;
    downloadProgressWatch.set(job.jobId, watch);
    const waitingForSource = job.phase.includes("waiting") ||
      job.phase.includes("requesting") ||
      job.phase.includes("acquiring");
    const stalledForMilliseconds = now - watch.changedAt;
    const stalled = job.state === "running" &&
      waitingForSource &&
      stalledForMilliseconds >= 45_000;

    const row = document.createElement("article");
    row.className = `job-row job-${stalled ? "stalled" : job.state}`;
    const heading = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = job.currentIcao || t("job.airports", {
      completed: job.airportsCompleted,
      total: job.airportsTotal
    });
    const state = document.createElement("span");
    state.className = "job-state";
    state.textContent = t(`job.${stalled ? "stalled" : job.state}`);
    heading.append(title, state);

    const progress = document.createElement("progress");
    progress.max = 100;
    const indeterminate = isIndeterminateDownload(job);
    if (indeterminate) {
      progress.className = "job-progress-indeterminate";
      progress.setAttribute(
        "aria-label",
        job.state === "queued"
          ? t("job.queuedAria")
          : t("job.waitingAria")
      );
    } else {
      progress.value = Math.max(0, Math.min(100, job.percentage));
      progress.setAttribute(
        "aria-label",
        t("job.downloadAria", {
          percentage: formatDownloadPercentage(job.percentage)
        })
      );
    }
    const detail = document.createElement("small");
    const warningPreview = job.warnings.find(
      (warning) =>
        warning.includes("skipped") || warning.includes("fallback failed")
    ) || job.warnings[0];
    const completionWarning =
      job.state === "completed" && job.warnings.length > 0
        ? t("job.warning", {
          count: job.warnings.length,
          warning: warningPreview || ""
        })
        : null;
    detail.textContent = job.error || completionWarning ||
      formatPhase(job.phase) +
      (indeterminate
        ? ` · ${t("job.active")}`
        : ` · ${formatDownloadPercentage(job.percentage)}`) +
      (job.currentSource ? ` · ${job.currentSource}` : "") +
      (job.maxParallel > 1
        ? ` · ${t("job.parallel", { count: job.maxParallel })}`
        : "");
    if (job.warnings.length > 0) {
      detail.title = job.warnings.join("\n");
    }
    const metrics = document.createElement("small");
    metrics.className = "job-metrics";
    const metricParts: string[] = [];
    if (job.state === "running") {
      if (indeterminate) {
        metricParts.push(
          stalled
            ? t("job.stalledDetail", {
              elapsed: formatSeconds(stalledForMilliseconds / 1000)
            })
            : t("job.waiting", { elapsed: formatTimeSpan(job.elapsed) })
        );
      } else if (job.downloadBytesPerSecond &&
                 job.downloadBytesPerSecond > 0) {
        metricParts.push(`${formatBytes(job.downloadBytesPerSecond)}/s`);
      } else if (job.phase.includes("waiting") ||
                 job.phase.includes("requesting")) {
        metricParts.push(t("job.waitingSource"));
      }
      if (job.bytesDownloaded > 0) {
        metricParts.push(
          job.downloadBytesTotal
            ? t("job.bytes", {
              downloaded: formatBytes(job.bytesDownloaded),
              total: formatBytes(job.downloadBytesTotal)
            })
            : formatBytes(job.bytesDownloaded)
        );
      }
      if (!indeterminate) {
        metricParts.push(
          shouldShowDownloadEta(job)
            ? t("job.remaining", {
              elapsed: formatTimeSpan(job.estimatedRemaining!)
            })
            : t("job.estimating")
        );
      }
    } else if (job.state === "completed") {
      metricParts.push(t("job.installed", {
        size: formatBytes(job.bytesWritten)
      }));
    }
    metrics.textContent = metricParts.join(" · ");
    row.append(heading, progress, detail, metrics);

    if (job.state === "queued" || job.state === "running") {
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "text-button";
      cancel.textContent = t("job.cancel");
      cancel.addEventListener("click", async () => {
        cancel.disabled = true;
        await requestJson<DownloadJob>(
          `/api/v1/downloads/${encodeURIComponent(job.jobId)}/cancel`,
          { method: "POST" }
        );
        await refreshAssetManager();
      });
      row.append(cancel);
    }
    if (job.currentIcao && (stalled || job.state === "failed" || job.state === "cancelled")) {
      const fallback = document.createElement("button");
      fallback.type = "button";
      fallback.className = "text-button";
      fallback.textContent = t("job.tryFallback");
      fallback.addEventListener("click", async () => {
        fallback.disabled = true;
        try {
          await requestJson<DownloadJob>(`/api/v1/downloads/${encodeURIComponent(job.jobId)}/fallback`, { method: "POST" });
          await refreshAssetManager();
        } catch (error) {
          fallback.disabled = false;
          document.querySelector<HTMLElement>("#download-feedback")!.textContent = String(error);
        }
      });
      row.append(fallback);
    }
    list.append(row);
  }
}

function formatPhase(phase: string): string {
  const camel = phase
    .toLowerCase()
    .replace(/[_-]+(.)/g, (_, value: string) => value.toUpperCase());
  const key = `phase.${camel}`;
  const translated = t(key);
  return translated === key
    ? phase.replace(/[_-]+/g, " ").replace(/\b\w/g, (value) =>
      value.toUpperCase())
    : translated;
}

function formatSeconds(value: number): string {
  const seconds = Math.max(1, Math.floor(value));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) {
    return `${formatDurationUnit(hours, "hour")} ${
      formatDurationUnit(minutes, "minute")
    }`;
  }
  if (minutes > 0) {
    return `${formatDurationUnit(minutes, "minute")} ${
      formatDurationUnit(remainder, "second")
    }`;
  }
  return formatDurationUnit(seconds, "second");
}

function formatTimeSpan(value: string): string {
  const match = value.match(
    /^(?:(\d+)\.)?(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/
  );
  if (!match) {
    return value;
  }
  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0) + days * 24;
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);
  if (hours > 0) {
    return `${formatDurationUnit(hours, "hour")} ${
      formatDurationUnit(minutes, "minute")
    }`;
  }
  if (minutes > 0) {
    return `${formatDurationUnit(minutes, "minute")} ${
      formatDurationUnit(seconds, "second")
    }`;
  }
  return formatDurationUnit(Math.max(1, seconds), "second");
}

function formatDurationUnit(
  value: number,
  unit: "hour" | "minute" | "second"
): string {
  const locales: Record<ReturnType<typeof getLocale>, string> = {
    en: "en-US",
    "zh-Hans": "zh-CN",
    "zh-Hant": "zh-TW",
    ja: "ja-JP",
    fr: "fr-FR",
    de: "de-DE",
    ko: "ko-KR"
  };
  return new Intl.NumberFormat(locales[getLocale()], {
    style: "unit",
    unit,
    unitDisplay: "narrow"
  }).format(value);
}

function createEmptyState(message: string): HTMLParagraphElement {
  const empty = document.createElement("p");
  empty.className = "empty-state";
  empty.textContent = message;
  return empty;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${
    units[exponent]
  }`;
}

function createMap(airport: AirportMap): MapLibreMap {
  const created = new maplibregl.Map({
    container: "map",
    center: airport.airport.center,
    zoom: 13,
    pitch: 0,
    bearing: 0,
    attributionControl: false,
    style: {
      version: 8,
      sources: {},
      layers: [{ id: "background", type: "background", paint: {
        "background-color": "#0a1624"
      } }]
    }
  });
  Object.assign(window, { taxiNowMap: created });
  const diagnostics =
    document.querySelector<HTMLOutputElement>("#map-diagnostics");
  if (diagnostics) {
    diagnostics.dataset.initialized = "true";
  }
  created.on("error", (event) => {
    if (diagnostics) {
      diagnostics.dataset.error = event.error.message;
    }
    console.error(event.error);
  });

  created.addControl(new TaxiNowNavigationControl(), "bottom-right");
  created.addControl(new TelemetryRefreshControl(), "bottom-right");
  created.addControl(new FitAirportControl(), "bottom-right");
  labelNavigationControls(created);
  created.once("load", () => {
    if (diagnostics) {
      diagnostics.dataset.loadEvent = "true";
    }
    try {
      created.addSource("airport", {
        type: "geojson",
        data: toFeatureCollection(airport.features)
      });
      const runwayDecorations = buildRunwayDecorations(airport.features);
      created.addSource("runway-markings", {
        type: "geojson",
        data: runwayDecorations.markings
      });
      created.addImage(
        "taxiway-label-badge-dark",
        createTaxiwayBadgeImage("#080b0e", "#56636d"),
        {
          pixelRatio: 2,
          stretchX: [[11, 33]],
          stretchY: [[9, 19]],
          content: [6, 4, 38, 24]
        }
      );
      created.addImage(
        "taxiway-label-badge-light",
        createTaxiwayBadgeImage("#34454f", "#718792"),
        {
          pixelRatio: 2,
          stretchX: [[11, 33]],
          stretchY: [[9, 19]],
          content: [6, 4, 38, 24]
        }
      );
      created.addSource("runway-pavement-labels", {
        type: "geojson",
        data: runwayDecorations.pavementLabels
      });
      created.addSource("terminal-labels", {
        type: "geojson",
        data: terminalLabelCollection(airport.features)
      });
      created.addSource("taxi-route", {
        type: "geojson",
        data: taxiRouteCollection([])
      });
      created.addSource("selected-taxiways", {
        type: "geojson",
        data: selectedTaxiwayCollection()
      });
      created.addSource("manual-taxi-points", {
        type: "geojson",
        data: manualTaxiPointCollection()
      });
      created.addSource("ownship", {
        type: "geojson",
        data: ownshipFeature(
          airport.airport.center[0],
          airport.airport.center[1],
          0,
          true,
          false
        )
      });
      addAirportLayers(created);
      addSelectedTaxiwayLayers(created);
      addTaxiRouteLayers(created);
      addManualTaxiPointLayers(created);
      applyMapTheme(
        created,
        document.documentElement.dataset.theme === "light" ? "light" : "dark"
      );
      created.addImage("ownship-plane", createOwnshipImage(), { pixelRatio: 2 });
      addOwnshipLayer(created);
      installDomOwnshipMarker(created, airport.airport.center);
      created.moveLayer("taxiway-labels");
      created.moveLayer("building-labels");
      created.moveLayer("ownship");
      startOwnshipAnimation();
      fitAirport();
      created.on("sourcedata", (event) => {
        if (event.sourceId === "airport" && event.isSourceLoaded) {
          syncFallbackOverlay(created, airport.features);
        }
      });
      created.once("idle", () => {
        publishMapDiagnostics(created);
        syncFallbackOverlay(created, airport.features);
        updateSelectedTaxiwayHighlight();
        startOwnshipAnimation();
      });
      window.setTimeout(() => {
        publishMapDiagnostics(created);
        syncFallbackOverlay(created, airport.features);
        startOwnshipAnimation();
      }, 3500);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (diagnostics) {
        diagnostics.dataset.error = message;
      }
      console.error(error);
    }
  });
  created.on("contextmenu", (event) => {
    event.originalEvent.preventDefault();
    openManualTaxiContextMenu(created, [event.lngLat.lng, event.lngLat.lat]);
  });

  // iPadOS and other touch-only browsers have no right mouse button. Treat a
  // stationary 600 ms press as the touch equivalent while preserving normal
  // single-tap, pinch-zoom, and drag-to-pan map interaction.
  const mapCanvas = created.getCanvas();
  let touchHoldTimer: number | null = null;
  let touchHoldStart: { x: number; y: number } | null = null;
  let suppressClickAfterTouchHold = false;
  const cancelTouchHold = (): void => {
    if (touchHoldTimer !== null) {
      window.clearTimeout(touchHoldTimer);
    }
    touchHoldTimer = null;
    touchHoldStart = null;
  };
  const pointInCanvas = (event: PointerEvent): { x: number; y: number } => {
    const bounds = mapCanvas.getBoundingClientRect();
    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
  };
  mapCanvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") {
      return;
    }
    cancelTouchHold();
    touchHoldStart = pointInCanvas(event);
    touchHoldTimer = window.setTimeout(() => {
      touchHoldTimer = null;
      if (!touchHoldStart) {
        return;
      }
      const lngLat = created.unproject([touchHoldStart.x, touchHoldStart.y]);
      suppressClickAfterTouchHold = true;
      openManualTaxiContextMenu(created, [lngLat.lng, lngLat.lat]);
      touchHoldStart = null;
    }, 600);
  });
  mapCanvas.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "touch" || !touchHoldStart) {
      return;
    }
    const current = pointInCanvas(event);
    if (Math.hypot(current.x - touchHoldStart.x, current.y - touchHoldStart.y) > 12) {
      cancelTouchHold();
    }
  });
  mapCanvas.addEventListener("pointerup", cancelTouchHold);
  mapCanvas.addEventListener("pointercancel", cancelTouchHold);
  mapCanvas.addEventListener("pointerleave", cancelTouchHold);
  created.on("click", () => {
    if (suppressClickAfterTouchHold) {
      suppressClickAfterTouchHold = false;
      return;
    }
    closeManualTaxiContextMenu();
  });
  return created;
}

function applyMapTheme(
  target: MapLibreMap,
  theme: "dark" | "light"
): void {
  const light = theme === "light";
  const set = (layer: string, property: string, value: unknown): void => {
    if (target.getLayer(layer)) {
      target.setPaintProperty(layer, property as never, value as never);
    }
  };
  set("background", "background-color", light ? "#edf3f6" : "#0a1624");
  set("aprons", "fill-color", light ? "#c7d3db" : "#2a3948");
  set("aprons", "fill-outline-color", light ? "#9aacb8" : "#53677b");
  set("terminals", "fill-color", light ? "#f6f8fa" : "#8795a4");
  set("terminals", "fill-outline-color", light ? "#8699a8" : "#d8e1e8");
  set("runway-outline", "line-color", light ? "#ffffff" : "#dce3e8");
  set("runways", "fill-color", light ? "#26343d" : "#15191f");
  set("taxiway-outline", "line-color", light ? "#9fafb9" : "#252a2e");
  set("taxiways", "line-color", light ? "#d5dfe5" : "#686d71");
  set("taxiway-centerlines", "line-color", light ? "#d4aa00" : "#f7d24b");
  set("stand-lead-in-lines", "line-color", light ? "#617f70" : "#8cb89e");
  set("taxiway-labels", "text-color", "#ffd52f");
  set("taxiway-labels", "text-halo-color", "#ffd52f");
  if (target.getLayer("taxiway-labels")) {
    target.setLayoutProperty(
      "taxiway-labels",
      "icon-image",
      light ? "taxiway-label-badge-light" : "taxiway-label-badge-dark"
    );
  }
  set("building-labels", "text-color", light ? "#283946" : "#eef4f8");
  set("building-labels", "text-halo-color", light ? "#f7fafb" : "#263442");
  set("stand-labels", "text-color", light ? "#28414a" : "#dffaf4");
  set("stand-labels", "text-halo-color", light ? "#edf3f6" : "#0a1624");
  set("taxi-route-casing", "line-color", light ? "#ffffff" : "#07131e");
}

function openManualTaxiContextMenu(
  target: MapLibreMap,
  coordinate: Coordinate
): void {
  closeManualTaxiContextMenu();
  const menu = document.createElement("div");
  menu.className = "manual-taxi-menu";
  const popup = new maplibregl.Popup({
    className: "manual-taxi-popup",
    closeButton: false,
    closeOnClick: true,
    closeOnMove: true,
    offset: 8
  }).setLngLat(coordinate).setDOMContent(menu).addTo(target);
  activeManualTaxiPopup = popup;
  popup.on("close", () => {
    if (activeManualTaxiPopup === popup) {
      activeManualTaxiPopup = null;
    }
  });

  const addAction = (
    label: string,
    action: () => void
  ): void => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      action();
      popup.remove();
    });
    menu.append(button);
  };
  addAction(t("taxi.addStart"), () => {
    manualTaxiStart = [...coordinate] as Coordinate;
    updateManualTaxiPoints();
    if (manualTaxiDestination) {
      findTaxiRoutes(manualTaxiDestination);
    }
  });
  addAction(t("taxi.addDestination"), () => {
    manualTaxiDestination = {
      kind: "point",
      ref: "CUSTOM",
      label: t("taxi.manualDestination"),
      coordinate: [...coordinate] as Coordinate
    };
    updateManualTaxiPoints();
    document.querySelector<HTMLButtonElement>("#open-taxi-plan")?.click();
    findTaxiRoutes(manualTaxiDestination);
  });
  if (manualTaxiStart || manualTaxiDestination) {
    addAction(t("taxi.clearPoints"), () => {
      manualTaxiStart = null;
      manualTaxiDestination = null;
      clearTaxiRoute();
      updateManualTaxiPoints();
    });
  }
}

function closeManualTaxiContextMenu(): void {
  activeManualTaxiPopup?.remove();
  activeManualTaxiPopup = null;
}

function manualTaxiPointCollection(): FeatureCollection<Point> {
  const features: Array<Feature<Point>> = [];
  if (manualTaxiStart) {
    features.push({
      type: "Feature",
      properties: { role: "start", label: "S" },
      geometry: { type: "Point", coordinates: manualTaxiStart }
    });
  }
  if (manualTaxiDestination) {
    features.push({
      type: "Feature",
      properties: { role: "destination", label: "D" },
      geometry: {
        type: "Point",
        coordinates: manualTaxiDestination.coordinate
      }
    });
  }
  return { type: "FeatureCollection", features };
}

function updateManualTaxiPoints(): void {
  if (!mapInitialized || !map?.getSource("manual-taxi-points")) {
    return;
  }
  (map.getSource("manual-taxi-points") as GeoJSONSource)
    .setData(manualTaxiPointCollection());
}

function addManualTaxiPointLayers(target: MapLibreMap): void {
  target.addLayer({
    id: "manual-taxi-points",
    type: "circle",
    source: "manual-taxi-points",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 8, 17, 14],
      "circle-color": [
        "case",
        ["==", ["get", "role"], "start"],
        "#24c78e",
        "#ff7b54"
      ],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2
    }
  });
  target.addLayer({
    id: "manual-taxi-point-labels",
    type: "symbol",
    source: "manual-taxi-points",
    layout: {
      "text-field": ["get", "label"],
      "text-size": 12,
      "text-font": ["Segoe UI", "Arial Unicode MS Regular"],
      "text-allow-overlap": true
    },
    paint: { "text-color": "#ffffff" }
  });
}

class TelemetryRefreshControl implements maplibregl.IControl {
  private container?: HTMLDivElement;

  onAdd(): HTMLElement {
    const container = document.createElement("div");
    container.className =
      "maplibregl-ctrl maplibregl-ctrl-group telemetry-refresh-control";
    const button = document.createElement("button");
    button.type = "button";
    button.title = t("map.refresh");
    button.setAttribute("aria-label", t("map.refresh"));
    button.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" ' +
      'd="M20 6v5h-5M4 18v-5h5M6.1 9a7 7 0 0 1 11.4-2.5L20 9M4 15l2.5 2.5A7 7 0 0 0 17.9 15" /></svg>';
    button.addEventListener("click", () => {
      void refreshAircraftPosition(container, button);
    });
    container.append(button);
    this.container = container;
    return container;
  }

  onRemove(): void {
    this.container?.remove();
    this.container = undefined;
  }
}

class TaxiNowNavigationControl implements maplibregl.IControl {
  private readonly navigation = new maplibregl.NavigationControl();
  private headingButton?: HTMLButtonElement;

  onAdd(target: MapLibreMap): HTMLElement {
    const container = this.navigation.onAdd(target);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "maplibregl-ctrl-heading-follow";
    button.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path fill="currentColor" d="M12 2l3.2 7.1 5.8 2.2v2.2l-5.8-.8-1.1 6.1 2.3 1.6V22L12 20.8 7.6 22v-1.6l2.3-1.6-1.1-6.1-5.8.8v-2.2l5.8-2.2L12 2z" />' +
      '<path fill="none" stroke="currentColor" stroke-width="1.7" d="M17.5 4.5h4v4" />' +
      '<path fill="none" stroke="currentColor" stroke-width="1.7" d="M21.5 8.5a7 7 0 0 0-4-6" /></svg>';
    button.addEventListener("click", () => {
      headingFollowEnabled = !headingFollowEnabled;
      writeBooleanPreference(headingFollowStorageKey, headingFollowEnabled);
      this.updateButton();
      if (headingFollowEnabled && lastRenderedOwnship?.visible) {
        lastTaxiCameraAt = 0;
        updateHeadingFollowCamera(
          [lastRenderedOwnship.longitude, lastRenderedOwnship.latitude],
          lastRenderedOwnship.heading,
          performance.now(),
          true
        );
      }
    });
    container.append(button);
    this.headingButton = button;
    this.updateButton();
    return container;
  }

  onRemove(): void {
    this.navigation.onRemove();
    this.headingButton = undefined;
  }

  private updateButton(): void {
    if (!this.headingButton) {
      return;
    }
    const label = headingFollowEnabled
      ? t("map.headingFollowDisable")
      : t("map.headingFollowEnable");
    this.headingButton.title = label;
    this.headingButton.setAttribute("aria-label", label);
    this.headingButton.setAttribute("aria-pressed", String(headingFollowEnabled));
    this.headingButton.classList.toggle("is-active", headingFollowEnabled);
  }
}

class FitAirportControl implements maplibregl.IControl {
  private container?: HTMLDivElement;

  onAdd(): HTMLElement {
    const container = document.createElement("div");
    container.className =
      "maplibregl-ctrl maplibregl-ctrl-group fit-airport-control";
    const button = document.createElement("button");
    button.type = "button";
    button.title = t("map.fit");
    button.setAttribute("aria-label", t("map.fit"));
    button.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" ' +
      'd="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></svg>';
    button.addEventListener("click", fitAirport);
    container.append(button);
    this.container = container;
    return container;
  }

  onRemove(): void {
    this.container?.remove();
    this.container = undefined;
  }
}

async function refreshAircraftPosition(
  container: HTMLElement,
  button: HTMLButtonElement
): Promise<void> {
  if (button.disabled) {
    return;
  }

  button.disabled = true;
  container.classList.add("is-refreshing");
  setStatus(t("status.refreshing"), "waiting");
  try {
    const response = await fetch("/api/v1/telemetry/refresh", {
      method: "POST"
    });
    if (!response.ok) {
      throw new Error(t("error.request", { status: response.status }));
    }
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    const latest = await getJson<TelemetrySnapshot>("/api/v1/telemetry");
    applyTelemetrySample(latest);
  } catch {
    setStatus(t("status.refreshFailed"), "error");
  } finally {
    container.classList.remove("is-refreshing");
    button.disabled = false;
  }
}

function labelNavigationControls(target: MapLibreMap): void {
  const container = target.getContainer();
  const zoomIn = container.querySelector<HTMLButtonElement>(
    ".maplibregl-ctrl-zoom-in"
  );
  const zoomOut = container.querySelector<HTMLButtonElement>(
    ".maplibregl-ctrl-zoom-out"
  );
  const compass = container.querySelector<HTMLButtonElement>(
    ".maplibregl-ctrl-compass"
  );
  if (zoomIn) {
    zoomIn.title = t("map.zoomIn");
    zoomIn.setAttribute("aria-label", t("map.zoomIn"));
  }
  if (zoomOut) {
    zoomOut.title = t("map.zoomOut");
    zoomOut.setAttribute("aria-label", t("map.zoomOut"));
  }
  if (compass) {
    const label = t("map.compass");
    compass.title = label;
    compass.setAttribute("aria-label", label);
  }
}

function addAirportLayers(target: MapLibreMap): void {
  target.addLayer({
    id: "aprons",
    type: "fill",
    source: "airport",
    filter: ["in", ["get", "kind"], ["literal", ["apron", "pavement"]]],
    paint: {
      "fill-color": "#2a3948",
      "fill-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.7, 16, 0.95],
      "fill-outline-color": "#53677b"
    }
  });
  target.addLayer({
    id: "terminals",
    type: "fill",
    source: "airport",
    filter: ["in", ["get", "kind"], ["literal", ["terminal", "hangar"]]],
    paint: {
      "fill-color": "#8795a4",
      "fill-outline-color": "#d8e1e8",
      "fill-opacity": 0.85
    }
  });
  target.addLayer({
    id: "runway-blastpads",
    type: "fill",
    source: "runway-markings",
    filter: ["==", ["get", "kind"], "blastpad"],
    paint: {
      "fill-color": "#15191f"
    }
  });
  target.addLayer({
    id: "runways",
    type: "fill",
    source: "runway-markings",
    filter: ["==", ["get", "kind"], "pavement"],
    paint: {
      "fill-color": "#15191f"
    }
  });
  target.addLayer({
    id: "runway-outline",
    type: "line",
    source: "runway-markings",
    filter: ["==", ["get", "kind"], "pavement"],
    paint: {
      "line-color": "#dce3e8",
      "line-width": [
        "interpolate", ["linear"], ["zoom"],
        10, 1.1,
        17, 2.2,
        20, 3
      ]
    }
  });
  target.addLayer({
    id: "runway-centerlines",
    type: "line",
    source: "runway-markings",
    filter: ["==", ["get", "kind"], "centerline"],
    paint: {
      "line-color": "#edf1f4",
      "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.7, 17, 2.1],
      "line-dasharray": [5, 4],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 10.5, 0, 12, 0.9]
    }
  });
  target.addLayer({
    id: "runway-leadin-chevrons",
    type: "line",
    source: "runway-markings",
    filter: ["==", ["get", "kind"], "leadin-chevron"],
    minzoom: 10.5,
    paint: {
      "line-color": "#f3d21d",
      "line-width": ["interpolate", ["linear"], ["zoom"], 10.5, 0.8, 17, 2.4],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 10.5, 0.74, 12, 1]
    },
    layout: { "line-cap": "square", "line-join": "miter" }
  });
  target.addLayer({
    id: "runway-blastpad-demarcations",
    type: "line",
    source: "runway-markings",
    filter: ["==", ["get", "kind"], "blastpad-demarcation"],
    minzoom: 10.5,
    paint: {
      "line-color": "#f5f7f8",
      "line-width": ["interpolate", ["linear"], ["zoom"], 10.5, 1, 17, 3]
    }
  });
  target.addLayer({
    id: "runway-thresholds",
    type: "line",
    source: "runway-markings",
    filter: ["==", ["get", "kind"], "threshold"],
    minzoom: 11,
    paint: {
      "line-color": "#f5f7f8",
      "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1, 17, 3]
    }
  });
  target.addLayer({
    id: "runway-aiming-points",
    type: "fill",
    source: "runway-markings",
    filter: ["==", ["get", "kind"], "aiming"],
    minzoom: 11,
    paint: {
      "fill-color": "#f5f7f8",
      "fill-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0.72, 13, 1]
    }
  });
  target.addLayer({
    id: "runway-touchdown-zone",
    type: "fill",
    source: "runway-markings",
    filter: ["==", ["get", "kind"], "touchdown"],
    minzoom: 11.5,
    paint: {
      "fill-color": "#f5f7f8",
      "fill-opacity": ["interpolate", ["linear"], ["zoom"], 11.5, 0.68, 13, 0.95]
    }
  });
  target.addLayer({
    id: "taxiway-outline",
    type: "line",
    source: "airport",
    filter: ["in", ["get", "kind"], ["literal", ["taxiway", "taxilane"]]],
    paint: {
      "line-color": "#252a2e",
      "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 10, 2.4, 17, 24]
    },
    layout: { "line-cap": "round", "line-join": "round" }
  });
  target.addLayer({
    id: "taxiways",
    type: "line",
    source: "airport",
    filter: ["in", ["get", "kind"], ["literal", ["taxiway", "taxilane"]]],
    paint: {
      "line-color": "#686d71",
      "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 10, 1.2, 17, 18]
    },
    layout: { "line-cap": "round", "line-join": "round" }
  });
  target.addLayer({
    id: "taxiway-centerlines",
    type: "line",
    source: "airport",
    filter: ["in", ["get", "kind"], ["literal", ["taxiway", "taxilane"]]],
    minzoom: 12,
    paint: {
      "line-color": "#f7d24b",
      "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 17, 1.5]
    }
  });
  target.addLayer({
    id: "stand-lead-in-lines",
    type: "line",
    source: "airport",
    filter: ["in", ["get", "kind"], ["literal", ["gate", "parking_position"]]],
    minzoom: 14,
    paint: {
      "line-color": "#8cb89e",
      "line-width": ["interpolate", ["linear"], ["zoom"], 14, 0.45, 18, 1.15],
      "line-opacity": 0.68
    },
    layout: { "line-cap": "round", "line-join": "round" }
  });
  target.addLayer({
    id: "runway-pavement-labels",
    type: "symbol",
    source: "runway-pavement-labels",
    minzoom: 11.5,
    layout: {
      "text-field": ["get", "text"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 11.5, 9.5, 17, 28],
      "text-font": ["Segoe UI Semibold", "Segoe UI", "Arial Unicode MS Regular"],
      "text-rotation-alignment": "map",
      "text-rotate": ["get", "rotation"],
      "text-keep-upright": true,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-letter-spacing": 0.025
    },
    paint: {
      "text-color": "#f7f9fb",
      "text-halo-color": "#111820",
      "text-halo-width": 1.8
    }
  });
  target.addLayer({
    id: "taxiway-labels",
    type: "symbol",
    source: "airport",
    filter: [
      "all",
      ["in", ["get", "kind"], ["literal", ["taxiway", "taxilane"]]],
      ["has", "ref"],
      ["!=", ["coalesce", ["get", "ref"], ""], ""]
    ],
    minzoom: 13.5,
    layout: {
      "icon-image": "taxiway-label-badge-dark",
      "icon-text-fit": "both",
      "icon-text-fit-padding": [0.5, 2, 0.5, 2],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": false,
      "icon-ignore-placement": false,
      "symbol-placement": "line",
      "symbol-spacing": 145,
      "text-field": ["coalesce", ["get", "ref"], ""],
      "text-size": ["interpolate", ["linear"], ["zoom"], 11, 9, 17, 13],
      "text-font": ["Segoe UI", "Arial Unicode MS Regular"],
      "text-rotation-alignment": "map",
      "text-keep-upright": true,
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "text-padding": 4
    },
    paint: {
      "text-color": "#ffd52f",
      // A very small same-colour halo thickens the glyphs without enlarging
      // the V1.3 marker plate or turning the lettering into an outline.
      "text-halo-color": "#ffd52f",
      "text-halo-width": 0.4
    }
  });
  target.addLayer({
    id: "building-labels",
    type: "symbol",
    source: "terminal-labels",
    layout: {
      "text-field": ["get", "label"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 10, 11, 16, 15],
      "text-font": ["Segoe UI", "Arial Unicode MS Regular"],
      "text-max-width": 30,
      "text-anchor": "center",
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "text-padding": 7,
      "symbol-avoid-edges": true
    },
    paint: {
      "text-color": "#eef4f8",
      "text-halo-color": "#263442",
      "text-halo-width": 2
    }
  });
  target.addLayer({
    id: "stand-labels",
    type: "symbol",
    source: "airport",
    filter: ["in", ["get", "kind"], ["literal", ["gate", "parking_position"]]],
    minzoom: 15,
    layout: {
      "text-field": ["coalesce", ["get", "ref"], ""],
      "text-size": 11,
      "text-offset": [0, 1],
      "text-anchor": "top"
    },
    paint: {
      "text-color": "#dffaf4",
      "text-halo-color": "#0a1624",
      "text-halo-width": 1.5
    }
  });

  // SkyCharts paints taxiway pavement below runway pavement, then restores
  // the yellow centerline above the runway. This keeps crossings continuous
  // without letting broad taxiway strokes obscure runway markings.
  target.moveLayer("taxiway-outline", "runway-outline");
  target.moveLayer("taxiways", "runway-outline");
}

function addOwnshipLayer(target: MapLibreMap): void {
  target.addLayer({
    id: "ownship",
    type: "symbol",
    source: "ownship",
    layout: {
      "icon-image": "ownship-plane",
      "icon-size": 0.58,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-rotate": ["get", "heading"],
      "icon-rotation-alignment": "map",
      "visibility": "none"
    },
    paint: {
      "icon-opacity": ["case", ["get", "stale"], 0.45, 1]
    }
  });
}

function addSelectedTaxiwayLayers(target: MapLibreMap): void {
  target.addLayer({
    id: "selected-taxiway-glow",
    type: "line",
    source: "selected-taxiways",
    paint: {
      "line-color": "#ff9f0a",
      "line-width": ["interpolate", ["linear"], ["zoom"], 11, 8, 17, 24],
      "line-blur": ["interpolate", ["linear"], ["zoom"], 11, 2, 17, 7],
      "line-opacity": 0.45
    },
    layout: { "line-cap": "round", "line-join": "round" }
  });
  target.addLayer({
    id: "selected-taxiway-highlight",
    type: "line",
    source: "selected-taxiways",
    paint: {
      "line-color": "#ffb000",
      "line-width": ["interpolate", ["linear"], ["zoom"], 11, 3, 17, 8],
      "line-opacity": 0.94
    },
    layout: { "line-cap": "round", "line-join": "round" }
  });
}

function addTaxiRouteLayers(target: MapLibreMap): void {
  target.addLayer({
    id: "taxi-route-casing",
    type: "line",
    source: "taxi-route",
    paint: {
      "line-color": "#07131e",
      "line-width": ["interpolate", ["linear"], ["zoom"], 11, 9, 17, 18],
      "line-opacity": 0.94
    },
    layout: { "line-cap": "round", "line-join": "round" }
  });
  target.addLayer({
    id: "taxi-route-highlight",
    type: "line",
    source: "taxi-route",
    paint: {
      "line-color": "#16b5ff",
      "line-width": ["interpolate", ["linear"], ["zoom"], 11, 6, 17, 12],
      "line-opacity": 1
    },
    layout: { "line-cap": "round", "line-join": "round" }
  });
}

function selectedTaxiwayCollection(): FeatureCollection {
  if (!currentAirportMap || selectedTaxiwaySequence.length === 0) {
    return { type: "FeatureCollection", features: [] };
  }
  const selected = new Set(
    selectedTaxiwaySequence.map((ref) => ref.trim().toUpperCase())
  );
  return toFeatureCollection(currentAirportMap.features.filter((feature) =>
    (feature.kind === "taxiway" || feature.kind === "taxilane") &&
    Boolean(feature.ref) &&
    selected.has(feature.ref!.trim().toUpperCase())
  ));
}

function updateSelectedTaxiwayHighlight(): void {
  if (mapInitialized && map?.isStyleLoaded()) {
    const source = map.getSource("selected-taxiways") as GeoJSONSource | undefined;
    source?.setData(selectedTaxiwayCollection());
  }
  fallbackOverlayRedraw?.();
  if (selectedTaxiwaySequence.length > 0) {
    startTaxiwaySelectionAnimation();
  } else {
    stopTaxiwaySelectionAnimation();
  }
}

function startTaxiwaySelectionAnimation(): void {
  if (taxiwaySelectionAnimationFrame !== null) {
    return;
  }
  const animate = (frameTime: number): void => {
    if (selectedTaxiwaySequence.length === 0) {
      taxiwaySelectionAnimationFrame = null;
      return;
    }
    if (
      frameTime - lastTaxiwaySelectionPaintAt >= 70 &&
      mapInitialized &&
      map?.isStyleLoaded() &&
      map.getLayer("selected-taxiway-glow")
    ) {
      lastTaxiwaySelectionPaintAt = frameTime;
      const pulse = (Math.sin(frameTime / 420) + 1) / 2;
      map.setPaintProperty(
        "selected-taxiway-glow",
        "line-opacity",
        0.24 + pulse * 0.55
      );
      map.setPaintProperty(
        "selected-taxiway-highlight",
        "line-opacity",
        0.72 + pulse * 0.25
      );
    }
    taxiwaySelectionAnimationFrame = requestAnimationFrame(animate);
  };
  taxiwaySelectionAnimationFrame = requestAnimationFrame(animate);
}

function stopTaxiwaySelectionAnimation(): void {
  if (taxiwaySelectionAnimationFrame !== null) {
    cancelAnimationFrame(taxiwaySelectionAnimationFrame);
    taxiwaySelectionAnimationFrame = null;
  }
  lastTaxiwaySelectionPaintAt = 0;
}

async function connectTelemetry(): Promise<void> {
  try {
    const initial = await getJson<TelemetrySnapshot>("/api/v1/telemetry");
    applyTelemetrySample(initial);
  } catch {
    setStatus(t("status.checking"), "waiting");
  }

  const connection = new HubConnectionBuilder()
    .withUrl("/hubs/telemetry")
    .withAutomaticReconnect()
    .configureLogging(LogLevel.Warning)
    .build();
  connection.on("TelemetryUpdated", (sample: TelemetrySnapshot) => {
    applyTelemetrySample(sample);
  });
  connection.onreconnecting(() =>
    setStatus(t("status.reconnecting"), "waiting"));
  connection.onclose(() =>
    setStatus(t("status.lost"), "error"));
  await connection.start();
}

function applyTelemetrySample(sample: TelemetrySnapshot): void {
  updateFlightDeckPosition(sample);
  if (sample.hasPosition) {
    telemetrySamples.push(sample);
    while (telemetrySamples.length > 2) {
      telemetrySamples.shift();
    }
    setStatus(
      sample.simulator === "xPlane12"
        ? (t("flightdeck.xplaneSynced"))
        : t("status.synced"),
      "connected"
    );
    if (!sample.onGround) {
      automaticAirportSelectionSuspended = false;
    } else if (shouldIdentifyCurrentAirport(
      sample,
      airportPerimeter,
      automaticAirportSelectionSuspended
    )) {
      void synchronizeAirportWithPosition(sample);
    }
  } else {
    telemetrySamples.length = 0;
    lastRenderedOwnship = null;
    setStatus(
      sample.state === "disconnected"
        ? t("status.simulatorStopped")
        : t("status.flightStopped"),
      sample.state === "disconnected" ? "error" : "waiting"
    );
  }
}

async function synchronizeAirportWithPosition(
  sample: TelemetrySnapshot
): Promise<void> {
  if (airportDetectionInFlight ||
      performance.now() - lastAirportDetectionAt <
        airportDetectionIntervalMilliseconds) {
    return;
  }

  airportDetectionInFlight = true;
  lastAirportDetectionAt = performance.now();
  try {
    const query = new URLSearchParams({
      latitude: String(sample.latitude),
      longitude: String(sample.longitude)
    });
    const result = await getJson<NearestAirportResponse>(
      `/api/v1/airports/nearest?${query}`
    );
    const latest = telemetrySamples.at(-1);
    if (!result.airport ||
        !latest?.connected ||
        !latest.onGround ||
        automaticAirportSelectionSuspended) {
      return;
    }

    const icao = result.airport.icao.toUpperCase();
    if (icao === selectedAirportIcao) {
      lastPromptedAirportIcao = null;
      return;
    }

    if (result.installed) {
      lastPromptedAirportIcao = null;
      await loadAirport(icao);
      setStatus(t("airport.autoSwitched", { icao }), "connected");
      return;
    }

    if (lastPromptedAirportIcao === icao) {
      return;
    }
    lastPromptedAirportIcao = icao;
    const search =
      document.querySelector<HTMLInputElement>("#airport-search")!;
    search.value = icao;
    setAirportPickerOpen(true);
    const feedback =
      document.querySelector<HTMLElement>("#airport-picker-feedback")!;
    feedback.textContent = t("airport.currentNotDownloaded", {
      icao,
      name: result.airport.name
    });
    feedback.className = "feedback error";
  } catch (error) {
    console.warn("Unable to identify the current airport.", error);
  } finally {
    airportDetectionInFlight = false;
  }
}

function renderOwnship(frameTime = performance.now()): void {
  if (frameTime - lastOwnshipFrameAt < 33) {
    requestAnimationFrame(renderOwnship);
    return;
  }
  lastOwnshipFrameAt = frameTime;
  const ownship = interpolateOwnship(telemetrySamples, Date.now());
  if (ownship) {
    const renderedOwnship: InterpolatedOwnship = {
      ...ownship,
      visible:
        ownship.visible &&
        isPointInsideBounds(
          ownship.longitude,
          ownship.latitude,
          airportPerimeter
        )
    };
    const mapSource = map?.isStyleLoaded() && map.getLayer("ownship")
      ? map.getSource("ownship") as GeoJSONSource | undefined
      : undefined;
    const mapReady = Boolean(mapSource);
    const fallbackReady = fallbackOwnship !== null;
    const domReady = domOwnshipMarker !== null && domOwnshipElement !== null;
    const frameChanged = !isSameOwnshipFrame(
      lastRenderedOwnship,
      renderedOwnship
    );
    if (frameChanged) {
      ownshipMapSynchronized = false;
      fallbackOwnshipSynchronized = false;
      domOwnshipSynchronized = false;
    }
    if (!mapReady) {
      ownshipMapSynchronized = false;
    }
    if (!fallbackReady) {
      fallbackOwnshipSynchronized = false;
    }
    if (!domReady) {
      domOwnshipSynchronized = false;
    }
    const rendererNeedsSynchronization = ownshipNeedsSynchronization(
      lastRenderedOwnship,
      renderedOwnship,
      {
        map: { ready: mapReady, synchronized: ownshipMapSynchronized },
        fallback: {
          ready: fallbackReady,
          synchronized: fallbackOwnshipSynchronized
        }
      }
    ) || (domReady && !domOwnshipSynchronized);
    if (!rendererNeedsSynchronization) {
      if (headingFollowEnabled && ownship.visible && !ownship.stale) {
        updateHeadingFollowCamera(
          [renderedOwnship.longitude, renderedOwnship.latitude],
          renderedOwnship.heading,
          frameTime
        );
      }
      requestAnimationFrame(renderOwnship);
      return;
    }
    lastRenderedOwnship = renderedOwnship;
    if (mapSource) {
      mapSource.setData(
        ownshipFeature(
          renderedOwnship.longitude,
          renderedOwnship.latitude,
          renderedOwnship.heading,
          renderedOwnship.stale,
          renderedOwnship.visible
        )
      );
      map.setLayoutProperty(
        "ownship",
        "visibility",
        renderedOwnship.visible && !domReady ? "visible" : "none"
      );
      ownshipMapSynchronized = true;
    }
    if (fallbackOwnship) {
      const point = map.project([
        renderedOwnship.longitude,
        renderedOwnship.latitude
      ]);
      fallbackOwnship.setAttribute(
        "transform",
        `translate(${point.x} ${point.y}) rotate(${renderedOwnship.heading})`
      );
      fallbackOwnship.style.display = renderedOwnship.visible && !domReady
        ? ""
        : "none";
      fallbackOwnship.style.opacity = renderedOwnship.stale ? "0.45" : "1";
      fallbackOwnshipSynchronized = true;
    }
    if (domOwnshipMarker && domOwnshipElement) {
      domOwnshipMarker
        .setLngLat([renderedOwnship.longitude, renderedOwnship.latitude])
        .setRotation(renderedOwnship.heading);
      domOwnshipElement.style.visibility = renderedOwnship.visible
        ? "visible"
        : "hidden";
      const shape = domOwnshipElement.firstElementChild as SVGElement | null;
      if (shape) {
        shape.style.opacity = renderedOwnship.stale ? "0.45" : "1";
      }
      domOwnshipSynchronized = true;
    }
    ownshipVisible = renderedOwnship.visible;
    if (renderedOwnship.visible && activeTaxiRoute) {
      updateActiveTaxiGuidance(
        [renderedOwnship.longitude, renderedOwnship.latitude],
        renderedOwnship.heading,
        frameTime
      );
    }
    if (ownship.visible && !ownship.stale && headingFollowEnabled) {
      updateHeadingFollowCamera(
        [renderedOwnship.longitude, renderedOwnship.latitude],
        renderedOwnship.heading,
        frameTime
      );
    }
  } else if (ownshipVisible) {
    if (map?.isStyleLoaded() && map.getLayer("ownship")) {
      map.setLayoutProperty("ownship", "visibility", "none");
    }
    if (fallbackOwnship) {
      fallbackOwnship.style.display = "none";
    }
    if (domOwnshipElement) {
      domOwnshipElement.style.visibility = "hidden";
    }
    ownshipVisible = false;
  }
  requestAnimationFrame(renderOwnship);
}

function startOwnshipAnimation(): void {
  if (!ownshipAnimationStarted) {
    ownshipAnimationStarted = true;
    requestAnimationFrame(renderOwnship);
  }
}

function fitAirport(): void {
  map.fitBounds(airportBounds, {
    padding: { top: 78, right: 38, bottom: 58, left: 38 },
    duration: 600,
    maxZoom: 14
  });
}

function updateActiveTaxiGuidance(
  position: Coordinate,
  heading: number,
  frameTime = performance.now()
): void {
  if (!activeTaxiRoute) {
    return;
  }
  const progress = updateTaxiRouteProgress(
    activeTaxiRoute,
    position,
    activeTaxiSegmentIndex
  );
  activeTaxiSegmentIndex = progress.segmentIndex;
  setTaxiRouteGeometry(progress.remainingCoordinates);

  const instruction = document.querySelector<HTMLElement>(
    "#taxi-guidance-instruction"
  )!;
  const meta = document.querySelector<HTMLElement>("#taxi-guidance-meta")!;
  const symbol = document.querySelector<HTMLElement>("#taxi-guidance-symbol")!;
  if (progress.remainingMeters <= 22 && progress.offRouteMeters <= 35) {
    instruction.textContent = t("taxi.completed");
    meta.textContent = "";
    symbol.textContent = "✓";
    setTaxiRouteGeometry([]);
    activeTaxiRoute = null;
    return;
  }
  if (progress.offRouteMeters > 75) {
    instruction.textContent = t("taxi.offRoute", {
      distance: formatTaxiDistance(progress.offRouteMeters)
    });
    symbol.textContent = "!";
  } else if (progress.maneuver === "left" && progress.nextRef) {
    instruction.textContent = t("taxi.turnLeft", {
      taxiway: progress.nextRef,
      distance: formatTaxiDistance(progress.distanceToManeuverMeters)
    });
    symbol.textContent = "↰";
  } else if (progress.maneuver === "right" && progress.nextRef) {
    instruction.textContent = t("taxi.turnRight", {
      taxiway: progress.nextRef,
      distance: formatTaxiDistance(progress.distanceToManeuverMeters)
    });
    symbol.textContent = "↱";
  } else if (progress.nextRef) {
    instruction.textContent = t("taxi.continueOn", {
      taxiway: progress.nextRef,
      distance: formatTaxiDistance(progress.distanceToManeuverMeters)
    });
    symbol.textContent = "↑";
  } else if (progress.remainingMeters < 70) {
    instruction.textContent = t("taxi.arrive", {
      destination: activeTaxiRoute.destination.label
    });
    symbol.textContent = "●";
  } else {
    instruction.textContent = t("taxi.continueTo", {
      destination: activeTaxiRoute.destination.label
    });
    symbol.textContent = "↑";
  }
  meta.textContent = t("taxi.remaining", {
    distance: formatTaxiDistance(progress.remainingMeters)
  });

  if (
    !headingFollowEnabled &&
    frameTime - lastTaxiCameraAt >= 900 &&
    map?.isStyleLoaded() &&
    !map.isMoving()
  ) {
    lastTaxiCameraAt = frameTime;
    map.easeTo({
      center: position,
      bearing: heading,
      zoom: Math.max(map.getZoom(), 16),
      duration: 550,
      essential: true
    });
  }
}

function updateHeadingFollowCamera(
  position: Coordinate,
  heading: number,
  frameTime: number,
  force = false
): void {
  const timestamp = Date.parse(telemetrySamples.at(-1)?.serverTimestampUtc ?? '');
  if (!Number.isFinite(timestamp) || Date.now() - timestamp >= 15_000) return;
  if (
    !map || document.body.dataset.mapView === 'globe' ||
    (!force && frameTime - lastTaxiCameraAt < 250)
  ) {
    return;
  }
  lastTaxiCameraAt = frameTime;
  const canvasHeight = map.getCanvas().clientHeight;
  const panel = document.querySelector<HTMLElement>('#taxi-plan-panel');
  const canvas = map.getCanvas().getBoundingClientRect();
  const panelBounds = panel?.classList.contains('open') ? panel.getBoundingClientRect() : undefined;
  const coveredWidth = panelBounds && panelBounds.width < canvas.width * 0.7
    ? Math.max(0, Math.min(canvas.width, panelBounds.right - canvas.left)) : 0;
  followAircraft(map, position, heading, [coveredWidth / 2, Math.min(220, canvasHeight * 0.23)], 16);
}

function setTaxiRouteGeometry(coordinates: Coordinate[]): void {
  renderedTaxiRouteCoordinates = coordinates.map(
    (coordinate) => [...coordinate] as Coordinate
  );
  if (!map) {
    return;
  }
  const source = map.getSource("taxi-route") as GeoJSONSource | undefined;
  source?.setData(taxiRouteCollection(renderedTaxiRouteCoordinates));
  updateFallbackTaxiRoute(map);
}

function updateFallbackTaxiRoute(target: MapLibreMap): void {
  if (!fallbackTaxiRouteCasing || !fallbackTaxiRouteHighlight) {
    return;
  }
  if (renderedTaxiRouteCoordinates.length < 2) {
    fallbackTaxiRouteCasing.style.display = "none";
    fallbackTaxiRouteHighlight.style.display = "none";
    return;
  }
  const points = renderedTaxiRouteCoordinates
    .map((coordinate) => target.project(coordinate))
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
  const zoom = target.getZoom();
  const routeWidth = Math.max(6, Math.min(12, 6 + (zoom - 11)));
  fallbackTaxiRouteCasing.setAttribute("points", points);
  fallbackTaxiRouteCasing.setAttribute("stroke-width", String(routeWidth + 6));
  fallbackTaxiRouteCasing.style.display = "";
  fallbackTaxiRouteHighlight.setAttribute("points", points);
  fallbackTaxiRouteHighlight.setAttribute("stroke-width", String(routeWidth));
  fallbackTaxiRouteHighlight.style.display = "";
}

function taxiRouteCollection(
  coordinates: Coordinate[]
): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: coordinates.length >= 2
      ? [{
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates }
      }]
      : []
  };
}

function fitTaxiRoute(coordinates: Coordinate[]): void {
  if (!map || coordinates.length < 2) {
    return;
  }
  const bounds = new maplibregl.LngLatBounds(
    coordinates[0],
    coordinates[0]
  );
  for (const coordinate of coordinates.slice(1)) {
    bounds.extend(coordinate);
  }
  map.fitBounds(bounds, {
    padding: { top: 135, right: 55, bottom: 75, left: 420 },
    duration: 600,
    maxZoom: 16.5
  });
}

function formatTaxiDistance(distanceMeters: number): string {
  if (distanceMeters >= 1000) {
    return `${(distanceMeters / 1000).toFixed(distanceMeters >= 10_000 ? 0 : 1)} km`;
  }
  return `${Math.max(0, Math.round(distanceMeters / 10) * 10)} m`;
}

function toFeatureCollection(
  features: AirportFeature[]
): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: features.map((feature) => ({
      type: "Feature",
      id: feature.id,
      properties: {
        id: feature.id,
        kind: feature.kind,
        ref: feature.ref ?? "",
        name: feature.name ?? "",
        widthMeters: feature.widthMeters ?? 0,
        closed: feature.closed,
        source: feature.source
      },
      geometry: toGeometry(feature)
    }))
  };
}

function terminalLabelCollection(
  features: AirportFeature[]
): FeatureCollection<Point> {
  const selected = selectTerminalLabelFeatures(features);
  return {
    type: "FeatureCollection",
    features: selected.map((feature) => {
      const points = feature.points.length > 1 &&
        feature.points[0]![0] === feature.points.at(-1)![0] &&
        feature.points[0]![1] === feature.points.at(-1)![1]
        ? feature.points.slice(0, -1)
        : feature.points;
      return {
        type: "Feature",
        properties: { label: feature.name?.trim() || feature.ref?.trim() || "" },
        geometry: {
          type: "Point",
          coordinates: terminalLabelPoint(points)
        }
      };
    })
  };
}

function selectTerminalLabelFeatures(
  features: AirportFeature[]
): AirportFeature[] {
  const selected = new Map<string, AirportFeature>();
  for (const feature of features) {
    if (feature.kind !== "terminal") {
      continue;
    }
    const label = feature.name?.trim() || feature.ref?.trim();
    if (!label) {
      continue;
    }
    const existing = selected.get(label.toLowerCase());
    if (!existing || polygonArea(feature.points) > polygonArea(existing.points)) {
      selected.set(label.toLowerCase(), feature);
    }
  }
  return [...selected.values()];
}

function polygonArea(points: [number, number][]): number {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(area) / 2;
}

function terminalLabelPoint(
  points: [number, number][]
): [number, number] {
  if (points.length < 3) {
    return points[0] ?? [0, 0];
  }
  const minLon = Math.min(...points.map((point) => point[0]));
  const maxLon = Math.max(...points.map((point) => point[0]));
  const minLat = Math.min(...points.map((point) => point[1]));
  const maxLat = Math.max(...points.map((point) => point[1]));
  const candidates: [number, number][] = [
    polygonCentroid(points),
    [(minLon + maxLon) / 2, (minLat + maxLat) / 2]
  ];
  for (let row = 1; row < 16; row++) {
    for (let column = 1; column < 16; column++) {
      candidates.push([
        minLon + (maxLon - minLon) * column / 16,
        minLat + (maxLat - minLat) * row / 16
      ]);
    }
  }

  let best = points[0]!;
  let bestDistance = -1;
  for (const candidate of candidates) {
    if (!pointInPolygon(candidate, points)) {
      continue;
    }
    const distance = distanceToPolygon(candidate, points);
    if (distance > bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function polygonCentroid(points: [number, number][]): [number, number] {
  let signedArea = 0;
  let longitude = 0;
  let latitude = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    const cross = current[0] * next[1] - next[0] * current[1];
    signedArea += cross;
    longitude += (current[0] + next[0]) * cross;
    latitude += (current[1] + next[1]) * cross;
  }
  if (Math.abs(signedArea) < 1e-14) {
    return [
      points.reduce((sum, point) => sum + point[0], 0) / points.length,
      points.reduce((sum, point) => sum + point[1], 0) / points.length
    ];
  }
  return [
    longitude / (3 * signedArea),
    latitude / (3 * signedArea)
  ];
}

function pointInPolygon(
  point: [number, number],
  polygon: [number, number][]
): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1;
       index < polygon.length;
       previous = index++) {
    const currentPoint = polygon[index]!;
    const previousPoint = polygon[previous]!;
    if ((currentPoint[1] > point[1]) !== (previousPoint[1] > point[1]) &&
        point[0] <
          (previousPoint[0] - currentPoint[0]) *
          (point[1] - currentPoint[1]) /
          (previousPoint[1] - currentPoint[1]) +
          currentPoint[0]) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToPolygon(
  point: [number, number],
  polygon: [number, number][]
): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index++) {
    minimum = Math.min(
      minimum,
      distanceToSegmentSquared(
        point,
        polygon[index]!,
        polygon[(index + 1) % polygon.length]!
      )
    );
  }
  return minimum;
}

function distanceToSegmentSquared(
  point: [number, number],
  start: [number, number],
  end: [number, number]
): number {
  const deltaLon = end[0] - start[0];
  const deltaLat = end[1] - start[1];
  const lengthSquared = deltaLon ** 2 + deltaLat ** 2;
  if (lengthSquared === 0) {
    return (point[0] - start[0]) ** 2 + (point[1] - start[1]) ** 2;
  }
  const fraction = Math.max(0, Math.min(
    1,
    ((point[0] - start[0]) * deltaLon +
      (point[1] - start[1]) * deltaLat) / lengthSquared
  ));
  const nearestLon = start[0] + fraction * deltaLon;
  const nearestLat = start[1] + fraction * deltaLat;
  return (point[0] - nearestLon) ** 2 + (point[1] - nearestLat) ** 2;
}

function toGeometry(feature: AirportFeature): Geometry {
  const polygonKinds = new Set([
    "apron",
    "terminal",
    "hangar",
    "pavement"
  ]);
  if (feature.points.length === 1) {
    return { type: "Point", coordinates: feature.points[0]! };
  }
  if (polygonKinds.has(feature.kind) && feature.points.length >= 4) {
    return { type: "Polygon", coordinates: [feature.points] };
  }
  return { type: "LineString", coordinates: feature.points };
}

function ownshipFeature(
  longitude: number,
  latitude: number,
  heading: number,
  stale = false,
  visible = true
): Feature<Point> {
  return {
    type: "Feature",
    properties: { heading, stale, visible },
    geometry: { type: "Point", coordinates: [longitude, latitude] }
  };
}

function createOwnshipImage(): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext("2d")!;
  context.translate(48, 48);
  context.shadowColor = "rgba(0, 0, 0, .8)";
  context.shadowBlur = 8;
  context.beginPath();
  context.moveTo(0, -38);
  context.lineTo(9, -10);
  context.lineTo(35, 4);
  context.lineTo(35, 13);
  context.lineTo(9, 8);
  context.lineTo(7, 29);
  context.lineTo(17, 36);
  context.lineTo(17, 40);
  context.lineTo(0, 36);
  context.lineTo(-17, 40);
  context.lineTo(-17, 36);
  context.lineTo(-7, 29);
  context.lineTo(-9, 8);
  context.lineTo(-35, 13);
  context.lineTo(-35, 4);
  context.lineTo(-9, -10);
  context.closePath();
  context.fillStyle = "#4cf0d1";
  context.fill();
  context.lineWidth = 4;
  context.strokeStyle = "#07131e";
  context.stroke();
  return context.getImageData(0, 0, 96, 96);
}

function installDomOwnshipMarker(
  target: MapLibreMap,
  initialPosition: Coordinate
): void {
  domOwnshipMarker?.remove();
  domOwnshipElement = createDomOwnshipElement();
  domOwnshipMarker = new maplibregl.Marker({
    element: domOwnshipElement,
    anchor: "center",
    rotationAlignment: "map",
    pitchAlignment: "map",
    subpixelPositioning: true
  })
    .setLngLat(initialPosition)
    .addTo(target);
  domOwnshipSynchronized = false;
  const diagnostics = document.querySelector<HTMLOutputElement>(
    "#map-diagnostics"
  );
  if (diagnostics) {
    diagnostics.dataset.ownshipRenderer = "dom";
  }
}

function createDomOwnshipElement(): HTMLElement {
  const namespace = "http://www.w3.org/2000/svg";
  const element = document.createElement("div");
  element.className = "ownship-dom-marker";
  element.setAttribute("aria-hidden", "true");
  element.style.visibility = "hidden";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "-22 -22 44 44");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(namespace, "path");
  path.setAttribute("d", aircraftPathData);
  path.setAttribute("class", "fallback-ownship-shape");
  svg.append(path);
  element.append(svg);
  return element;
}

function createTaxiwayBadgeImage(fill: string, stroke: string): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = 44;
  canvas.height = 28;
  const context = canvas.getContext("2d")!;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.beginPath();
  context.roundRect(1, 1, 42, 26, 6);
  context.fillStyle = fill;
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = stroke;
  context.stroke();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function publishMapDiagnostics(target: MapLibreMap): void {
  const element = document.querySelector<HTMLOutputElement>("#map-diagnostics");
  if (!element) {
    return;
  }
  const style = target.getStyle();
  element.dataset.loaded = String(target.loaded());
  element.dataset.styleLoaded = String(target.isStyleLoaded());
  element.dataset.layerCount = String(style.layers.length);
  element.dataset.sourceFeatureCount = String(
    target.querySourceFeatures("airport").length
  );
  element.dataset.renderedFeatureCount = String(
    target.queryRenderedFeatures().length
  );
  for (const layer of [
    "runway-aiming-points",
    "runway-touchdown-zone",
    "runway-leadin-chevrons",
    "runway-pavement-labels",
    "selected-taxiway-highlight"
  ]) {
    element.dataset[layer.replaceAll("-", "_")] = String(
      target.getLayer(layer)
        ? target.queryRenderedFeatures({ layers: [layer] }).length
        : 0
    );
  }
}

interface FallbackProjectedFeature {
  feature: AirportFeature;
  points: maplibregl.Point[];
}

interface FallbackLabelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function syncFallbackOverlay(
  target: MapLibreMap,
  features: AirportFeature[]
): void {
  const nativeReady = target.isStyleLoaded() &&
    target.querySourceFeatures("airport").length > 0;
  if (nativeReady) {
    fallbackOverlayCleanup?.();
    fallbackOverlayCleanup = null;
    fallbackOwnshipSynchronized = false;
    return;
  }
  if (target.loaded() && !document.querySelector("#airport-fallback")) {
    activateFallbackOverlay(target, features);
  }
}

function activateFallbackOverlay(
  target: MapLibreMap,
  features: AirportFeature[]
): void {
  const mapContainer = document.querySelector<HTMLElement>("#map");
  if (!mapContainer || document.querySelector("#airport-fallback")) {
    return;
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "airport-fallback";
  svg.setAttribute("aria-hidden", "true");
  const namespace = "http://www.w3.org/2000/svg";
  const backgroundGroup = document.createElementNS(namespace, "g");
  const taxiPavementGroup = document.createElementNS(namespace, "g");
  const runwayGroup = document.createElementNS(namespace, "g");
  const taxiCenterlineGroup = document.createElementNS(namespace, "g");
  const foregroundGroup = document.createElementNS(namespace, "g");
  svg.append(
    backgroundGroup,
    taxiPavementGroup,
    runwayGroup,
    taxiCenterlineGroup,
    foregroundGroup
  );
  fallbackTaxiRouteCasing = createFallbackPolyline(
    [],
    "fallback-taxi-route-casing"
  );
  fallbackTaxiRouteHighlight = createFallbackPolyline(
    [],
    "fallback-taxi-route-highlight"
  );
  fallbackTaxiRouteCasing.style.display = "none";
  fallbackTaxiRouteHighlight.style.display = "none";
  fallbackTaxiwaySelectionGroup = document.createElementNS(namespace, "g");
  fallbackTaxiwaySelectionGroup.setAttribute(
    "class",
    "fallback-selected-taxiways"
  );
  svg.append(
    fallbackTaxiwaySelectionGroup,
    fallbackTaxiRouteCasing,
    fallbackTaxiRouteHighlight
  );
  fallbackOwnship = createFallbackOwnship();
  fallbackOwnshipSynchronized = false;
  fallbackOwnship.style.display = "none";
  svg.append(fallbackOwnship);
  const labelGroup = document.createElementNS(namespace, "g");
  svg.append(labelGroup);
  mapContainer.append(svg);
  const terminalLabelIds = new Set(
    selectTerminalLabelFeatures(features).map((feature) => feature.id)
  );

  const redraw = () => {
    lastRenderedOwnship = null;
    backgroundGroup.replaceChildren();
    taxiPavementGroup.replaceChildren();
    runwayGroup.replaceChildren();
    taxiCenterlineGroup.replaceChildren();
    foregroundGroup.replaceChildren();
    labelGroup.replaceChildren();
    fallbackTaxiwaySelectionGroup?.replaceChildren();
    const zoom = target.getZoom();
    const projectedFeatures: FallbackProjectedFeature[] = features.map(
      (feature) => ({
        feature,
        points: feature.points.map((coordinate) => target.project(coordinate))
      })
    );

    // Paint by semantic layer, not feature order. This mirrors SkyCharts:
    // taxi pavement below runways, continuous centerlines above runways, and
    // every marker in a final overlay where geometry cannot cover it.
    for (const { feature, points } of projectedFeatures) {
      if (points.length === 0) {
        continue;
      }
      if (feature.kind === "taxiway" || feature.kind === "taxilane") {
        const [pavement, centerline] =
          createFallbackTaxiwayLayers(points, zoom);
        taxiPavementGroup.append(pavement);
        taxiCenterlineGroup.append(centerline);
      } else if (feature.kind === "runway" && points.length >= 2) {
        runwayGroup.append(createFallbackRunway(feature, points));
      } else if (
        ["apron", "terminal", "hangar", "pavement"].includes(feature.kind)
      ) {
        backgroundGroup.append(createFallbackGeometry(feature, points, zoom));
      } else if (feature.kind === "holding_position") {
        continue;
      } else if (
        (feature.kind === "gate" || feature.kind === "parking_position") &&
        points.length === 1
      ) {
        continue;
      } else {
        foregroundGroup.append(createFallbackGeometry(feature, points, zoom));
      }
    }

    const occupied: FallbackLabelBox[] = [];
    for (const { feature, points } of projectedFeatures) {
      if (feature.kind !== "runway" || points.length < 2) {
        continue;
      }
      for (const label of createFallbackRunwayLabels(feature, points)) {
        labelGroup.append(label);
        occupyFallbackLabel(
          occupied,
          label.dataset.label ?? "",
          Number(label.dataset.x),
          Number(label.dataset.y)
        );
      }
    }

    const renderedTerminalLabels = new Set<string>();
    for (const { feature } of projectedFeatures) {
      const terminalName = feature.name?.trim();
      if (
        !terminalName ||
        feature.kind !== "terminal" ||
        !terminalLabelIds.has(feature.id) ||
        renderedTerminalLabels.has(terminalName.toLowerCase())
      ) {
        continue;
      }
      const anchor = target.project(terminalLabelPoint(feature.points));
      const placed = availableFallbackLabelPoint(
        terminalName,
        anchor,
        occupied,
        svg.clientWidth,
        svg.clientHeight,
        2
      );
      if (placed) {
        labelGroup.append(
          createFallbackLabel(terminalName, [placed], feature.kind)
        );
        occupyFallbackLabel(occupied, terminalName, placed.x, placed.y);
      }
      renderedTerminalLabels.add(terminalName.toLowerCase());
    }

    if (zoom >= 13.5) {
      appendFallbackTaxiwayLabels(
        labelGroup,
        projectedFeatures,
        occupied,
        svg.clientWidth,
        svg.clientHeight
      );
    }

    if (zoom >= 15) {
      for (const { feature, points } of projectedFeatures) {
        if (!feature.ref || !shouldShowFallbackLabel(feature, zoom)) {
          continue;
        }
        if (feature.kind === "taxiway" || feature.kind === "taxilane") {
          continue;
        }
        const anchor = points[Math.floor(points.length / 2)]!;
        const placed = availableFallbackLabelPoint(
          feature.ref,
          anchor,
          occupied,
          svg.clientWidth,
          svg.clientHeight,
          2
        );
        if (placed) {
          labelGroup.append(
            createFallbackLabel(feature.ref, [placed], feature.kind)
          );
          occupyFallbackLabel(
            occupied,
            feature.ref,
            placed.x,
            placed.y
          );
        }
      }
    }
    if (fallbackTaxiwaySelectionGroup && selectedTaxiwaySequence.length > 0) {
      const selectedRefs = new Set(
        selectedTaxiwaySequence.map((ref) => ref.trim().toUpperCase())
      );
      for (const { feature, points } of projectedFeatures) {
        if (
          (feature.kind === "taxiway" || feature.kind === "taxilane") &&
          feature.ref &&
          selectedRefs.has(feature.ref.trim().toUpperCase())
        ) {
          const highlight = createFallbackPolyline(
            points,
            "fallback-selected-taxiway"
          );
          highlight.setAttribute(
            "stroke-width",
            String(Math.max(4, Math.min(10, 4 + (zoom - 11) * 1.1)))
          );
          fallbackTaxiwaySelectionGroup.append(highlight);
        }
      }
    }
    updateFallbackTaxiRoute(target);
  };
  target.on("move", redraw);
  target.on("resize", redraw);
  fallbackOverlayRedraw = redraw;
  fallbackOverlayCleanup = () => {
    target.off("move", redraw);
    target.off("resize", redraw);
    svg.remove();
    fallbackOverlayRedraw = null;
    fallbackOwnship = null;
    fallbackOwnshipSynchronized = false;
    fallbackTaxiRouteCasing = null;
    fallbackTaxiRouteHighlight = null;
    fallbackTaxiwaySelectionGroup = null;
  };
  redraw();
}

function createFallbackTaxiwayLayers(
  points: maplibregl.Point[],
  zoom: number
): [SVGPolylineElement, SVGPolylineElement] {
  const pavement = createFallbackPolyline(
    points,
    "fallback-taxiway-pavement"
  );
  pavement.setAttribute(
    "stroke-width",
    String(Math.max(3.6, (zoom - 9) * 2.16))
  );
  const centerline = createFallbackPolyline(
    points,
    "fallback-taxiway-centerline"
  );
  return [pavement, centerline];
}

function createFallbackGeometry(
  feature: AirportFeature,
  points: maplibregl.Point[],
  zoom: number
): SVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  if (feature.kind === "runway" && points.length >= 2) {
    return createFallbackRunway(feature, points);
  }
  if (
    ["apron", "terminal", "hangar", "pavement"].includes(feature.kind) &&
    points.length >= 3
  ) {
    const polygon = document.createElementNS(namespace, "polygon");
    polygon.setAttribute(
      "points",
      points.map((point) => `${point.x},${point.y}`).join(" ")
    );
    polygon.setAttribute("class", `fallback-${feature.kind}`);
    return polygon;
  }
  if (points.length === 1) {
    const circle = document.createElementNS(namespace, "circle");
    circle.setAttribute("cx", String(points[0]!.x));
    circle.setAttribute("cy", String(points[0]!.y));
    circle.setAttribute("r", zoom >= 15 ? "3" : "1.5");
    circle.setAttribute("class", `fallback-${feature.kind}`);
    return circle;
  }
  const line = document.createElementNS(namespace, "polyline");
  line.setAttribute(
    "points",
    points.map((point) => `${point.x},${point.y}`).join(" ")
  );
  line.setAttribute("class", `fallback-${feature.kind}`);
  line.setAttribute("stroke-width", String(Math.max(2, (zoom - 10) * 1.7)));
  return line;
}

function createFallbackRunway(
  feature: AirportFeature,
  points: maplibregl.Point[]
): SVGGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const group = document.createElementNS(namespace, "g");
  const start = points[0]!;
  const end = points.at(-1)!;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.01) {
    return group;
  }
  const along = { x: dx / length, y: dy / length };
  const across = { x: -along.y, y: along.x };
  const midpointLatitude = (feature.points[0]![1] + feature.points.at(-1)![1]) / 2;
  const meters = Math.hypot(
    (feature.points.at(-1)![0] - feature.points[0]![0]) *
      111_320 * Math.cos(midpointLatitude * Math.PI / 180),
    (feature.points.at(-1)![1] - feature.points[0]![1]) * 110_540
  );
  const runwayWidthMeters = feature.widthMeters && feature.widthMeters > 0
    ? feature.widthMeters
    : 45;
  const width = Math.max(
    7,
    length * runwayWidthMeters / meters
  );
  const pixelsPerMeter = length / meters;

  const outline = createFallbackPolyline(points, "fallback-runway-outline");
  outline.setAttribute("stroke-width", String(width + 4));
  const pavement = createFallbackPolyline(points, "fallback-runway-pavement");
  pavement.setAttribute("stroke-width", String(width));
  const centerline = createFallbackPolyline(
    [screenPoint(start, along, length * 0.08), screenPoint(start, along, length * 0.92)],
    "fallback-runway-centerline"
  );
  group.append(outline, pavement, centerline);

  for (const endIndex of [0, 1] as const) {
    const origin = endIndex === 0 ? start : end;
    const direction = endIndex === 0 ? 1 : -1;
    const leadInMeters = Math.max(
      36,
      Math.min(75, runwayWidthMeters * 1.35)
    );
    const leadInLength = leadInMeters * pixelsPerMeter;
    const blastpadEnd = screenPoint(
      origin,
      along,
      -direction * leadInLength
    );
    const blastpad = createFallbackPolyline(
      [blastpadEnd, origin],
      "fallback-runway-pavement"
    );
    blastpad.setAttribute("stroke-width", String(width));
    group.insertBefore(blastpad, group.firstChild);
    const chevronDepth = Math.min(
      leadInMeters * 0.22,
      runwayWidthMeters * 0.38
    ) * pixelsPerMeter;
    for (let chevron = 0; chevron < 3; chevron++) {
      const centerDistance = leadInLength * (chevron + 0.52) / 3;
      const base = screenPoint(
        origin,
        along,
        -direction * (centerDistance + chevronDepth / 2)
      );
      const apex = screenPoint(
        origin,
        along,
        -direction * (centerDistance - chevronDepth / 2)
      );
      group.append(createFallbackPolyline([
        screenPoint(base, across, -width * 0.36),
        apex,
        screenPoint(base, across, width * 0.36)
      ], "fallback-runway-leadin-chevron"));
    }
    group.append(createFallbackPolyline([
      screenPoint(origin, across, -width * 0.48),
      screenPoint(origin, across, width * 0.48)
    ], "fallback-runway-threshold"));
    const thresholdInsetMeters = Math.min(
      8,
      Math.max(3, runwayWidthMeters * 0.1)
    );
    const thresholdCenter = screenPoint(
      origin,
      along,
      direction * thresholdInsetMeters * pixelsPerMeter
    );
    const threshold = createFallbackPolyline([
      screenPoint(thresholdCenter, across, -width * 0.42),
      screenPoint(thresholdCenter, across, width * 0.42)
    ], "fallback-runway-threshold");
    group.append(threshold);

    const aimingDistance = Math.min(length * 0.28, 300 * pixelsPerMeter);
    const aimingLength = Math.min(45, meters * 0.035) * pixelsPerMeter;
    const aimingWidth = Math.max(
      1.5,
      Math.min(7, Math.max(4.5, runwayWidthMeters * 0.1)) * pixelsPerMeter
    );
    const aimingWidthMeters = Math.max(
      4.5,
      Math.min(7, runwayWidthMeters * 0.1)
    );
    const aimingAcross = Math.min(
      runwayWidthMeters * 0.32 + aimingWidthMeters / 2,
      runwayWidthMeters / 2 - Math.max(1.5, runwayWidthMeters * 0.06) -
        aimingWidthMeters / 2
    ) * pixelsPerMeter;
    if (aimingDistance > width * 3 && aimingDistance < length / 2) {
      for (const side of [-1, 1]) {
        const center = screenPoint(
          origin,
          along,
          direction * aimingDistance
        );
        group.append(createFallbackMarkingRectangle(
          center,
          along,
          across,
          aimingLength,
          aimingWidth,
          side * aimingAcross,
          "fallback-runway-aiming"
        ));
      }
    }

    for (const [touchdownMeters, barCount] of [
      [150, 3],
      [450, 2],
      [600, 1]
    ] as const) {
      const touchdownDistance = length * touchdownMeters / meters;
      if (touchdownDistance + 24 * pixelsPerMeter >= length / 2) {
        continue;
      }
      const barLength = 22.5 * pixelsPerMeter;
      const barWidth = Math.max(0.8, 1.8 * pixelsPerMeter);
      for (const side of [-1, 1]) {
        const center = screenPoint(
          origin,
          along,
          direction * touchdownDistance
        );
        const groupWidth = barCount * barWidth +
          (barCount - 1) * 1.5 * pixelsPerMeter;
        const physicalGroupWidth = barCount * 1.8 + (barCount - 1) * 1.5;
        const touchdownAcross = Math.min(
          runwayWidthMeters * 0.32 + physicalGroupWidth / 2,
          runwayWidthMeters / 2 - Math.max(1.5, runwayWidthMeters * 0.06) -
            physicalGroupWidth / 2
        ) * pixelsPerMeter;
        for (let bar = 0; bar < barCount; bar++) {
          const offset = -groupWidth / 2 + barWidth / 2 +
            bar * (barWidth + 1.5 * pixelsPerMeter);
          group.append(createFallbackMarkingRectangle(
            center,
            along,
            across,
            barLength,
            barWidth,
            side * touchdownAcross + offset,
            "fallback-runway-touchdown"
          ));
        }
      }
    }
  }
  return group;
}

function createFallbackRunwayLabels(
  feature: AirportFeature,
  points: maplibregl.Point[]
): SVGGElement[] {
  const start = points[0]!;
  const end = points.at(-1)!;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.01) {
    return [];
  }
  const along = { x: dx / length, y: dy / length };
  const across = { x: -along.y, y: along.x };
  const references = runwayEndDesignators(
    feature.ref,
    feature.points[0]!,
    feature.points.at(-1)!
  );
  const labels: SVGGElement[] = [];
  const runwayWidth = widthInScreenPixels(feature, points);
  const midpointLatitude = (
    feature.points[0]![1] + feature.points.at(-1)![1]
  ) / 2;
  const runwayMeters = Math.hypot(
    (feature.points.at(-1)![0] - feature.points[0]![0]) *
      111_320 * Math.cos(midpointLatitude * Math.PI / 180),
    (feature.points.at(-1)![1] - feature.points[0]![1]) * 110_540
  );
  const pixelsPerMeter = length / Math.max(1, runwayMeters);
  const leadInMeters = Math.max(
    36,
    Math.min(75, (feature.widthMeters ?? 45) * 1.35)
  );
  const labelRotation = normalizeReadableRotation(
    Math.atan2(across.y, across.x) * 180 / Math.PI
  );
  for (const endIndex of [0, 1] as const) {
    const text = references[endIndex] ?? references[0] ?? "";
    if (!text) {
      continue;
    }
    const origin = endIndex === 0 ? start : end;
    const direction = endIndex === 0 ? 1 : -1;
    labels.push(createFallbackRunwayPavementLabel(
      text,
      screenPoint(
        origin,
        along,
        direction * (
          Math.max(30, (feature.widthMeters ?? 45) * 0.72)
        ) * pixelsPerMeter
      ),
      labelRotation,
      Math.max(11, Math.min(29, runwayWidth * 0.58))
    ));
  }
  return labels;
}

function widthInScreenPixels(
  feature: AirportFeature,
  points: maplibregl.Point[]
): number {
  const start = feature.points[0]!;
  const end = feature.points.at(-1)!;
  const latitude = (start[1] + end[1]) / 2;
  const meters = Math.hypot(
    (end[0] - start[0]) * 111_320 * Math.cos(latitude * Math.PI / 180),
    (end[1] - start[1]) * 110_540
  );
  const screenLength = Math.hypot(
    points.at(-1)!.x - points[0]!.x,
    points.at(-1)!.y - points[0]!.y
  );
  return Math.max(
    7,
    screenLength * (feature.widthMeters && feature.widthMeters > 0
      ? feature.widthMeters
      : 45) / Math.max(meters, 1)
  );
}

function createFallbackRunwayPavementLabel(
  designator: string,
  point: maplibregl.Point,
  rotation: number,
  fontSize: number
): SVGGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const group = document.createElementNS(namespace, "g");
  group.setAttribute("class", "fallback-runway-pavement-label");
  group.setAttribute(
    "transform",
    `translate(${point.x} ${point.y}) rotate(${rotation})`
  );
  group.dataset.label = designator;
  group.dataset.x = String(point.x);
  group.dataset.y = String(point.y);
  const text = document.createElementNS(namespace, "text");
  text.setAttribute("x", "0");
  text.setAttribute("y", "0");
  text.setAttribute("style", `font-size:${fontSize}px`);
  text.textContent = designator;
  group.append(text);
  return group;
}

function createFallbackMarkingRectangle(
  center: maplibregl.Point,
  along: { x: number; y: number },
  across: { x: number; y: number },
  length: number,
  width: number,
  acrossOffset: number,
  className: string
): SVGPolygonElement {
  const shifted = screenPoint(center, across, acrossOffset);
  const halfLength = length / 2;
  const halfWidth = width / 2;
  const points = [
    screenPoint(screenPoint(shifted, along, -halfLength), across, -halfWidth),
    screenPoint(screenPoint(shifted, along, halfLength), across, -halfWidth),
    screenPoint(screenPoint(shifted, along, halfLength), across, halfWidth),
    screenPoint(screenPoint(shifted, along, -halfLength), across, halfWidth)
  ];
  const polygon = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "polygon"
  );
  polygon.setAttribute(
    "points",
    points.map((point) => `${point.x},${point.y}`).join(" ")
  );
  polygon.setAttribute("class", className);
  return polygon;
}

function normalizeReadableRotation(value: number): number {
  let normalized = (value % 360 + 360) % 360;
  if (normalized > 90 && normalized <= 270) {
    normalized -= 180;
  }
  return normalized;
}

function createFallbackPolyline(
  points: Array<{ x: number; y: number }>,
  className: string
): SVGPolylineElement {
  const line = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "polyline"
  );
  line.setAttribute(
    "points",
    points.map((point) => `${point.x},${point.y}`).join(" ")
  );
  line.setAttribute("class", className);
  return line;
}

function screenPoint(
  origin: { x: number; y: number },
  vector: { x: number; y: number },
  distance: number
): maplibregl.Point {
  return new maplibregl.Point(
    origin.x + vector.x * distance,
    origin.y + vector.y * distance
  );
}

function createFallbackLabel(
  text: string,
  points: maplibregl.Point[],
  kind: AirportFeature["kind"]
): SVGTextElement {
  const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
  const middle = points[Math.floor(points.length / 2)]!;
  label.setAttribute("x", String(middle.x));
  label.setAttribute("y", String(middle.y));
  label.setAttribute("class", `fallback-label fallback-label-${kind}`);
  label.textContent = text;
  return label;
}

function createFallbackTaxiwayBadge(
  text: string,
  point: maplibregl.Point
): SVGGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const group = document.createElementNS(namespace, "g");
  group.setAttribute("class", "fallback-taxiway-badge");
  const box = fallbackLabelBox(text, point.x, point.y);
  const background = document.createElementNS(namespace, "rect");
  background.setAttribute("x", String(box.left));
  background.setAttribute("y", String(box.top));
  background.setAttribute("width", String(box.right - box.left));
  background.setAttribute("height", String(box.bottom - box.top));
  background.setAttribute("rx", "2");
  const label = createFallbackLabel(text, [point], "taxiway");
  group.append(background, label);
  return group;
}

function appendFallbackTaxiwayLabels(
  group: SVGGElement,
  features: FallbackProjectedFeature[],
  occupied: FallbackLabelBox[],
  viewportWidth: number,
  viewportHeight: number
): void {
  const references = new Map<
    string,
    { candidates: maplibregl.Point[]; screenLength: number }
  >();
  for (const { feature, points } of features) {
    if (feature.kind !== "taxiway" && feature.kind !== "taxilane") {
      continue;
    }
    const reference = feature.ref?.trim().toUpperCase() ?? "";
    if (!reference || reference.length > 7 || points.length < 2) {
      continue;
    }
    const screenLength = fallbackPolylineLength(points);
    const record = references.get(reference) ?? {
      candidates: [],
      screenLength: 0
    };
    record.candidates.push(...fallbackTaxiwayCandidates(points, 145));
    record.screenLength += screenLength;
    references.set(reference, record);
  }

  let labelsDrawn = 0;
  const ordered = [...references].sort(
    ([leftRef, left], [rightRef, right]) =>
      right.screenLength - left.screenLength ||
      leftRef.localeCompare(rightRef)
  );
  for (const [reference, record] of ordered) {
    if (labelsDrawn >= 60) {
      break;
    }
    const referenceLimit = Math.min(
      4,
      Math.max(1, Math.ceil(record.screenLength / 360))
    );
    const accepted: maplibregl.Point[] = [];
    for (const candidate of record.candidates) {
      if (labelsDrawn >= 60 || accepted.length >= referenceLimit) {
        break;
      }
      if (accepted.some((prior) =>
        Math.hypot(candidate.x - prior.x, candidate.y - prior.y) < 110)) {
        continue;
      }
      const placed = availableFallbackLabelPoint(
        reference,
        candidate,
        occupied,
        viewportWidth,
        viewportHeight,
        accepted.length === 0 ? 1 : 4
      );
      if (!placed) {
        continue;
      }
      group.append(createFallbackTaxiwayBadge(reference, placed));
      occupyFallbackLabel(occupied, reference, placed.x, placed.y);
      accepted.push(candidate);
      labelsDrawn++;
    }
  }
}

function fallbackTaxiwayCandidates(
  points: maplibregl.Point[],
  spacing: number
): maplibregl.Point[] {
  const cumulative = [0];
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    cumulative.push(
      cumulative[index - 1]! +
      Math.hypot(current.x - previous.x, current.y - previous.y)
    );
  }
  const length = cumulative.at(-1) ?? 0;
  if (length < 8) {
    return [];
  }
  const count = Math.min(
    12,
    Math.max(1, Math.ceil(length / Math.max(55, spacing)))
  );
  const candidates: maplibregl.Point[] = [];
  let segment = 1;
  for (let marker = 0; marker < count; marker++) {
    const target = length * (marker + 0.5) / count;
    while (segment < cumulative.length && cumulative[segment]! < target) {
      segment++;
    }
    if (segment >= points.length) {
      break;
    }
    const priorDistance = cumulative[segment - 1]!;
    const nextDistance = cumulative[segment]!;
    const fraction = nextDistance > priorDistance
      ? (target - priorDistance) / (nextDistance - priorDistance)
      : 0;
    const previous = points[segment - 1]!;
    const current = points[segment]!;
    candidates.push(new maplibregl.Point(
      previous.x + (current.x - previous.x) * fraction,
      previous.y + (current.y - previous.y) * fraction
    ));
  }
  return candidates;
}

function fallbackPolylineLength(points: maplibregl.Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    length += Math.hypot(
      points[index]!.x - points[index - 1]!.x,
      points[index]!.y - points[index - 1]!.y
    );
  }
  return length;
}

function availableFallbackLabelPoint(
  text: string,
  anchor: maplibregl.Point,
  occupied: FallbackLabelBox[],
  viewportWidth: number,
  viewportHeight: number,
  margin: number
): maplibregl.Point | null {
  const offsets = [
    [0, 0], [0, -14], [0, 14], [-18, 0], [18, 0],
    [-14, -13], [14, -13], [-14, 13], [14, 13]
  ];
  for (const [offsetX, offsetY] of offsets) {
    const candidate = new maplibregl.Point(
      anchor.x + offsetX!,
      anchor.y + offsetY!
    );
    const box = fallbackLabelBox(text, candidate.x, candidate.y);
    if (
      box.left < 2 ||
      box.top < 2 ||
      box.right > viewportWidth - 2 ||
      box.bottom > viewportHeight - 2
    ) {
      continue;
    }
    const expanded = {
      left: box.left - margin,
      top: box.top - margin,
      right: box.right + margin,
      bottom: box.bottom + margin
    };
    if (!occupied.some((prior) => fallbackBoxesOverlap(expanded, prior))) {
      return candidate;
    }
  }
  return null;
}

function occupyFallbackLabel(
  occupied: FallbackLabelBox[],
  text: string,
  x: number,
  y: number
): void {
  occupied.push(fallbackLabelBox(text, x, y));
}

function fallbackLabelBox(
  text: string,
  x: number,
  y: number
): FallbackLabelBox {
  const width = Math.max(14, text.length * 7 + 7);
  const height = 16;
  return {
    left: x - width / 2,
    top: y - height / 2,
    right: x + width / 2,
    bottom: y + height / 2
  };
}

function fallbackBoxesOverlap(
  left: FallbackLabelBox,
  right: FallbackLabelBox
): boolean {
  return left.left < right.right &&
    left.right > right.left &&
    left.top < right.bottom &&
    left.bottom > right.top;
}

function shouldShowFallbackLabel(
  feature: AirportFeature,
  zoom: number
): boolean {
  if (feature.kind === "runway") {
    return false;
  }
  if (feature.kind === "taxiway" || feature.kind === "taxilane") {
    return zoom >= 13.5;
  }
  if (feature.kind === "terminal" || feature.kind === "hangar") {
    return false;
  }
  return zoom >= 15;
}

function createFallbackOwnship(): SVGGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const group = document.createElementNS(namespace, "g");
  group.id = "fallback-ownship";
  const path = document.createElementNS(namespace, "path");
  path.setAttribute("d", aircraftPathData);
  path.setAttribute("class", "fallback-ownship-shape");
  group.append(path);
  return group;
}

function setStatus(message: string, state: "connected" | "waiting" | "error"): void {
  const element = document.querySelector("#status")!;
  element.textContent = message;
  element.className = `status ${state}`;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

async function requestJson<T>(
  url: string,
  init: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init.headers
    }
  });
  if (!response.ok) {
    const detail = await response.text();
    let message = detail;
    try {
      const problem = JSON.parse(detail) as { error?: string };
      message = problem.error || detail;
    } catch {
      // Plain-text errors are already suitable for display.
    }
    throw new Error(
      message || `${response.status} ${response.statusText}`
    );
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

initializeLocalization();
setupFlightDeck({
  ensureAirports: ensureFlightPlanAirports,
  openAirport: openFlightPlanAirport
});
void start().catch((error: unknown) => {
  console.error(error);
  setStatus(t("error.mapLoad"), "error");
});
