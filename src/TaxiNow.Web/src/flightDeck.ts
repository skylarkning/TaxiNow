import { controllersForFir, onlineFirIds, type FirCallsign, type Controller } from './firControllers';
import * as ml from 'maplibre-gl';
import type { FeatureCollection, LineString } from 'geojson';
import { getLocale, t } from './localization';
import { activeRouteLeg, parseSimBrief, routeCoordinates, routeSections, type FlightPlan } from './flightPlan';
import { flightDeckTabs, formatWaypointCoordinates, type FlightDeckTab } from './flightDeckPresentation';
import { fetchLatestSimBriefPlan, filterSimBriefNavigation } from './simBriefClient';
import type { TelemetrySnapshot } from './contracts';
import type { VatsimTrafficAircraft, VatsimTrafficResponse } from './contracts';
import { hasRadarEcho, latestRadarFrame, parseWeatherMotion, radarTilePoint, type WeatherMotion } from './weatherRadar';
import { parseFirLabels, type FirLabel } from './firLabels';
import { isOnVisibleHemisphere } from './globeVisibility';
import { loadGnssInterference, type GnssInterferenceRegion } from './gnssInterference';
import { TouchdownAirportSelector, airportStatusAfterActivation, clearFlightPlanState, handleFlightDeckEscape, normalizeIcao, flightDeckAuxiliaryControls, type FlightPlanAirportStatus, type PlanAirportPair } from './flightPlanGround';
import { VerticalProfileController } from './verticalProfileController';
import { createVerticalProfileView } from './verticalProfileView';
import {
  vatsimTrafficPopupHeaderElement,
  vatsimTrafficPopupModel
} from './vatsimTrafficPresentation';
import './flightDeck.css';
import './workspace.css';
import { followAircraft } from './aircraftFollow';

