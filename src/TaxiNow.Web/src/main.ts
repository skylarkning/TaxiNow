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
import type {
  AppStatus,
  AirportFeature,
  AirportMap,
  DownloadJob,
  StorageSummary,
  StoredMapAsset,
  TelemetrySnapshot
} from "./contracts";
import {
  interpolateOwnship,
  isPointInsideBounds,
  type GeographicBounds,
  type InterpolatedOwnship
} from "./interpolation";
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
  listGateDestinations,
  listRunwayDestinations,
  nearestStandLabel,
  planTaxiRoutes,
  updateTaxiRouteProgress,
  type Coordinate,
  type TaxiDestination,
  type TaxiGraph,
  type TaxiRoute
} from "./taxiRouting";

const telemetrySamples: TelemetrySnapshot[] = [];
let lastOwnshipFrameAt = 0;
let lastRenderedOwnship: InterpolatedOwnship | null = null;
let ownshipVisible = false;
let map: MapLibreMap;
let airportBounds: LngLatBoundsLike;
let airportPerimeter: GeographicBounds | null = null;
let ownshipAnimationStarted = false;
let fallbackOwnship: SVGGElement | null = null;
let fallbackTaxiRouteCasing: SVGPolylineElement | null = null;
let fallbackTaxiRouteHighlight: SVGPolylineElement | null = null;
let renderedTaxiRouteCoordinates: Coordinate[] = [];
let assetRefreshTimer: number | null = null;
let assetPanelOpen = false;
let installedAssets: StoredMapAsset[] = [];
let selectedAirportIcao = "";
let pendingAirportIcao: string | null = null;
let mapInitialized = false;
let assetRefreshInFlight = false;
let activeDownloads = false;
let currentAirportMap: AirportMap | null = null;
let taxiGraph: TaxiGraph | null = null;
let taxiRunways: TaxiDestination[] = [];
let taxiGates: TaxiDestination[] = [];
let taxiRouteOptions: TaxiRoute[] = [];
let selectedTaxiRoute: TaxiRoute | null = null;
let activeTaxiRoute: TaxiRoute | null = null;
let activeTaxiSegmentIndex = 0;
let lastTaxiCameraAt = 0;
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

