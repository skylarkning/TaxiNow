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
import { interpolateOwnship } from "./interpolation";
import { buildRunwayDecorations } from "./runwayGeometry";

const telemetrySamples: TelemetrySnapshot[] = [];
let map: MapLibreMap;
let airportBounds: LngLatBoundsLike;
let ownshipAnimationStarted = false;
let fallbackOwnship: SVGGElement | null = null;
let assetRefreshTimer: number | null = null;

async function start(): Promise<void> {
  setupAssetManager();
  const [airport, appStatus] = await Promise.all([
    getJson<AirportMap>("/api/v1/airports/CYYZ/map"),
    getJson<AppStatus>("/api/v1/status")
  ]);
  const serverLink =
    document.querySelector<HTMLAnchorElement>("#server-url")!;
  serverLink.href = appStatus.localUrl;
  serverLink.textContent =
    `Local server: ${appStatus.localUrl.replace(/^https?:\/\//, "")}`;
  serverLink.title = `Open TaxiNow in a browser at ${appStatus.localUrl}`;

  airportBounds = [
    [airport.airport.bounds.minLon, airport.airport.bounds.minLat],
    [airport.airport.bounds.maxLon, airport.airport.bounds.maxLat]
  ];
  document.querySelector("#airport-name")!.textContent =
    `${airport.airport.icao} — ${airport.airport.name}`;
  document.querySelector("#attribution")!.textContent = airport.sources
    .map((source) =>
      source.name.toLowerCase().includes("openstreetmap")
        ? `© ${source.name}`
        : source.name
    )
    .join(" · ");
  document.querySelector("#map-summary")!.textContent =
    `Offline vector map · ${airport.counts.runways} runways · ` +
    `${airport.counts.taxiways} taxiways · ${airport.counts.stands} stands`;

  map = createMap(airport);
  document
    .querySelector("#fit-airport")!
    .addEventListener("click", () => fitAirport());

  await refreshAssetManager();
  await connectTelemetry();
}