function tr(key: string, parameters?: Record<string, string | number>): string { return t('flightdeck.' + key, parameters); }
const key = 'taxinow.simbrief';
const usernameKey = key + '.username';
const vatsimTrafficKey = 'taxinow.map.vatsimTraffic';
const weatherRadarKey = 'taxinow.globe.weatherRadar';
const gnssInterferenceKey = 'taxinow.globe.gnssInterference';
const aircraftFollowKey = 'taxinow.globe.aircraftFollow';
let aircraftFollowEnabled = false;
let lastFollowCameraAt = 0;
try { aircraftFollowEnabled = localStorage.getItem(aircraftFollowKey) === 'true'; } catch { /* Use default. */ }
let terrainEnabled = true;
try { terrainEnabled = localStorage.getItem('taxinow.terrain') !== 'false'; } catch { /* Use default. */ }
let globeTrafficEnabled = false, weatherRadarEnabled = false, gnssInterferenceEnabled = false;
try {
  globeTrafficEnabled = localStorage.getItem(vatsimTrafficKey) === 'true';
  weatherRadarEnabled = localStorage.getItem(weatherRadarKey) === 'true';
  gnssInterferenceEnabled = localStorage.getItem(gnssInterferenceKey) === 'true';
} catch { /* Use defaults. */ }
let routeMap: ml.Map | undefined, plan: FlightPlan | undefined;
let profileController: VerticalProfileController | undefined;
let ownship: ml.Marker | undefined, lastPosition: TelemetrySnapshot | undefined;
let markers: ml.Marker[] = [], currentTab: FlightDeckTab = 'flight', globeMode = true;
const globeTrafficMarkers = new Map<string, ml.Marker>();
let latestGlobeTraffic: VatsimTrafficAircraft[] = [];
let globeTrafficUpdatedAt = '';
let globeTrafficTimer: number | undefined, globeTrafficLoading = false;
let weatherRadarTimer: number | undefined, weatherMotionRefreshTimer: number | undefined, weatherRadarLoading = false, weatherMotionLoading = false, weatherMotionGeneration = 0;
let latestRadarTileUrl = '';
let onlineFirLoading = false;
let gnssInterferenceLoading = false;
const gnssRegions = new Map<string, GnssInterferenceRegion>();
let firLabels: FirLabel[] = [], firLabelsPromise: Promise<void> | undefined;
const firLabelMarkers = new Map<string, ml.Marker>();
const onlineFirFrequencies = new Map<string, string>();
let weatherMotionMarkers: ml.Marker[] = [];
export interface FlightDeckGroundNavigation {
  ensureAirports(plan: PlanAirportPair): Promise<void>;
  openAirport(icao: string): Promise<boolean>;
}
const airportStatuses = new Map<string, FlightPlanAirportStatus>();
const touchdownAirportSelector = new TouchdownAirportSelector();
let groundNavigation: FlightDeckGroundNavigation = {
  ensureAirports: async () => undefined,
  openAirport: async () => false
};
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function store(value: unknown): void { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Session remains usable. */ } }
function feedback(text: string, error = false): void { $('fd-feedback').textContent = text; $('fd-feedback').classList.toggle('error', error); }
function button(text: string, fn: () => void, className = ''): HTMLButtonElement {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.className = className; b.onclick = fn; return b;
}
export function setupFlightDeck(navigation?: FlightDeckGroundNavigation): void {
  if (navigation) groundNavigation = navigation;
  document.body.classList.add('flightdeck');
  const flightNumber = document.createElement('strong'); flightNumber.id = 'fd-flight-number';
  const airportName = $('airport-name');
  const flightIdentity = document.createElement('div'); flightIdentity.className = 'fd-flight-identity';
  flightIdentity.append(flightNumber, airportName);
  document.querySelector('.header-primary')!.append(flightIdentity);
  const airportCaption = document.createElement('small'); airportCaption.textContent = tr('airport');
  $('airport-picker-toggle').querySelector('[aria-hidden]')?.remove();
  $('airport-picker-toggle').prepend(airportCaption);
  const nav = document.createElement('nav'); nav.className = 'fd-tabs'; nav.setAttribute('aria-label', tr('navigation'));
  for (const tab of flightDeckTabs) {
    const b = button(tr(tab), () => { setMode(true); currentTab = tab; $('fd-panel').hidden = false; renderPanel(); });
    b.id = `fd-tab-${tab}`; nav.append(b);
  }
  const title = document.createElement('div'); title.id = 'fd-title'; title.textContent = 'TaxiNow Pro · ' + tr('view'); nav.append(title);
  document.querySelector('header .actions')!.prepend(nav);
  const rail = document.createElement('nav'); rail.className = 'fd-rail'; rail.setAttribute('aria-label', tr('mapViews'));
  rail.append(button(tr('globe'), () => setMode(true)), button(tr('ground'), () => setMode(false)));
  rail.children[0]!.id = 'fd-globe-mode'; rail.children[1]!.id = 'fd-ground-mode';
  rail.prepend(document.querySelector('.airport-switcher')!);
  const profileControl = button(tr('profile'), () => profileController?.setOpen(profileControl.getAttribute('aria-pressed') !== 'true'));
  profileControl.id = 'fd-profile-mode';
  profileControl.setAttribute('aria-controls', 'fd-vertical-profile');
  profileControl.setAttribute('aria-pressed', 'false');
  rail.append(profileControl);
  const airportShortcuts = document.createElement('div'); airportShortcuts.id = 'fd-airport-shortcuts'; airportShortcuts.className = 'fd-airport-shortcuts';
  for (const [kind, label] of [['origin', tr('from')], ['destination', tr('to')]] as const) {
    const shortcut = button('', () => { const icao = shortcut.dataset.icao; if (icao) void activateGroundAirport(icao); }, 'fd-airport-shortcut');
    shortcut.id = `fd-${kind}-airport`; shortcut.disabled = true;
    const caption = document.createElement('small'); caption.textContent = label;
    const code = document.createElement('strong'); code.textContent = '----';
    const status = document.createElement('span'); status.className = 'fd-airport-status';
    shortcut.append(caption, code, status); airportShortcuts.append(shortcut);
  }
  rail.append(airportShortcuts);
  const plannerControl = $('open-taxi-plan');
  plannerControl.hidden = false;
  plannerControl.removeAttribute('data-i18n');
  plannerControl.textContent = tr('planner');
  plannerControl.setAttribute('aria-label', tr('planner'));
  plannerControl.title = tr('planner');
  rail.append(plannerControl);
  // Move existing controls so their established handlers and dialogs are retained.
  for (const [id, label] of [['open-assets', tr('maps')]] as const) {
    const control = $(id);
    control.removeAttribute('data-i18n');
    control.textContent = label;
    control.setAttribute('aria-label', label);
    control.title = label;
    rail.append(control);
  }
  const about = $('open-about'), settingsMenu = $('settings-menu');
  about.classList.add('settings-check-row');
  about.setAttribute('role', 'menuitem');
  const report = button(t('actions.reportIssue'), () => {
    window.open('https://github.com/skylarkning/TaxiNow-Release/issues/new/choose', '_blank', 'noopener,noreferrer');
    settingsMenu.hidden = true;
    $('settings-selector').setAttribute('aria-expanded', 'false');
  }, 'settings-check-row');
  report.id = 'report-issue';
  report.setAttribute('role', 'menuitem');
  settingsMenu.append(report, about);
  about.addEventListener('click', () => {
    settingsMenu.hidden = true;
    $('settings-selector').setAttribute('aria-expanded', 'false');
  });
  document.getElementById('app')!.append(rail);
  const root = document.createElement('section'); root.id = 'fd-root'; root.setAttribute('aria-label', tr('view'));
  root.innerHTML = `<div id="fd-map"></div><aside id="fd-panel"><div class="fd-panel-head"><strong id="fd-panel-title"></strong><button id="fd-close" type="button" aria-label="${tr('close')}">×</button></div><div id="fd-form"><div class="fd-service">SimBrief <span>${tr('planning')}</span></div><button id="fd-import" type="button" class="fd-primary">${tr('import')}</button><p id="fd-feedback" role="status"></p></div><div id="fd-content"></div></aside><div class="fd-map-top"><button id="fd-north" type="button" title="${tr('north')}" aria-label="${tr('north')}"><svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><text x="16" y="8" text-anchor="middle" fill="currentColor" font-size="8" font-weight="700">N</text><path d="m16 10-6 16 6-4Z" fill="currentColor"/><path d="m16 10 6 16-6-4Z" fill="currentColor" opacity=".4"/></svg></button><button id="fd-projection" type="button">3D</button></div><div class="fd-map-tools"><button id="fd-fit" type="button" title="${tr('fit')}" aria-label="${tr('fit')}">⛶</button><button id="fd-locate" type="button" title="${tr('locate')}" aria-label="${tr('locate')}"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3"/><path d="m12 6 1.2 4.2 4.8 3v1.4l-4.8-1.4v3l1.8 1.2v1L12 17.6l-3 1.2v-1l1.8-1.2v-3L6 14.6v-1.4l4.8-3Z"/></svg></button><button id="fd-grid" type="button" title="${tr('grid')}" aria-label="${tr('grid')}" aria-pressed="true">⊞</button><button id="fd-fir" type="button" title="${tr('fir')}" aria-label="${tr('fir')}" aria-pressed="true">FIR</button><button id="fd-gnss" type="button" title="${tr('gnss')}" aria-label="${tr('gnss')}" aria-pressed="${gnssInterferenceEnabled}"><svg viewBox="0 0 28 22" width="28" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="14" cy="11" r="3"/><path d="M14 3v3m0 10v3M6 11h3m10 0h3M8.3 5.3l2.1 2.1m7.2 7.2 2.1 2.1m0-11.4-2.1 2.1m-7.2 7.2-2.1 2.1"/></svg><span>GNSS</span></button><button id="fd-traffic" type="button" title="VATSIM ${tr('aircraft')}" aria-label="VATSIM ${tr('aircraft')}" aria-pressed="${globeTrafficEnabled}"><span class="fd-tool-icon">✈</span><span>VATSIM</span></button><button id="fd-weather" type="button" title="${tr('weather')}" aria-label="${tr('weather')}" aria-pressed="${weatherRadarEnabled}"><svg viewBox="0 0 28 22" width="28" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M7 14h14a4 4 0 0 0 0-8 7 7 0 0 0-13-1 4.5 4.5 0 0 0-1 9Z"/><path d="m10 17-2 3m7-3-2 3m7-3-2 3"/></svg><span>${tr('radar')}</span></button><button id="fd-terrain" type="button" title="${tr('terrain')}" aria-label="${tr('terrain')}" aria-pressed="${terrainEnabled}"><svg viewBox="0 0 28 22" width="28" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M2 19 11 3l6 10 3-5 6 11H2Z"/><path d="m8 8 3 3 3-3"/></svg><span>${tr('terrain')}</span></button><button id="fd-plus" type="button" aria-label="${tr('zoomIn')}">+</button><button id="fd-minus" type="button" aria-label="${tr('zoomOut')}">−</button></div><div class="fd-map-bottom"><span>${tr('local')} · <a href="https://github.com/vatsimnetwork/vatspy-data-project" target="_blank" rel="noopener">FIR/ATC: VAT-Spy · CC BY-SA 4.0</a></span><span id="fd-gnss-credit" hidden><span class="fd-gnss-legend"><i class="interference"></i>${tr('interference')} <i class="spoofing"></i>${tr('spoofing')}</span> · <a href="https://www.easa.europa.eu/en/domains/air-operations/global-navigation-satellite-system-outages-and-alterations" target="_blank" rel="noopener">EASA Data4Safety</a></span><span id="fd-radar-credit" hidden><a href="https://www.rainviewer.com/" target="_blank" rel="noopener">${tr('radar')}: RainViewer</a> · <a href="https://open-meteo.com/" target="_blank" rel="noopener">${tr('motion')}: Open-Meteo 700 hPa</a></span><span id="fd-terrain-credit"><a href="https://goto.arcgisonline.com/maps/World_Physical_Map" target="_blank" rel="noopener">${tr('terrain')}: Esri · U.S. National Park Service</a></span><span id="fd-position">${tr('noPosition')}</span></div><p id="fd-map-error" role="alert" hidden></p></section>`;
  document.getElementById('app')!.append(root);
  document.querySelector('footer')!.insertBefore(root.querySelector('.fd-map-bottom')!, $('map-summary'));
  $('fd-panel').hidden = true;
  const planButtons = document.createElement('div'); planButtons.className = 'fd-import-actions';
  const importButton = $('fd-import'); importButton.before(planButtons);
  const clearButton = button(tr('clear'), clearPlan); clearButton.id = 'fd-clear-plan'; clearButton.hidden = true;
  planButtons.append(importButton, clearButton);
  const profileView = createVerticalProfileView(root);
  profileController = new VerticalProfileController(profileView, {
    initialOpen: false,
    onOpenChange: open => {
      profileControl.setAttribute('aria-pressed', String(open));
      profileControl.setAttribute('aria-current', String(open));
      requestAnimationFrame(() => { routeMap?.resize(); profileView.resize(); });
    }
  });
  root.addEventListener('vertical-profile-open-change', event => {
    profileController?.setOpen((event as CustomEvent<{ open: boolean }>).detail.open);
  });
  root.addEventListener('vertical-profile-retry', () => { void profileController?.retry(); });
  root.addEventListener('vertical-profile-viewport-change', event => {
    const detail = (event as CustomEvent<{ startDistanceNm: number; endDistanceNm: number }>).detail;
    profileController?.setViewport(detail.startDistanceNm, detail.endDistanceNm);
  });
  // Observe actual map dimensions throughout the profile's CSS transition.
  // Resizing never calls fitRoute, so opening a panel preserves pan and zoom.
  new ResizeObserver(() => routeMap?.resize()).observe($('fd-map'));
  if (lastPosition) profileController.setTelemetry(lastPosition);
  const northControl = $('fd-north'); northControl.classList.add('fd-north-control'); root.append(northControl);
  $('fd-close').onclick = () => { $('fd-panel').hidden = true; $(`fd-tab-${currentTab}`).focus(); };
  $('fd-import').onclick = () => void importPlan();
  const accountSettings = document.createElement('div'); accountSettings.className = 'fd-account-settings';
  accountSettings.innerHTML = '<strong>SimBrief</strong><label for="fd-identifier">' + tr('alias') + '</label><input id="fd-identifier" maxlength="100" placeholder="' + tr('alias') + '" autocomplete="off" spellcheck="false"><small>' + (tr('savedUsername')) + '</small>';
  settingsMenu.prepend(accountSettings);
  $('fd-identifier').addEventListener('input', () => { try { localStorage.setItem(usernameKey, $<HTMLInputElement>('fd-identifier').value.trim()); } catch { /* Keep usable in memory. */ } });
  $('fd-identifier').addEventListener('keydown', e => { if (e.key === 'Enter') { settingsMenu.hidden = true; $('settings-selector').setAttribute('aria-expanded', 'false'); } });
  $('fd-north').onclick = () => routeMap?.easeTo({ bearing: 0, pitch: 0 });
  $('fd-plus').onclick = () => routeMap?.zoomIn(); $('fd-minus').onclick = () => routeMap?.zoomOut();
  $('fd-fit').onclick = fitRoute;
  $('fd-traffic').onclick = () => $('show-vatsim-traffic').click();
  window.addEventListener('taxinow:vatsim-traffic-change', event => {
    globeTrafficEnabled = !!(event as CustomEvent<{ enabled: boolean }>).detail?.enabled;
    $('fd-traffic').setAttribute('aria-pressed', String(globeTrafficEnabled));
    if (globeTrafficEnabled) { startGlobeTraffic(); void refreshGlobeTraffic(); }
    else { stopGlobeTraffic(); clearGlobeTraffic(); }
  });
  $('fd-weather').onclick = () => {
    weatherRadarEnabled = !weatherRadarEnabled;
    $('fd-weather').setAttribute('aria-pressed', String(weatherRadarEnabled));
    $('fd-radar-credit').hidden = !weatherRadarEnabled;
    try { localStorage.setItem(weatherRadarKey, String(weatherRadarEnabled)); } catch { /* Keep usable. */ }
    if (weatherRadarEnabled) { startWeatherRadar(); void refreshWeatherRadar(); }
    else { stopWeatherRadar(); setRadarVisibility(false); clearWeatherMotion(); }
  };
  $('fd-gnss').onclick = () => {
    gnssInterferenceEnabled = !gnssInterferenceEnabled;
    $('fd-gnss').setAttribute('aria-pressed', String(gnssInterferenceEnabled));
    $('fd-gnss-credit').hidden = !gnssInterferenceEnabled;
    try { localStorage.setItem(gnssInterferenceKey, String(gnssInterferenceEnabled)); } catch { /* Keep usable. */ }
    setGnssVisibility(gnssInterferenceEnabled);
    updateFirLabelMarkers();
    if (gnssInterferenceEnabled) void refreshGnssInterference();
  };
  $('fd-terrain-credit').hidden = !terrainEnabled;
  $('fd-radar-credit').hidden = !weatherRadarEnabled;
  $('fd-gnss-credit').hidden = !gnssInterferenceEnabled;
  $('fd-terrain').onclick = () => {
    terrainEnabled = !terrainEnabled;
    $('fd-terrain').setAttribute('aria-pressed', String(terrainEnabled));
    $('fd-terrain-credit').hidden = !terrainEnabled;
    if (routeMap?.getLayer('terrain')) routeMap.setLayoutProperty('terrain', 'visibility', terrainEnabled ? 'visible' : 'none');
    try { localStorage.setItem('taxinow.terrain', String(terrainEnabled)); } catch { /* Keep usable. */ }
    $('fd-map-error').hidden = true;
  };
  $('fd-fir').onclick = () => { if (!routeMap?.getLayer('fir-boundary')) return; const on = $('fd-fir').getAttribute('aria-pressed') !== 'true'; $('fd-fir').setAttribute('aria-pressed', String(on)); for (const layer of ['fir-online', 'fir-boundary', 'fir-hit']) routeMap.setLayoutProperty(layer, 'visibility', on ? 'visible' : 'none'); updateFirLabelMarkers(); };
  $('fd-locate').onclick = () => { if (validPosition(lastPosition)) routeMap?.easeTo({ center: [lastPosition!.longitude, lastPosition!.latitude], zoom: 5 }); else feedback(tr('noPosition')); };
  const follow = button('✈', () => {
    aircraftFollowEnabled = !aircraftFollowEnabled;
    follow.setAttribute('aria-pressed', String(aircraftFollowEnabled));
    try { localStorage.setItem(aircraftFollowKey, String(aircraftFollowEnabled)); } catch { /* Keep session usable. */ }
    followFlightDeckAircraft(true);
    if (aircraftFollowEnabled && !validPosition(lastPosition)) feedback(tr('noPosition'));
  });
  follow.id = 'fd-follow'; follow.title = tr('follow');
  follow.setAttribute('aria-label', tr('follow'));
  follow.setAttribute('aria-pressed', String(aircraftFollowEnabled));
  $('fd-locate').after(follow);
  $('fd-grid').onclick = () => { if (!routeMap?.getLayer('grid')) return; const on = $('fd-grid').getAttribute('aria-pressed') !== 'true'; $('fd-grid').setAttribute('aria-pressed', String(on)); routeMap.setLayoutProperty('grid', 'visibility', on ? 'visible' : 'none'); };
  $('fd-projection').onclick = () => { globeMode = !globeMode; routeMap?.setProjection({ type: globeMode ? 'globe' : 'mercator' }); $('fd-projection').textContent = globeMode ? '3D' : '2D'; requestAnimationFrame(updateVisibleGlobeTraffic); };
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    if (saved.kind !== 'userid' && typeof saved.identifier === 'string') $<HTMLInputElement>('fd-identifier').value = saved.identifier;
    const username = localStorage.getItem(usernameKey); if (username !== null) $<HTMLInputElement>('fd-identifier').value = username;
    if (saved.raw) { plan = parseSimBrief(saved.raw); if (typeof saved.importedAt === 'string' && Number.isFinite(Date.parse(saved.importedAt))) plan.importedAt = saved.importedAt; feedback(tr('saved')); }
  } catch { /* An invalid cached plan does not block startup. */ }
  void profileController.setPlan(plan);
  $('open-taxi-plan').addEventListener('click', () => setMode(false));
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || $('fd-root').hidden) return;
    e.preventDefault();
    handleFlightDeckEscape(
      $('fd-root').dataset.profileOpen === 'true',
      () => profileController?.setOpen(false),
      () => $('fd-close').click()
    );
  });
  new MutationObserver(() => applyGlobeTheme()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  setMode(true); renderPanel();
  window.setInterval(() => void refreshOnlineFirHighlights(), 15_000);
  if (globeTrafficEnabled) startGlobeTraffic();
  if (weatherRadarEnabled) startWeatherRadar();
  window.setInterval(() => { if (!validPosition(lastPosition)) { ownship?.remove(); ownship = undefined; $('fd-position').textContent = tr('noPosition'); } }, 2000);
}
function setMode(globe: boolean): void {
  const mapView = globe ? 'globe' : 'ground';
  $('fd-root').hidden = !globe; document.body.dataset.mapView = mapView;
  const auxiliaryControls = flightDeckAuxiliaryControls(mapView);
  $('fd-profile-mode').hidden = !auxiliaryControls.profile;
  $('fd-airport-shortcuts').hidden = !auxiliaryControls.airports;
  $('open-taxi-plan').hidden = !auxiliaryControls.taxiPlanner;
  profileController?.setMapView(mapView);
  $('fd-globe-mode').setAttribute('aria-current', String(globe)); $('fd-ground-mode').setAttribute('aria-current', String(!globe));
  if (globe) {
    const taxiPanel = $('taxi-plan-panel'); if (taxiPanel) { taxiPanel.classList.remove('open'); taxiPanel.setAttribute('aria-hidden', 'true'); }
    if (!routeMap) createGlobe(); else { routeMap.resize(); updateFirLabelMarkers(); }
    if (globeTrafficEnabled) void refreshGlobeTraffic();
    if (weatherRadarEnabled) void refreshWeatherRadar();
  } else { const existing = (window as unknown as { taxiNowMap?: ml.Map }).taxiNowMap; requestAnimationFrame(() => existing?.resize()); }
}
async function importPlan(): Promise<void> {
  const control = $<HTMLButtonElement>('fd-import'); if (control.disabled) return;
  const identifier = $<HTMLInputElement>('fd-identifier').value.trim();
  if (!identifier) { feedback(tr('enterUsername'), true); $('settings-menu').hidden = false; $('settings-selector').setAttribute('aria-expanded', 'true'); $('fd-identifier').focus(); return; }
  control.disabled = true; control.textContent = tr('loading'); feedback('');
  try {
    const response = await fetchLatestSimBriefPlan(identifier, AbortSignal.timeout(25000));
    if (!response.ok) throw new Error(response.status === 400 ? (tr('planUnavailable')) : response.status === 504 ? (tr('timeout')) : (tr('serviceUnavailable')));
    const data = filterSimBriefNavigation(await response.json()), parsed = parseSimBrief(data);
    plan = parsed; void profileController?.setPlan(parsed); store({ identifier, kind: 'username', raw: data, importedAt: parsed.importedAt }); renderPanel(); drawRoute(); fitRoute(); feedback(tr('ready'));
    void groundNavigation.ensureAirports({ origin: parsed.origin, destination: parsed.destination });
  } catch (error) { feedback(error instanceof Error ? (error.name === 'TimeoutError' ? tr('timeout') : error.message === 'Invalid flight plan' || error.message.includes('navlog') ? (tr('navlog')) : error.message) : tr('failed'), true); }
  finally { control.disabled = false; control.textContent = '↓  ' + tr('import'); }
}
function renderPanel(): void {
  const flightLabel = plan?.callsign || (tr('noFlight'));
  $('fd-flight-number').textContent = flightLabel;
  $('airport-picker-toggle').setAttribute('aria-label', tr('selectAirport'));
  $('airport-picker-toggle').title = tr('selectAirport');
  for (const tab of flightDeckTabs) $(`fd-tab-${tab}`).setAttribute('aria-pressed', String(tab === currentTab));
  $('fd-clear-plan').hidden = !plan;
  $('fd-panel').dataset.tab = currentTab;
  $('fd-panel-title').textContent = tr(currentTab); $('fd-form').hidden = currentTab !== 'flight';
  renderAirportShortcuts();
  const content = $('fd-content'); content.replaceChildren();
  if (!plan) { const empty = document.createElement('div'); empty.className = 'fd-empty'; const icon = document.createElement('div'); icon.className = 'fd-empty-icon'; icon.textContent = '✈'; const h = document.createElement('h2'); h.textContent = tr('empty'); const p = document.createElement('p'); p.textContent = tr('emptyText'); const small = document.createElement('small'); small.textContent = tr('help'); empty.append(icon, h, p, small); content.append(empty); return; }
  $('fd-title').textContent = `${plan.origin} → ${plan.destination}  ·  ${plan.callsign || 'SimBrief'}`;
  if (currentTab === 'flight') { renderFlightOverview(content); return; }
  const summary = document.createElement('div'); summary.className = 'fd-summary';
  const heading = document.createElement('h2'); heading.textContent = `${plan.origin}  →  ${plan.destination}`;
  const names = document.createElement('p'); names.textContent = `${plan.originName} / ${plan.destinationName}`;
  const metrics = document.createElement('div'); metrics.className = 'fd-metrics';
  for (const [label, value] of [[tr('distance'), `${Math.round(plan.distance).toLocaleString()} NM`], [tr('altitude'), plan.altitude ? `${plan.altitude} FT` : '—']]) { const item = document.createElement('div'); const caption = document.createElement('small'); caption.textContent = label!; const strong = document.createElement('strong'); strong.textContent = value!; item.append(caption, strong); metrics.append(item); }
  summary.append(heading, names, metrics); content.append(summary);
  if (currentTab === 'route') { const route = document.createElement('p'); route.className = 'fd-route-text'; route.textContent = plan.route || 'DCT'; content.append(route); }
  const list = document.createElement('div'); list.className = 'fd-points';
  const label = document.createElement('div'); label.className = 'fd-section-label'; label.textContent = `${tr('points')} · ${plan.points.length}`; list.append(label);
  plan.points.forEach((p, i) => {
    const row = button('', () => { routeMap?.easeTo({ center: p.position, zoom: 5 }); list.querySelectorAll('.selected').forEach(e => e.classList.remove('selected')); row.classList.add('selected'); });
    row.className = 'fd-waypoint'; const number = document.createElement('span'); number.className = 'fd-number'; number.textContent = String(i + 1);
    const name = document.createElement('strong'); name.textContent = p.ident;
    const meta = document.createElement('small'); meta.className = 'fd-waypoint-coordinates'; meta.textContent = formatWaypointCoordinates(p.position);
    row.title = `${p.position[1].toFixed(4)}, ${p.position[0].toFixed(4)}`; row.append(number, name, meta); list.append(row);
  }); content.append(list);
  const actions = document.createElement('div'); actions.className = 'fd-plan-actions';
  actions.append(button(tr('fit'), fitRoute));
  const stamp = document.createElement('small'); stamp.textContent = `${tr('imported')} ${new Date(plan.importedAt).toLocaleTimeString()}`; actions.append(stamp); content.append(actions);
}
function clearPlan(): void {
  plan = clearFlightPlanState(profileController);
  store({ identifier: $<HTMLInputElement>('fd-identifier').value, kind: 'username' });
  $('fd-title').textContent = 'TaxiNow Pro · ' + tr('view');
  renderPanel();
  drawRoute();
  feedback('');
}
function gridData(): FeatureCollection<LineString> {
  const lines: number[][][] = [];
  for (let lng = -180; lng < 180; lng += 30) lines.push(Array.from({ length: 179 }, (_, i) => [lng, i - 89]));
  for (let lat = -60; lat <= 60; lat += 30) lines.push(Array.from({ length: 361 }, (_, i) => [i - 180, lat]));
  return { type: 'FeatureCollection', features: lines.map(coordinates => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })) };
}
function createGlobe(): void {
  try {
    routeMap = new ml.Map({ container: 'fd-map', center: [105, 30], zoom: 1.5, attributionControl: false,
      style: { version: 8, projection: { type: 'globe' }, sources: {
        terrain: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, minzoom: 0, maxzoom: 8, attribution: 'Esri · U.S. National Park Service' },
        fir: { type: 'geojson', data: '/fir-boundaries.json', attribution: 'VATSIM VAT-Spy · CC BY-SA 4.0' },
        land: { type: 'geojson', data: '/world-land.json' }, grid: { type: 'geojson', data: gridData() },
        route: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        'active-route': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
      }, layers: [
        { id: 'ocean', type: 'background', paint: { 'background-color': '#b9cbe2' } },
        { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#e6e9d6' } },
        { id: 'coast', type: 'line', source: 'land', paint: { 'line-color': '#a7b5a3', 'line-width': 0.7 } },
        { id: 'terrain', type: 'raster', source: 'terrain', layout: { visibility: terrainEnabled ? 'visible' : 'none' }, paint: { 'raster-opacity': 0.88, 'raster-saturation': -0.3, 'raster-fade-duration': 200 } },
        { id: 'grid', type: 'line', source: 'grid', paint: { 'line-color': '#83b394', 'line-width': 0.65, 'line-opacity': 0.65 } },
        { id: 'fir-online', type: 'fill', source: 'fir', filter: ['==', ['get', 'id'], ''], paint: { 'fill-color': '#56b4e9', 'fill-opacity': 0.24, 'fill-outline-color': '#2f9fd9' } },
        { id: 'gnss-interference', type: 'fill', source: 'fir', filter: ['==', ['get', 'id'], ''], layout: { visibility: gnssInterferenceEnabled ? 'visible' : 'none' }, paint: { 'fill-color': '#f4c542', 'fill-opacity': 0.27, 'fill-outline-color': '#b98500' } },
        { id: 'gnss-spoofing', type: 'fill', source: 'fir', filter: ['==', ['get', 'id'], ''], layout: { visibility: gnssInterferenceEnabled ? 'visible' : 'none' }, paint: { 'fill-color': '#e5484d', 'fill-opacity': 0.34, 'fill-outline-color': '#a71920' } },
        { id: 'fir-hit', type: 'fill', source: 'fir', paint: { 'fill-opacity': 0 } },
        { id: 'fir-boundary', type: 'line', source: 'fir', paint: { 'line-color': '#516577', 'line-width': 1, 'line-opacity': 0.8 } },
        { id: 'route-casing', type: 'line', source: 'route', filter: ['==', ['get', 'procedure'], false], paint: { 'line-color': '#ffffff', 'line-width': 6.5, 'line-opacity': 0.65 } },
        { id: 'route-line', type: 'line', source: 'route', filter: ['==', ['get', 'procedure'], false], paint: { 'line-color': '#1163d9', 'line-width': 4.5 } },
        { id: 'procedure-casing', type: 'line', source: 'route', filter: ['==', ['get', 'procedure'], true], paint: { 'line-color': '#ffffff', 'line-width': 6.5, 'line-opacity': 0.65, 'line-dasharray': [1.91, 1.27] } },
        { id: 'procedure-line', type: 'line', source: 'route', filter: ['==', ['get', 'procedure'], true], paint: { 'line-color': '#1163d9', 'line-width': 4.5, 'line-dasharray': [3, 2] } },
        { id: 'active-route-casing', type: 'line', source: 'active-route', paint: { 'line-color': '#ffffff', 'line-width': 7.5, 'line-opacity': 0.72 } },
        { id: 'active-route-line', type: 'line', source: 'active-route', paint: { 'line-color': '#d72cc7', 'line-width': 5.5 } }
      ] }
    });
    routeMap.on('error', e => {
      $('fd-map-error').hidden = false;
      const sourceId = 'sourceId' in e ? e.sourceId : '';
      $('fd-map-error').textContent = sourceId === 'terrain'
        ? (tr('terrainError'))
        : sourceId === 'weather-radar'
          ? (tr('radarError'))
          : tr('mapError');
    });
    routeMap.once('style.load', () => { applyGlobeTheme(); drawRoute(); if (plan) fitRoute(); void loadFirLabels(); void refreshOnlineFirHighlights(); if (gnssInterferenceEnabled) void refreshGnssInterference(); if (globeTrafficEnabled) void refreshGlobeTraffic(); if (weatherRadarEnabled) void refreshWeatherRadar(); });
    routeMap.on('zoom', updateGlobeTrafficLabelVisibility);
    routeMap.on('rotate', () => { $('fd-north').style.setProperty('--north-bearing', `${-routeMap!.getBearing()}deg`); updateGlobeTrafficHeadings(); updateWeatherMotionHeadings(); });
    routeMap.on('moveend', () => { updateFirLabelMarkers(); updateVisibleGlobeTraffic(); scheduleWeatherMotionRefresh(); });
  } catch { $('fd-map-error').hidden = false; $('fd-map-error').textContent = tr('mapError'); }
}
function applyGlobeTheme(): void {
  if (!routeMap?.getLayer('land')) return;
  const dark = document.documentElement.dataset.theme === 'dark';
  if (routeMap.getLayer('terrain')) routeMap.setPaintProperty('terrain', 'raster-brightness-max', dark ? 0.55 : 1);
  routeMap.setPaintProperty('ocean', 'background-color', dark ? '#293e53' : '#b9cbe2');
  routeMap.setPaintProperty('land', 'fill-color', dark ? '#566364' : '#e6e9d6');
  routeMap.setPaintProperty('coast', 'line-color', dark ? '#849995' : '#a7b5a3');
  if (routeMap.getLayer('fir-online')) {
    routeMap.setPaintProperty('fir-online', 'fill-color', dark ? '#4fb9e9' : '#56b4e9');
    routeMap.setPaintProperty('fir-online', 'fill-opacity', dark ? 0.2 : 0.24);
  }
}
function drawRoute(): void {
  if (!routeMap?.getSource('route')) return;
  markers.forEach(m => m.remove()); markers = [];
  const sections = plan ? routeSections(plan.points) : [];
  (routeMap.getSource('route') as ml.GeoJSONSource).setData({ type: 'FeatureCollection', features: sections.map(section => ({ type: 'Feature', properties: { procedure: section.procedure }, geometry: { type: 'LineString', coordinates: section.coordinates } })) });
  plan?.points.forEach((p, i) => {
    const el = document.createElement('button'); el.type = 'button'; el.className = 'fd-map-point'; el.title = p.ident; el.setAttribute('aria-label', `${i + 1} ${p.ident}`);
    const order = document.createElement('span'); order.className = 'fd-map-point-order'; order.textContent = String(i + 1);
    const label = document.createElement('span'); label.className = 'fd-map-point-name'; label.textContent = p.ident;
    el.append(order, label);
    const popup = document.createElement('div'); popup.textContent = `${p.ident} · ${p.position[1].toFixed(3)}, ${p.position[0].toFixed(3)}`;
    markers.push(new ml.Marker({ element: el }).setLngLat(p.position).setPopup(new ml.Popup({ offset: 12 }).setDOMContent(popup)).addTo(routeMap!));
  });
  updateActiveRouteLeg();
}