async function start(): Promise<void> {
  setupLanguageSelector();
  setupTaxiPlanner();
  setupAssetManager();
  setupAirportPicker();
  setupAboutDialog();
  setupWelcomeDialog();
  const appStatus = await getJson<AppStatus>("/api/v1/status");
  applyProductMetadata(appStatus);
  const serverLink =
    document.querySelector<HTMLAnchorElement>("#server-url")!;
  serverLink.href = appStatus.localUrl;
  serverLink.textContent = t("access.at", {
    address: appStatus.localUrl.replace(/^https?:\/\//, "")
  });
  serverLink.title = t("access.title", {
    addresses: appStatus.localUrls.join(", ")
  });
  await refreshAssetManager();
  const initialIcao =
    installedAssets.some((asset) => asset.icao === appStatus.selectedAirport)
      ? appStatus.selectedAirport
      : installedAssets[0]?.icao;
  if (!initialIcao) {
    throw new Error(t("error.noMaps"));
  }
  await loadAirport(initialIcao);
  await connectTelemetry();
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

  const setOpen = (open: boolean): void => {
    panel.classList.toggle("open", open);
    panel.setAttribute("aria-hidden", String(!open));
    backdrop.hidden = !open;
    if (open) {
      populateTaxiDestinations();
      document.querySelector<HTMLElement>("#taxi-runway")?.focus();
    }
  };
  const syncKind = (): void => {
    const runway = kind.value === "runway";
    document.querySelector<HTMLElement>("#taxi-runway-field")!.hidden = !runway;
    document.querySelector<HTMLElement>("#taxi-gate-field")!.hidden = runway;
  };

  openButton.addEventListener("click", () => setOpen(true));
  closeButton.addEventListener("click", () => setOpen(false));
  backdrop.addEventListener("click", () => setOpen(false));
  kind.addEventListener("change", syncKind);
  document.querySelector("#find-taxi-routes")!.addEventListener("click", () => {
    findTaxiRoutes();
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
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel.classList.contains("open")) {
      setOpen(false);
    }
  });
  syncKind();
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

function findTaxiRoutes(): void {
  const feedback = document.querySelector<HTMLElement>("#taxi-plan-feedback")!;
  const position = currentAircraftCoordinate();
  if (!position || !currentAirportMap || !taxiGraph) {
    feedback.textContent = t("taxi.needPosition");
    feedback.className = "feedback error";
    return;
  }
  const kind = document.querySelector<HTMLSelectElement>(
    "#taxi-destination-kind"
  )!.value;
  let destination: TaxiDestination | undefined;
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
  if (!destination) {
    feedback.textContent = t("taxi.noNetwork");
    feedback.className = "feedback error";
    return;
  }

  taxiRouteOptions = planTaxiRoutes(
    taxiGraph,
    position,
    destination,
    nearestStandLabel(currentAirportMap.features, position),
    5
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
    title.textContent = t("taxi.option", { number: index + 1 });
    heading.append(title);
    if (index === 0) {
      const badge = document.createElement("small");
      badge.textContent = t("taxi.recommended");
      heading.append(badge);
    }
    const summary = document.createElement("span");
    summary.className = "taxi-route-summary";
    summary.textContent = route.summary;
    const details = document.createElement("small");
    details.textContent = t(
      route.turnCount === 1 ? "taxi.distanceOneTurn" : "taxi.distance",
      {
      distance: formatTaxiDistance(route.distanceMeters),
      minutes: Math.max(1, Math.round(route.distanceMeters / 7.7 / 60)),
      turns: route.turnCount
      }
    );
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

function applyProductMetadata(status: AppStatus): void {
  document.title = `TaxiNow ${status.displayVersion}`;
  document.querySelector("#footer-version")!.textContent =
    status.displayVersion;
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

async function loadAirport(icao: string): Promise<void> {
  clearTaxiRoute();
  const downloadedAirport = await getJson<AirportMap>(
    `/api/v1/airports/${encodeURIComponent(icao)}/map`
  );
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
    map.remove();
    document.querySelector("#airport-fallback")?.remove();
    fallbackOwnship = null;
    fallbackTaxiRouteCasing = null;
    fallbackTaxiRouteHighlight = null;
  }
  map = createMap(airport);
  mapInitialized = true;
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

  const setOpen = (open: boolean): void => {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      search.focus();
      search.select();
      renderAirportPicker(search.value);
    }
  };

  toggle.addEventListener("click", () => setOpen(panel.hidden));
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
      setOpen(false);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      setOpen(false);
    }
  });
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