function setupAssetManager(): void {
  const panel = document.querySelector<HTMLElement>("#asset-panel")!;
  const backdrop = document.querySelector<HTMLButtonElement>("#asset-backdrop")!;
  const mode = document.querySelector<HTMLSelectElement>("#download-mode")!;
  const form = document.querySelector<HTMLFormElement>("#download-form")!;

  const open = (): void => {
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    backdrop.hidden = false;
    void refreshAssetManager();
    if (assetRefreshTimer === null) {
      assetRefreshTimer = window.setInterval(
        () => void refreshAssetManager(),
        2000
      );
    }
  };
  const close = (): void => {
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    backdrop.hidden = true;
    if (assetRefreshTimer !== null) {
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
  mode.addEventListener("change", updateDownloadMode);
  updateDownloadMode();
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitDownload(form);
  });
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
  const maximum = Number(
    document.querySelector<HTMLInputElement>("#download-maximum")!.value
  );

  if (!form.reportValidity()) {
    return;
  }
  if (mode === "country" &&
      regionCode &&
      !regionCode.startsWith(`${countryCode}-`)) {
    feedback.textContent =
      `Region must start with ${countryCode}-, for example ${countryCode}-ON.`;
    feedback.className = "feedback error";
    return;
  }

  button.disabled = true;
  feedback.textContent =
    mode === "icao"
      ? `Queuing ${icao}…`
      : `Queuing ${regionCode || countryCode}…`;
  feedback.className = "feedback";
  try {
    await requestJson<DownloadJob>("/api/v1/downloads", {
      method: "POST",
      body: JSON.stringify({
        mode,
        icao: mode === "icao" ? icao : null,
        countryCode: mode === "country" ? countryCode : null,
        regionCode: mode === "country" && regionCode ? regionCode : null,
        maximumCount: mode === "country" ? maximum : null
      })
    });
    feedback.textContent = "Download started. Progress appears below.";
    feedback.className = "feedback success";
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
  try {
    const [storage, jobs] = await Promise.all([
      getJson<StorageSummary>("/api/v1/storage"),
      getJson<DownloadJob[]>("/api/v1/downloads")
    ]);
    renderStorage(storage);
    renderDownloadJobs(jobs);
  } catch (error) {
    const feedback =
      document.querySelector<HTMLElement>("#download-feedback");
    if (feedback) {
      feedback.textContent =
        `Could not refresh assets: ${
          error instanceof Error ? error.message : String(error)
        }`;
      feedback.className = "feedback error";
    }
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
  list.replaceChildren();
  if (storage.assets.length === 0) {
    list.append(createEmptyState("No offline maps installed."));
    return;
  }
  for (const asset of storage.assets) {
    list.append(createAssetRow(asset));
  }
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
  metadata.textContent =
    `${asset.countryCode}${asset.regionCode ? ` · ${asset.regionCode}` : ""}` +
    ` · ${formatBytes(asset.sizeBytes)} · ${asset.sourceMix}`;
  details.append(title, name, metadata);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger-button";
  remove.textContent = "Delete";
  remove.addEventListener("click", async () => {
    if (!window.confirm(`Delete the offline ${asset.icao} map?`)) {
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
  list.replaceChildren();
  if (jobs.length === 0) {
    list.append(createEmptyState("No downloads in this session."));
    return;
  }

  for (const job of jobs) {
    const row = document.createElement("article");
    row.className = `job-row job-${job.state}`;
    const heading = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent =
      job.currentIcao || `${job.airportsCompleted}/${job.airportsTotal} airports`;
    const state = document.createElement("span");
    state.className = "job-state";
    state.textContent = job.state;
    heading.append(title, state);

    const progress = document.createElement("progress");
    progress.max = 100;
    progress.value = Math.max(0, Math.min(100, job.percentage));
    const detail = document.createElement("small");
    detail.textContent = job.error ||
      `${job.phase} · ${Math.round(job.percentage)}%` +
      (job.currentSource ? ` · ${job.currentSource}` : "");
    row.append(heading, progress, detail);

    if (job.state === "queued" || job.state === "running") {
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "text-button";
      cancel.textContent = "Cancel";
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
      created.addSource("ownship", {
        type: "geojson",
        data: ownshipFeature(
          airport.airport.center[0],
          airport.airport.center[1],
          0
        )
      });
      addAirportLayers(created);
      created.addImage("ownship-plane", createOwnshipImage(), { pixelRatio: 2 });
      addOwnshipLayer(created);
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
      "symbol-spacing": 170,
      "text-field": ["coalesce", ["get", "ref"], ""],
      "text-size": ["interpolate", ["linear"], ["zoom"], 11, 10, 17, 14],
      "text-font": ["Segoe UI", "Arial Unicode MS Regular"],
      "text-rotation-alignment": "map",
      "text-keep-upright": true
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
      "text-max-width": 8
    },
    paint: {
      "text-color": "#eef4f8",
      "text-halo-color": "#263442",
      "text-halo-width": 2
    }
  });
  target.addLayer({
    id: "stands",
    type: "circle",
    source: "airport",
    filter: ["in", ["get", "kind"], ["literal", ["gate", "parking_position"]]],
    minzoom: 14.5,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 14.5, 2, 18, 5],
      "circle-color": "#60d3c0",
      "circle-stroke-color": "#0c1720",
      "circle-stroke-width": 1
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
      "icon-rotation-alignment": "map"
    },
    paint: {
      "icon-opacity": ["case", ["get", "stale"], 0.45, 1]
    }
  });
}

async function connectTelemetry(): Promise<void> {
  try {
    const initial = await getJson<TelemetrySnapshot>("/api/v1/telemetry");
    telemetrySamples.push(initial);
  } catch {
    setStatus("Waiting for replay telemetry", "waiting");
  }

  const connection = new HubConnectionBuilder()
    .withUrl("/hubs/telemetry")
    .withAutomaticReconnect()
    .configureLogging(LogLevel.Warning)
    .build();
  connection.on("TelemetryUpdated", (sample: TelemetrySnapshot) => {
    telemetrySamples.push(sample);
    while (telemetrySamples.length > 2) {
      telemetrySamples.shift();
    }
    setStatus(
      sample.simulator === "replay"
        ? "Replay · ground tracking"
        : `${sample.simulator.toUpperCase()} · ${formatState(sample.state)}`,
      sample.onGround ? "connected" : "waiting"
    );
  });
  connection.onreconnecting(() => setStatus("Reconnecting", "waiting"));
  connection.onclose(() => setStatus("Disconnected", "error"));
  await connection.start();
}

function renderOwnship(): void {
  const ownship = interpolateOwnship(telemetrySamples, Date.now());
  if (ownship) {
    if (map?.isStyleLoaded()) {
      const source = map.getSource("ownship") as GeoJSONSource | undefined;
      source?.setData(
        ownshipFeature(
          ownship.longitude,
          ownship.latitude,
          ownship.heading,
          ownship.stale,
          ownship.visible
        )
      );
      map.setLayoutProperty(
        "ownship",
        "visibility",
        ownship.visible ? "visible" : "none"
      );
    }
    if (fallbackOwnship) {
      const point = map.project([ownship.longitude, ownship.latitude]);
      fallbackOwnship.setAttribute(
        "transform",
        `translate(${point.x} ${point.y}) rotate(${ownship.heading})`
      );
      fallbackOwnship.style.display = ownship.visible ? "" : "none";
      fallbackOwnship.style.opacity = ownship.stale ? "0.45" : "1";
    }
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
          coordinates: [
            points.reduce((sum, point) => sum + point[0], 0) / points.length,
            points.reduce((sum, point) => sum + point[1], 0) / points.length
          ]
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
  const staticGroup = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "g"
  );
  svg.append(staticGroup);
  fallbackOwnship = createFallbackOwnship();
  svg.append(fallbackOwnship);
  mapContainer.append(svg);
  const terminalLabelIds = new Set(
    selectTerminalLabelFeatures(features).map((feature) => feature.id)
  );
  const renderedTerminalLabels = new Set<string>();

  const redraw = () => {
    staticGroup.replaceChildren();
    renderedTerminalLabels.clear();
    const zoom = target.getZoom();
    for (const feature of features) {
      const projected = feature.points.map((coordinate) =>
        target.project(coordinate)
      );
      if (projected.length === 0) {
        continue;
      }
      const element = createFallbackGeometry(feature, projected, zoom);
      staticGroup.append(element);
      if (feature.ref && shouldShowFallbackLabel(feature, zoom)) {
        staticGroup.append(
          createFallbackLabel(feature.ref, projected, feature.kind)
        );
      }
      const terminalName = feature.name?.trim();
      if (
        terminalName &&
        feature.kind === "terminal" &&
        terminalLabelIds.has(feature.id) &&
        !renderedTerminalLabels.has(terminalName.toLowerCase())
      ) {
        staticGroup.append(
          createFallbackLabel(terminalName, projected, feature.kind)
        );
        renderedTerminalLabels.add(terminalName.toLowerCase());
      }
    }
  };
  target.on("move", redraw);
  target.on("resize", redraw);
  redraw();
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
    (feature.kind === "taxiway" || feature.kind === "taxilane") &&
    points.length >= 2
  ) {
    const group = document.createElementNS(namespace, "g");
    const pavement = createFallbackPolyline(points, "fallback-taxiway-pavement");
    pavement.setAttribute("stroke-width", String(Math.max(3, (zoom - 9) * 1.8)));
    const centerline = createFallbackPolyline(
      points,
      "fallback-taxiway-centerline"
    );
    group.append(pavement, centerline);
    return group;
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

    const labelText = (feature.ref ?? "").split("/")[endIndex] ??
      (feature.ref ?? "").split("/")[0] ?? "";
    if (labelText) {
      const labelPoint = screenPoint(origin, along, direction * length * 0.09);
      const label = createFallbackLabel(
        labelText,
        [labelPoint],
        "runway"
      );
      group.append(label);
    }
  }
  return group;
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

function formatState(state: TelemetrySnapshot["state"]): string {
  return state.replace(/([A-Z])/g, " $1").toLowerCase();
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

void start().catch((error: unknown) => {
  console.error(error);
  setStatus("Map failed to load", "error");
});