function updateActiveRouteLeg(): void {
  if (!routeMap?.getSource('active-route')) return;
  const active = plan && validPosition(lastPosition)
    ? activeRouteLeg(plan.points, [lastPosition!.longitude, lastPosition!.latitude])
    : undefined;
  (routeMap.getSource('active-route') as ml.GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: active ? [{ type: 'Feature', properties: { nextIndex: active.nextIndex }, geometry: { type: 'LineString', coordinates: active.coordinates } }] : []
  });
}

function loadFirLabels(): Promise<void> {
  if (firLabels.length) return Promise.resolve();
  if (firLabelsPromise) return firLabelsPromise;
  firLabelsPromise = (async () => {
    try {
      const response = await fetch('/fir-boundaries.json');
      if (!response.ok) throw new Error();
      firLabels = parseFirLabels(await response.json());
      updateFirLabelMarkers();
    } catch { /* FIR boundaries remain usable without labels. */ }
    finally { firLabelsPromise = undefined; }
  })();
  return firLabelsPromise;
}
function updateFirLabelMarkers(): void {
  if (!routeMap) return;
  const enabled = $('fd-fir').getAttribute('aria-pressed') === 'true' || gnssInterferenceEnabled;
  const selected = new Map<string, FirLabel>();
  if (enabled) {
    const zoom = routeMap.getZoom(), showSectors = zoom >= 2.6;
    const center = routeMap.getCenter();
    const cellWidth = zoom < 2.2 ? 150 : zoom < 4 ? 120 : 92;
    const cellHeight = zoom < 2.2 ? 58 : 48;
    const occupied = new Set<string>();
    for (const label of [...firLabels].sort((a, b) =>
      Number(!(onlineFirFrequencies.has(a.id) || (gnssInterferenceEnabled && gnssRegions.has(a.id)))) - Number(!(onlineFirFrequencies.has(b.id) || (gnssInterferenceEnabled && gnssRegions.has(b.id)))) ||
      Number(a.id.includes('-')) - Number(b.id.includes('-')))) {
      if (!showSectors && label.id.includes('-')) continue;
      if (globeMode && !isOnVisibleHemisphere([center.lng, center.lat], [label.longitude, label.latitude])) continue;
      const point = routeMap.project([label.longitude, label.latitude]);
      if (point.x < -80 || point.y < -40 || point.x > routeMap.getContainer().clientWidth + 80 || point.y > routeMap.getContainer().clientHeight + 40) continue;
      const cell = `${Math.floor(point.x / cellWidth)}:${Math.floor(point.y / cellHeight)}`;
      if (occupied.has(cell)) continue;
      occupied.add(cell); selected.set(label.id, label);
      if (selected.size >= 140) break;
    }
  }
  for (const [id, marker] of firLabelMarkers) if (!selected.has(id)) { marker.remove(); firLabelMarkers.delete(id); }
  for (const label of selected.values()) {
    let marker = firLabelMarkers.get(label.id);
    if (!marker) {
      const element = document.createElement('div'); element.className = 'fd-fir-label';
      const code = document.createElement('strong'); code.textContent = label.id;
      const name = document.createElement('span'); name.textContent = label.name;
      const frequency = document.createElement('em'); frequency.className = 'fd-fir-frequency';
      const warning = document.createElement('b'); warning.className = 'fd-gnss-label';
      element.append(code, name, frequency, warning);
      marker = new ml.Marker({ element, anchor: 'center' }).setLngLat([label.longitude, label.latitude]).addTo(routeMap);
      firLabelMarkers.set(label.id, marker);
    }
    const frequency = marker.getElement().querySelector<HTMLElement>('.fd-fir-frequency')!;
    frequency.textContent = onlineFirFrequencies.get(label.id) || '';
    frequency.hidden = !frequency.textContent;
    const warning = marker.getElement().querySelector<HTMLElement>('.fd-gnss-label')!;
    const gnss = gnssInterferenceEnabled ? gnssRegions.get(label.id) : undefined;
    warning.textContent = gnss ? (gnss.spoofing ? tr('spoofWarning') : 'GNSS') : '';
    warning.classList.toggle('spoofing', !!gnss?.spoofing);
    warning.hidden = !warning.textContent;
  }
}