async function refreshAssetManager(): Promise<void> {
  if (assetRefreshInFlight) {
    return;
  }
  assetRefreshInFlight = true;
  try {
    const [storage, jobs] = await Promise.all([
      getJson<StorageSummary>("/api/v1/storage"),
      getJson<DownloadJob[]>("/api/v1/downloads")
    ]);
    installedAssets = storage.assets;
    renderStorage(storage);
    renderDownloadJobs(jobs);
    renderAirportPicker(
      document.querySelector<HTMLInputElement>("#airport-search")!.value
    );

    if (pendingAirportIcao &&
        installedAssets.some((asset) => asset.icao === pendingAirportIcao) &&
        jobs.some((job) =>
          job.currentIcao === pendingAirportIcao &&
          job.state === "completed"
        )) {
      const downloadedIcao = pendingAirportIcao;
      pendingAirportIcao = null;
      await loadAirport(downloadedIcao);
      const feedback =
        document.querySelector<HTMLElement>("#airport-picker-feedback")!;
      feedback.textContent = t("airport.installed", {
        icao: downloadedIcao
      });
      feedback.className = "feedback success";
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
  } finally {
    assetRefreshInFlight = false;
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
  metadata.textContent = t("storage.groupMeta", {
    count: assets.length,
    size: formatBytes(
      assets.reduce((sum, asset) => sum + asset.sizeBytes, 0)
    )
  });
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
    return getLocale() === "zh-Hans"
      ? `${hours}小时 ${minutes}分`
      : `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return getLocale() === "zh-Hans"
      ? `${minutes}分 ${remainder}秒`
      : `${minutes}m ${remainder}s`;
  }
  return getLocale() === "zh-Hans" ? `${seconds}秒` : `${seconds}s`;
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
    return getLocale() === "zh-Hans"
      ? `${hours}小时 ${minutes}分`
      : `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return getLocale() === "zh-Hans"
      ? `${minutes}分 ${seconds}秒`
      : `${minutes}m ${seconds}s`;
  }
  return getLocale() === "zh-Hans"
    ? `${Math.max(1, seconds)}秒`
    : `${Math.max(1, seconds)}s`;
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

  created.addControl(new maplibregl.NavigationControl(), "bottom-right");
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
      created.addSource("runway-labels", {
        type: "geojson",
        data: runwayDecorations.labels
      });
      created.addSource("terminal-labels", {
        type: "geojson",
        data: terminalLabelCollection(airport.features)
      });
      created.addSource("taxi-route", {
        type: "geojson",
        data: taxiRouteCollection([])
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
      addTaxiRouteLayers(created);
      created.addImage("ownship-plane", createOwnshipImage(), { pixelRatio: 2 });
      addOwnshipLayer(created);
      created.moveLayer("taxiway-labels");
      created.moveLayer("building-labels");
      fitAirport();
      created.once("idle", () => {
        publishMapDiagnostics(created);
        startOwnshipAnimation();
      });
      window.setTimeout(() => {
        publishMapDiagnostics(created);
        if (created.querySourceFeatures("airport").length === 0) {
          activateFallbackOverlay(created, airport.features);
        }
        startOwnshipAnimation();
      }, 1000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (diagnostics) {
        diagnostics.dataset.error = message;
      }
      console.error(error);
    }
  });
  return created;
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
    id: "runway-outline",
    type: "line",
    source: "airport",
    filter: ["==", ["get", "kind"], "runway"],
    paint: {
      "line-color": "#dce3e8",
      "line-width": [
        "interpolate", ["exponential", 1.55], ["zoom"],
        10, ["+", 2, ["*", ["get", "widthMeters"], 0.045]],
        16, ["+", 6, ["*", ["get", "widthMeters"], 0.52]]
      ]
    },
    layout: { "line-cap": "butt" }
  });
  target.addLayer({
    id: "runways",
    type: "line",
    source: "airport",
    filter: ["==", ["get", "kind"], "runway"],
    paint: {
      "line-color": "#15191f",
      "line-width": [
        "interpolate", ["exponential", 1.55], ["zoom"],
        10, ["max", 2, ["*", ["get", "widthMeters"], 0.04]],
        16, ["max", 18, ["*", ["get", "widthMeters"], 0.46]]
      ]
    },
    layout: { "line-cap": "butt" }
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
    type: "line",
    source: "runway-markings",
    filter: ["==", ["get", "kind"], "aiming"],
    minzoom: 12.5,
    paint: {
      "line-color": "#f5f7f8",
      "line-width": ["interpolate", ["linear"], ["zoom"], 12.5, 2, 17, 6]
    },
    layout: { "line-cap": "butt" }
  });
  target.addLayer({
    id: "taxiway-outline",
    type: "line",
    source: "airport",
    filter: ["in", ["get", "kind"], ["literal", ["taxiway", "taxilane"]]],
    paint: {
      "line-color": "#252a2e",
      "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 10, 2, 17, 20]
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
      "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 10, 1, 17, 15]
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
    id: "runway-labels",
    type: "symbol",
    source: "runway-labels",
    layout: {
      "text-field": ["get", "text"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 10, 10, 16, 16],
      "text-font": ["Segoe UI", "Arial Unicode MS Regular"],
      "text-rotate": ["get", "rotation"],
      "text-rotation-alignment": "map",
      "text-keep-upright": true,
      "text-allow-overlap": false,
      "text-padding": 4
    },
    paint: {
      "text-color": "#f7f9fb",
      "text-halo-color": "#080c10",
      "text-halo-width": 2.2
    }
  });
  target.addLayer({
    id: "taxiway-labels",
    type: "symbol",
    source: "airport",
    filter: ["in", ["get", "kind"], ["literal", ["taxiway", "taxilane"]]],
    minzoom: 13.5,
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 145,
      "text-field": ["coalesce", ["get", "ref"], ""],
      "text-size": ["interpolate", ["linear"], ["zoom"], 11, 10, 17, 14],
      "text-font": ["Segoe UI", "Arial Unicode MS Regular"],
      "text-rotation-alignment": "map",
      "text-keep-upright": true,
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "text-padding": 4
    },
    paint: {
      "text-color": "#ffd52f",
      "text-halo-color": "#080b0e",
      "text-halo-width": 2.5
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
  if (sample.hasPosition) {
    telemetrySamples.push(sample);
    while (telemetrySamples.length > 2) {
      telemetrySamples.shift();
    }
    setStatus(t("status.synced"), "connected");
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
    if (
      lastRenderedOwnship &&
      Math.abs(lastRenderedOwnship.longitude - renderedOwnship.longitude) < 1e-9 &&
      Math.abs(lastRenderedOwnship.latitude - renderedOwnship.latitude) < 1e-9 &&
      Math.abs(lastRenderedOwnship.heading - renderedOwnship.heading) < 0.05 &&
      lastRenderedOwnship.visible === renderedOwnship.visible &&
      lastRenderedOwnship.stale === renderedOwnship.stale
    ) {
      requestAnimationFrame(renderOwnship);
      return;
    }
    lastRenderedOwnship = renderedOwnship;
    if (map?.isStyleLoaded() && map.getLayer("ownship")) {
      const source = map.getSource("ownship") as GeoJSONSource | undefined;
      source?.setData(
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
        renderedOwnship.visible ? "visible" : "none"
      );
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
      fallbackOwnship.style.display = renderedOwnship.visible ? "" : "none";
      fallbackOwnship.style.opacity = renderedOwnship.stale ? "0.45" : "1";
    }
    ownshipVisible = renderedOwnship.visible;
    if (renderedOwnship.visible && activeTaxiRoute) {
      updateActiveTaxiGuidance(
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
    instruction.textContent = t("taxi.turnLeft", { taxiway: progress.nextRef });
    symbol.textContent = "↰";
  } else if (progress.maneuver === "right" && progress.nextRef) {
    instruction.textContent = t("taxi.turnRight", { taxiway: progress.nextRef });
    symbol.textContent = "↱";
  } else if (progress.nextRef) {
    instruction.textContent = t("taxi.continueOn", {
      taxiway: progress.nextRef
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
  const maneuverDistance = progress.nextRef
    ? `${formatTaxiDistance(progress.distanceToManeuverMeters)} · `
    : "";
  meta.textContent = `${maneuverDistance}${t("taxi.remaining", {
    distance: formatTaxiDistance(progress.remainingMeters)
  })}`;

  if (
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
  svg.append(fallbackTaxiRouteCasing, fallbackTaxiRouteHighlight);
  fallbackOwnship = createFallbackOwnship();
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
          label.textContent ?? "",
          Number(label.getAttribute("x")),
          Number(label.getAttribute("y"))
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
    updateFallbackTaxiRoute(target);
  };
  target.on("move", redraw);
  target.on("resize", redraw);
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
    String(Math.max(3, (zoom - 9) * 1.8))
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
  const width = Math.max(
    7,
    length * (feature.widthMeters && feature.widthMeters > 0
      ? feature.widthMeters
      : 45) / meters
  );

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
    const thresholdCenter = screenPoint(origin, along, direction * length * 0.055);
    const threshold = createFallbackPolyline([
      screenPoint(thresholdCenter, across, -width * 0.42),
      screenPoint(thresholdCenter, across, width * 0.42)
    ], "fallback-runway-threshold");
    group.append(threshold);
  }
  return group;
}

function createFallbackRunwayLabels(
  feature: AirportFeature,
  points: maplibregl.Point[]
): SVGTextElement[] {
  const start = points[0]!;
  const end = points.at(-1)!;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.01) {
    return [];
  }
  const along = { x: dx / length, y: dy / length };
  const references = runwayEndDesignators(
    feature.ref,
    feature.points[0]!,
    feature.points.at(-1)!
  );
  const labels: SVGTextElement[] = [];
  for (const endIndex of [0, 1] as const) {
    const text = references[endIndex] ?? references[0] ?? "";
    if (!text) {
      continue;
    }
    const origin = endIndex === 0 ? start : end;
    const direction = endIndex === 0 ? 1 : -1;
    const point = screenPoint(origin, along, direction * length * 0.09);
    labels.push(createFallbackLabel(text, [point], "runway"));
  }
  return labels;
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
  path.setAttribute(
    "d",
    "M0 -18 L4 -5 L16 2 L16 6 L4 4 L3 14 L8 18 L0 16 L-8 18 L-3 14 L-4 4 L-16 6 L-16 2 L-4 -5 Z"
  );
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
void start().catch((error: unknown) => {
  console.error(error);
  setStatus(t("error.mapLoad"), "error");
});