function startGlobeTraffic(): void {
  if (globeTrafficTimer === undefined) globeTrafficTimer = window.setInterval(() => void refreshGlobeTraffic(), 15_000);
}
function stopGlobeTraffic(): void {
  if (globeTrafficTimer !== undefined) window.clearInterval(globeTrafficTimer);
  globeTrafficTimer = undefined;
}
function clearGlobeTraffic(): void {
  globeTrafficMarkers.forEach(marker => marker.remove());
  globeTrafficMarkers.clear();
  latestGlobeTraffic = [];
}
async function refreshGlobeTraffic(): Promise<void> {
  if (!globeTrafficEnabled || globeTrafficLoading || !routeMap || $('fd-root').hidden) return;
  globeTrafficLoading = true;
  try {
    const response = await fetch('/api/v1/integrations/vatsim/traffic/global', { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error();
    const feed = await response.json() as VatsimTrafficResponse;
    if (!globeTrafficEnabled || !routeMap) return;
    latestGlobeTraffic = feed.aircraft;
    globeTrafficUpdatedAt = new Date(feed.feedUpdatedAtUtc || feed.retrievedAtUtc).toLocaleTimeString();
    updateVisibleGlobeTraffic();
    $('fd-map-error').hidden = true;
  } catch {
    $('fd-map-error').hidden = false;
    $('fd-map-error').textContent = tr('trafficError');
  } finally { globeTrafficLoading = false; }
}
function updateVisibleGlobeTraffic(): void {
  if (!routeMap || !globeTrafficEnabled) return;
  const container = routeMap.getContainer(), center = routeMap.getCenter();
  const visible = latestGlobeTraffic.filter(item => {
    if (globeMode && !isOnVisibleHemisphere([center.lng, center.lat], [item.longitude, item.latitude])) return false;
    const point = routeMap!.project([item.longitude, item.latitude]);
    return point.x >= -24 && point.y >= -24 && point.x <= container.clientWidth + 24 && point.y <= container.clientHeight + 24;
  });
  reconcileGlobeTraffic(visible);
  $('fd-traffic').title = `${tr('trafficInView', { visible: visible.length, total: latestGlobeTraffic.length })} · ${globeTrafficUpdatedAt}`;
}
function reconcileGlobeTraffic(aircraft: VatsimTrafficAircraft[]): void {
  if (!routeMap) return;
  const active = new Set<string>();
  for (const item of aircraft) {
    active.add(item.callsign);
    let marker = globeTrafficMarkers.get(item.callsign);
    if (!marker) {
      const element = document.createElement('button'); element.type = 'button'; element.className = 'fd-vatsim-aircraft';
      element.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c.8 0 1.4.6 1.4 1.4v5.1l7.1 4.2v1.7l-7.1-2.1v4.8l2.3 1.7v1.4L12 19l-3.7 1.2v-1.4l2.3-1.7v-4.8l-7.1 2.1v-1.7l7.1-4.2V3.4C10.6 2.6 11.2 2 12 2Z"/></svg><span class="fd-vatsim-label"></span>';
      const popup = new ml.Popup({ offset: 15, className: 'fd-traffic-map-popup', maxWidth: '290px' });
      marker = new ml.Marker({ element, anchor: 'center', rotationAlignment: 'viewport', pitchAlignment: 'viewport' })
        .setLngLat([item.longitude, item.latitude]).setPopup(popup).addTo(routeMap);
      globeTrafficMarkers.set(item.callsign, marker);
    }
    marker.setLngLat([item.longitude, item.latitude]);
    const element = marker.getElement();
    element.dataset.heading = String(item.headingDegrees);
    element.setAttribute('aria-label', `${item.callsign}, ${item.aircraftType || tr('aircraft')}, ${item.altitudeFeet} FT`);
    element.title = `${item.callsign} · ${item.aircraftType || '—'} · ${item.altitudeFeet.toLocaleString()} FT · ${item.groundSpeedKnots} KT`;
    element.querySelector<HTMLElement>('.fd-vatsim-label')!.textContent = item.callsign;
    element.style.setProperty('--fd-aircraft-heading', `${item.headingDegrees - routeMap.getBearing()}deg`);
    marker.getPopup()?.setDOMContent(createTrafficPopupContent(item));
  }
  for (const [callsign, marker] of globeTrafficMarkers) if (!active.has(callsign)) { marker.remove(); globeTrafficMarkers.delete(callsign); }
  updateGlobeTrafficLabelVisibility();
}
function createTrafficPopupContent(item: VatsimTrafficAircraft): HTMLElement {
  const model = vatsimTrafficPopupModel(item, getLocale().startsWith('zh'));
  const card = document.createElement('article'); card.className = 'fd-traffic-popup';
  const header = document.createElement(vatsimTrafficPopupHeaderElement); header.className = 'fd-traffic-popup-header';
  const identity = document.createElement('div'); const callsign = document.createElement('strong'); callsign.textContent = model.callsign;
  const type = document.createElement('small'); type.textContent = item.aircraftType || tr('typeUnknown'); identity.append(callsign, type);
  const source = document.createElement('span'); source.textContent = 'VATSIM'; header.append(identity, source);
  const route = document.createElement('section'); route.className = 'fd-traffic-popup-route'; route.classList.toggle('unavailable', model.routeUnavailable);
  const routeLabel = document.createElement('small'); routeLabel.textContent = tr('routeLabel');
  const routeValue = document.createElement('strong'); routeValue.textContent = model.routeUnavailable ? tr('routeUnavailable') : model.route; route.append(routeLabel, routeValue);
  const metrics = document.createElement('dl'); metrics.className = 'fd-traffic-popup-metrics';
  for (const [label, value] of [[tr('alt'), model.altitude], [tr('gs'), model.groundSpeed], [tr('hdg'), model.heading]]) {
    const group = document.createElement('div'); const term = document.createElement('dt'); term.textContent = label!;
    const description = document.createElement('dd'); description.textContent = value!; group.append(term, description); metrics.append(group);
  }
  card.append(header, route, metrics); return card;
}
function updateGlobeTrafficHeadings(): void {
  if (!routeMap) return;
  const bearing = routeMap.getBearing();
  globeTrafficMarkers.forEach(marker => {
    const heading = Number(marker.getElement().dataset.heading || 0);
    marker.getElement().style.setProperty('--fd-aircraft-heading', `${heading - bearing}deg`);
  });
}
function updateGlobeTrafficLabelVisibility(): void {
  if (routeMap) $('fd-map').classList.toggle('fd-show-traffic-labels', routeMap.getZoom() >= 3.2);
}

function startWeatherRadar(): void {
  if (weatherRadarTimer === undefined) weatherRadarTimer = window.setInterval(() => void refreshWeatherRadar(), 10 * 60_000);
}
function stopWeatherRadar(): void {
  if (weatherRadarTimer !== undefined) window.clearInterval(weatherRadarTimer);
  weatherRadarTimer = undefined;
}
function setRadarVisibility(visible: boolean): void {
  if (routeMap?.getLayer('weather-radar')) routeMap.setLayoutProperty('weather-radar', 'visibility', visible ? 'visible' : 'none');
  weatherMotionMarkers.forEach(marker => marker.getElement().hidden = !visible);
}
async function refreshWeatherRadar(): Promise<void> {
  if (!weatherRadarEnabled || weatherRadarLoading || !routeMap || $('fd-root').hidden || !routeMap.getLayer('fir-hit')) return;
  weatherRadarLoading = true;
  try {
    const response = await fetch('https://api.rainviewer.com/public/weather-maps.json', { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error();
    const frame = latestRadarFrame(await response.json());
    if (!frame || !weatherRadarEnabled || !routeMap) throw new Error();
    if (routeMap.getLayer('weather-radar')) routeMap.removeLayer('weather-radar');
    if (routeMap.getSource('weather-radar')) routeMap.removeSource('weather-radar');
    routeMap.addSource('weather-radar', { type: 'raster', tiles: [frame.tileUrl], tileSize: 256, minzoom: 0, maxzoom: 7, attribution: 'RainViewer' });
    routeMap.addLayer({ id: 'weather-radar', type: 'raster', source: 'weather-radar', paint: { 'raster-opacity': 0.68, 'raster-fade-duration': 200 } }, 'fir-online');
    latestRadarTileUrl = frame.tileUrl;
    void refreshWeatherMotion(++weatherMotionGeneration);
    $('fd-weather').title = `${tr('weather')} · ${new Date(frame.observedAtUnix * 1000).toLocaleTimeString()}`;
    $('fd-map-error').hidden = true;
  } catch {
    $('fd-map-error').hidden = false;
    $('fd-map-error').textContent = tr('radarError');
  } finally { weatherRadarLoading = false; }
}

function scheduleWeatherMotionRefresh(): void {
  if (!weatherRadarEnabled) return;
  if (weatherMotionRefreshTimer !== undefined) window.clearTimeout(weatherMotionRefreshTimer);
  const generation = ++weatherMotionGeneration;
  weatherMotionRefreshTimer = window.setTimeout(() => void refreshWeatherMotion(generation), 650);
}

function renderAirportShortcuts(): void {
  for (const [kind, icao] of [['origin', plan?.origin], ['destination', plan?.destination]] as const) {
    const shortcut = $<HTMLButtonElement>(`fd-${kind}-airport`);
    if (!shortcut) continue;
    const normalized = normalizeIcao(icao || '');
    const status = normalized ? airportStatuses.get(normalized) || 'idle' : 'idle';
    shortcut.dataset.icao = normalized;
    shortcut.dataset.status = status;
    shortcut.disabled = !normalized || status === 'opening';
    shortcut.querySelector('strong')!.textContent = normalized || '----';
    const statusText = shortcut.querySelector<HTMLElement>('.fd-airport-status')!;
    statusText.textContent = status === 'checking' ? (tr('check'))
      : status === 'downloading' ? (tr('load'))
      : status === 'ready' ? '✓'
      : status === 'failed' ? (tr('retry'))
      : status === 'opening' ? '…' : '';
    const role = kind === 'origin' ? (tr('departure')) : (tr('arrival'));
    shortcut.title = normalized ? `${role} ${normalized}` : role;
    shortcut.setAttribute('aria-label', shortcut.title);
  }
}

export function updateFlightPlanAirportStatus(icao: string, status: FlightPlanAirportStatus): void {
  airportStatuses.set(icao.trim().toUpperCase(), status);
  if ($('fd-airport-shortcuts')) renderAirportShortcuts();
}

async function activateGroundAirport(icao: string): Promise<void> {
  const previousStatus = airportStatuses.get(icao) || 'idle';
  updateFlightPlanAirportStatus(icao, 'opening');
  try {
    const opened = await groundNavigation.openAirport(icao);
    updateFlightPlanAirportStatus(icao, airportStatusAfterActivation(previousStatus, opened));
    if (!opened) return;
    setMode(false);
  } catch {
    updateFlightPlanAirportStatus(icao, 'failed');
  }
}
function clearWeatherMotion(invalidate = true): void {
  if (invalidate) weatherMotionGeneration += 1;
  if (weatherMotionRefreshTimer !== undefined) window.clearTimeout(weatherMotionRefreshTimer);
  weatherMotionRefreshTimer = undefined;
  weatherMotionMarkers.forEach(marker => marker.remove());
  weatherMotionMarkers = [];
}
function updateWeatherMotionHeadings(): void {
  if (!routeMap) return;
  const mapBearing = routeMap.getBearing();
  weatherMotionMarkers.forEach(marker => {
    const bearing = Number(marker.getElement().dataset.bearing || 0);
    marker.getElement().style.setProperty('--fd-weather-bearing', `${bearing - mapBearing - 90}deg`);
  });
}
function drawWeatherMotion(motion: WeatherMotion[]): void {
  clearWeatherMotion(false);
  if (!routeMap) return;
  weatherMotionMarkers = motion.map(item => {
    const element = document.createElement('div');
    element.className = 'fd-weather-motion';
    element.dataset.bearing = String(item.bearingDegrees);
    element.style.setProperty('--fd-weather-bearing', `${item.bearingDegrees - routeMap!.getBearing() - 90}deg`);
    element.innerHTML = '<svg viewBox="0 0 54 24" aria-hidden="true"><circle cx="8" cy="12" r="5"/><circle cx="8" cy="12" r="2"/><path d="M13 12h31"/><path d="m37 5 9 7-9 7"/></svg><span>' + Math.round(item.speedKnots) + '</span>';
    element.title = `${Math.round(item.speedKnots)} KT`;
    return new ml.Marker({ element, anchor: 'center' }).setLngLat(item.position).addTo(routeMap!);
  });
}
async function filterWeatherMotionByRadar(motion: WeatherMotion[], tileTemplate: string): Promise<WeatherMotion[]> {
  if (!routeMap || !tileTemplate) return [];
  const zoom = Math.max(3, Math.min(6, Math.floor(routeMap.getZoom()) + 1));
  const tiles = new Map<string, Promise<{ pixels: Uint8ClampedArray; width: number; height: number }>>();
  const readTile = (tileX: number, tileY: number) => {
    const key = `${zoom}/${tileX}/${tileY}`;
    let pending = tiles.get(key);
    if (!pending) {
      pending = new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.decoding = 'async';
        image.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) { reject(new Error('Canvas unavailable')); return; }
          context.drawImage(image, 0, 0);
          resolve({ pixels: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height });
        };
        image.onerror = () => reject(new Error('Radar tile unavailable'));
        image.src = tileTemplate.replace('{z}', String(zoom)).replace('{x}', String(tileX)).replace('{y}', String(tileY));
      });
      tiles.set(key, pending);
    }
    return pending;
  };
  const visible = await Promise.all(motion.map(async item => {
    const point = radarTilePoint(item.position, zoom);
    try {
      const tile = await readTile(point.tileX, point.tileY);
      return hasRadarEcho(tile.pixels, tile.width, tile.height, point.pixelX, point.pixelY) ? item : undefined;
    } catch { return undefined; }
  }));
  return visible.filter((item): item is WeatherMotion => !!item);
}
async function refreshWeatherMotion(generation = ++weatherMotionGeneration): Promise<void> {
  if (!weatherRadarEnabled || !routeMap || $('fd-root').hidden) return;
  if (weatherMotionLoading) {
    if (generation === weatherMotionGeneration)
      weatherMotionRefreshTimer = window.setTimeout(() => void refreshWeatherMotion(generation), 250);
    return;
  }
  weatherMotionLoading = true;
  try {
    const container = routeMap.getContainer();
    const samples = [0.12, 0.38, 0.62, 0.88].flatMap(x => [0.2, 0.5, 0.8].map(y =>
      routeMap!.unproject([container.clientWidth * x, container.clientHeight * y])));
    const latitude = samples.map(point => point.lat.toFixed(3)).join(',');
    const longitude = samples.map(point => point.lng.toFixed(3)).join(',');
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', latitude);
    url.searchParams.set('longitude', longitude);
    url.searchParams.set('current', 'wind_speed_700hPa,wind_direction_700hPa');
    url.searchParams.set('wind_speed_unit', 'kn');
    url.searchParams.set('forecast_days', '1');
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error();
    const motion = parseWeatherMotion(await response.json());
    const visible = await filterWeatherMotionByRadar(motion, latestRadarTileUrl);
    if (generation === weatherMotionGeneration && weatherRadarEnabled) drawWeatherMotion(visible);
  } catch { if (generation === weatherMotionGeneration) clearWeatherMotion(); }
  finally { weatherMotionLoading = false; }
}

function setGnssVisibility(visible: boolean): void {
  for (const layer of ['gnss-interference', 'gnss-spoofing']) {
    if (routeMap?.getLayer(layer)) routeMap.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none');
  }
}
async function refreshGnssInterference(): Promise<void> {
  if (!gnssInterferenceEnabled || gnssInterferenceLoading || !routeMap || $('fd-root').hidden || !routeMap.getLayer('gnss-interference')) return;
  gnssInterferenceLoading = true;
  try {
    const feed = await loadGnssInterference();
    if (!feed || !routeMap?.getLayer('gnss-interference')) throw new Error();
    await loadFirLabels();
    const supportedIds = new Set(firLabels.map(label => label.id));
    const supportedRegions = feed.regions.filter(region => supportedIds.has(region.icao));
    gnssRegions.clear();
    supportedRegions.forEach(region => gnssRegions.set(region.icao, region));
    routeMap.setFilter('gnss-interference', ['in', ['get', 'id'], ['literal', supportedRegions.filter(region => !region.spoofing).map(region => region.icao)]]);
    routeMap.setFilter('gnss-spoofing', ['in', ['get', 'id'], ['literal', supportedRegions.filter(region => region.spoofing).map(region => region.icao)]]);
    updateFirLabelMarkers();
    const date = new Date(`${feed.observedOn}T00:00:00`).toLocaleDateString();
    const status = feed.isStale ? (' · ' + tr('cached')) : '';
    $('fd-gnss').title = `${tr('gnss')} · ${supportedRegions.length} FIR · ${date}${status}`;
    $('fd-gnss-credit').title = `${date}${status}`;
    $('fd-map-error').hidden = true;
  } catch {
    $('fd-map-error').hidden = false;
    $('fd-map-error').textContent = tr('gnssError');
  } finally { gnssInterferenceLoading = false; }
}

async function refreshOnlineFirHighlights(): Promise<void> {
  if (onlineFirLoading || !routeMap || $('fd-root').hidden || !routeMap.getLayer('fir-online')) return;
  onlineFirLoading = true;
  try {
    firMappings ??= fetch('/fir-callsigns.json').then(response => {
      if (!response.ok) throw new Error();
      return response.json() as Promise<FirCallsign[]>;
    }).catch(error => { firMappings = undefined; throw error; });
    const [mappings, response] = await Promise.all([
      firMappings,
      fetch('/api/v1/integrations/vatsim/controllers', { signal: AbortSignal.timeout(15_000) })
    ]);
    if (!response.ok) throw new Error();
    const feed = await response.json() as { controllers: Controller[]; isStale: boolean; feedUpdatedAtUtc: string | null };
    if (!routeMap?.getLayer('fir-online')) return;
    const ids = feed.isStale ? [] : onlineFirIds(feed.controllers, mappings);
    onlineFirFrequencies.clear();
    for (const id of ids) {
      const stations = controllersForFir(id, feed.controllers, mappings);
      if (stations.length) onlineFirFrequencies.set(id, stations.map(station => `${station.callsign} ${station.frequency}`).join(' · '));
    }
    routeMap.setFilter('fir-online', ['in', ['get', 'id'], ['literal', ids]]);
    updateFirLabelMarkers();
    $('fd-fir').title = `${tr('fir')} · ${tr('onlineRegions', { count: ids.length })}`;
  } catch {
    onlineFirFrequencies.clear();
    updateFirLabelMarkers();
    if (routeMap?.getLayer('fir-online')) routeMap.setFilter('fir-online', ['==', ['get', 'id'], '']);
  } finally { onlineFirLoading = false; }
}
function fitRoute(): void {
  if (!routeMap) return;
  if (!plan) { routeMap.easeTo({ center: [105, 30], zoom: 1.5 }); return; }
  const coords = routeCoordinates(plan.points.map(p => p.position));
  const bounds = new ml.LngLatBounds(); coords.forEach(p => bounds.extend(p));
  routeMap.fitBounds(bounds, { padding: { top: 75, right: 90, bottom: 75, left: window.innerWidth > 900 && !$('fd-panel').hidden ? 420 : 55 }, maxZoom: 6, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650 });
}
function validPosition(value?: TelemetrySnapshot): boolean {
  return !!value && value.hasPosition && value.connected && !value.isStale && Number.isFinite(value.latitude) && Number.isFinite(value.longitude) && Math.abs(value.latitude) <= 90 && Math.abs(value.longitude) <= 180 && Date.now() - Date.parse(value.serverTimestampUtc) < 15000;
}
function followFlightDeckAircraft(force = false): void {
  const now = performance.now();
  if (!aircraftFollowEnabled || !routeMap || $('fd-root').hidden || !validPosition(lastPosition) ||
      (!force && now - lastFollowCameraAt < 250)) return;
  const panel = $('fd-panel');
  const bounds = routeMap.getCanvas().getBoundingClientRect();
  const panelBounds = panel.hidden ? undefined : panel.getBoundingClientRect();
  const covered = panelBounds && panelBounds.width < bounds.width * 0.7
    ? Math.max(0, Math.min(bounds.width, panelBounds.right - bounds.left)) : 0;
  followAircraft(routeMap, [lastPosition!.longitude, lastPosition!.latitude], lastPosition!.trueHeadingDegrees,
    [covered / 2, 0], force ? 5 : 0);
  lastFollowCameraAt = now;
}
export function updateFlightDeckPosition(sample: TelemetrySnapshot): void {
  lastPosition = sample;
  profileController?.setTelemetry(sample);
  const touchdownAirport = touchdownAirportSelector.observe({
    connected: validPosition(sample),
    hasPosition: sample.hasPosition,
    isStale: sample.isStale,
    onGround: sample.onGround
  }, plan?.destination || '');
  if (touchdownAirport) void activateGroundAirport(touchdownAirport);
  if (!routeMap || !validPosition(sample)) { ownship?.remove(); ownship = undefined; updateActiveRouteLeg(); if ($('fd-position')) $('fd-position').textContent = tr('noPosition'); return; }
  if (!ownship) { const el = document.createElement('div'); el.className = 'fd-ownship'; el.textContent = '▲'; ownship = new ml.Marker({ element: el, rotationAlignment: 'map' }).setLngLat([sample.longitude, sample.latitude]).addTo(routeMap); }
  ownship.setLngLat([sample.longitude, sample.latitude]).setRotation(sample.trueHeadingDegrees);
  followFlightDeckAircraft();
  updateActiveRouteLeg();
  $('fd-position').textContent = `${Math.round(sample.trueHeadingDegrees)}°  ·  ${Math.round(sample.groundSpeedKnots)} KT`;
}




let firMappings: Promise<FirCallsign[]> | undefined;
async function showFirFrequencies(e: ml.MapLayerMouseEvent): Promise<void> {
  if (!routeMap) return;
  const areas = [...new Map((e.features || []).map(f => [String(f.properties?.id), String(f.properties?.name || f.properties?.id)])).entries()];
  if (!areas.length) return;
  const content = document.createElement('div'); content.className = 'fd-fir-popup';
  const title = document.createElement('strong'); title.textContent = tr('onlineControl');
  const body = document.createElement('div');
  const popup = new ml.Popup({ maxWidth: '360px' }).setLngLat(e.lngLat).setDOMContent(content).addTo(routeMap);
  const refresh = button(tr('refreshFrequencies'), () => void load());
  content.append(title, body, refresh);
  async function load(): Promise<void> {
    refresh.disabled = true; body.textContent = tr('loadingFrequencies');
    try {
      firMappings ??= fetch('/fir-callsigns.json').then(r => { if (!r.ok) throw new Error(); return r.json() as Promise<FirCallsign[]>; }).catch(error => { firMappings = undefined; throw error; });
      const [mappings, response] = await Promise.all([firMappings, fetch('/api/v1/integrations/vatsim/controllers', { signal: AbortSignal.timeout(15000) })]);
      if (!response.ok) throw new Error();
      const feed = await response.json() as { controllers: Controller[]; isStale: boolean; feedUpdatedAtUtc: string };
      if (!popup.isOpen()) return;
      body.replaceChildren();
      if (feed.isStale) { body.textContent = tr('staleFrequencies'); return; }
      for (const [id, name] of areas) {
        const section = document.createElement('section'); const heading = document.createElement('h4'); heading.textContent = name; section.append(heading);
        const matches = controllersForFir(id, feed.controllers, mappings);
        if (!matches.length) { const empty = document.createElement('p'); empty.textContent = tr('noController'); section.append(empty); }
        for (const station of matches) { const row = document.createElement('p'); row.textContent = station.callsign + ' · ' + station.frequency + ' MHz'; section.append(row); }
        body.append(section);
      }
      const updated = document.createElement('small'); updated.textContent = (tr('feedUpdated')) + new Date(feed.feedUpdatedAtUtc).toLocaleTimeString(); body.append(updated);
    } catch { if (popup.isOpen()) body.textContent = tr('frequencyError'); }
    finally { refresh.disabled = false; }
  }
  await load();
}

function renderFlightOverview(content: HTMLElement): void {
  if (!plan) return;
  const current = plan;
  const card = document.createElement('div'); card.className = 'fd-flight-card';
  for (const [code, name, label, position] of [
    [current.origin, current.originName, tr('from'), current.points[0]!.position],
    [current.destination, current.destinationName, tr('to'), current.points.at(-1)!.position]
  ] as const) {
    const row = button('', () => routeMap?.easeTo({ center: position, zoom: 6 }), 'fd-airport-row');
    const badge = document.createElement('strong'); badge.textContent = code;
    const fullName = document.createElement('span'); fullName.textContent = name; fullName.title = name;
    const caption = document.createElement('small'); caption.textContent = label;
    row.append(badge, fullName, caption); card.append(row);
  }
  const route = document.createElement('section'); route.className = 'fd-route-chips-section';
  const caption = document.createElement('div'); caption.className = 'fd-section-label'; caption.textContent = tr('waypointsAirways'); route.append(caption);
  const chips = document.createElement('div'); chips.className = 'fd-route-chips';
  let lastAirway = '';
  current.points.slice(1, -1).forEach(point => {
    if (point.airway && point.airway !== lastAirway) { const airway = document.createElement('span'); airway.className = 'fd-airway-chip'; airway.textContent = point.airway; chips.append(airway); lastAirway = point.airway; }
    const chip = button(point.ident, () => { routeMap?.easeTo({ center: point.position, zoom: 6 }); chips.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', 'false')); chip.setAttribute('aria-pressed', 'true'); }, 'fd-route-chip');
    chip.title = tr('locatePoint', { ident: point.ident }); chip.setAttribute('aria-pressed', 'false'); chips.append(chip);
  });
  if (current.points.length === 2) { const direct = document.createElement('span'); direct.className = 'fd-airway-chip'; direct.textContent = 'DCT'; chips.append(direct); }
  route.append(chips); card.append(route);
  const distance = document.createElement('div'); distance.className = 'fd-flight-distance';
  const metric = document.createElement('div'); const label = document.createElement('small'); label.textContent = tr('distance'); const value = document.createElement('strong'); value.textContent = Math.round(current.distance).toLocaleString() + ' NM'; metric.append(label, value);
  distance.append(metric, button(tr('fit'), fitRoute)); card.append(distance); content.append(card);
  const details = document.createElement('div'); details.className = 'fd-flight-details';
  for (const [label, value] of [[tr('aircraft'), current.aircraft || '—'], [tr('altitude'), current.altitude ? current.altitude + ' FT' : '—']]) { const row = document.createElement('div'); const caption = document.createElement('span'); caption.textContent = label!; const text = document.createElement('strong'); text.textContent = value!; row.append(caption, text); details.append(row); }
  content.append(details);
  const actions = document.createElement('div'); actions.className = 'fd-plan-actions';
  const stamp = document.createElement('small'); stamp.textContent = tr('imported') + ' ' + new Date(current.importedAt).toLocaleTimeString();
  actions.append(stamp); content.append(actions);
}
