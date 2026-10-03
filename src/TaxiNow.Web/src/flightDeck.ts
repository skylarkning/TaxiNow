import { controllersForFir, type FirCallsign, type Controller } from './firControllers';
import * as ml from 'maplibre-gl';
import type { FeatureCollection, LineString } from 'geojson';
import { getLocale } from './localization';
import { parseSimBrief, routeCoordinates, routeSections, distanceNm, type FlightPlan } from './flightPlan';
import type { TelemetrySnapshot } from './contracts';
import './flightDeck.css';

const words = {
  flight: ['飞行计划', 'Flight'], route: ['航路信息', 'Route Info'], log: ['航路日志', 'NavLog'],
  ground: ['地面', 'Taxi'], globe: ['地球', 'Globe'], maps: ['地图管理', 'Maps'],
  planner: ['滑行规划', 'Plan Taxi'], terrain: ['地形', 'Terrain'],
  import: ['导入最新计划', 'Import latest plan'], alias: ['用户名', 'Username'], pilot: ['Pilot ID', 'Pilot ID'],
  help: ['先在 SimBrief 生成计划，再在这里导入。', 'Generate a plan in SimBrief, then import it here.'],
  empty: ['准备下一段飞行', 'Your next flight starts here'], emptyText: ['从 SimBrief 导入航路，在地球上查看完整旅程。', 'Import from SimBrief to explore your route on the globe.'],
  fit: ['完整航路', 'Fit route'], clear: ['清除计划', 'Clear plan'], north: ['正北向上', 'North Up'],
  locate: ['定位飞机', 'Locate aircraft'], grid: ['经纬网', 'Grid'], points: ['航路点', 'Waypoints'],
  loading: ['正在导入…', 'Importing…'], failed: ['导入失败。请检查账号、网络，并确认已生成含详细 Navlog 的计划。', 'Import failed. Check your account, connection and a generated plan with a detailed Navlog.'],
  ready: ['导入成功', 'Plan imported'], distance: ['航路距离', 'Route distance'], altitude: ['计划高度', 'Planned altitude'],
  noPosition: ['暂无有效飞机位置', 'No valid aircraft position'], view: ['全球航路', 'Global route'],
  imported: ['导入时间', 'Imported'], close: ['收起面板', 'Close panel'], saved: ['已恢复上次计划', 'Last plan restored'],
  mapError: ['地图加载失败，请刷新页面重试。', 'Map failed to load. Refresh to retry.'],
  privacy: ['只需账号标识，无需密码', 'Account identifier only. No password.'],
  local: ['基础地图 · Natural Earth', 'Base map · Natural Earth'], sample: ['预览示例', 'Preview sample']
};
type Word = keyof typeof words;
function tr(key: Word): string { return words[key][getLocale().startsWith('zh') ? 0 : 1]!; }
const key = 'taxinow.simbrief';
const usernameKey = key + '.username';
let terrainEnabled = true;
try { terrainEnabled = localStorage.getItem('taxinow.terrain') !== 'false'; } catch { /* Use default. */ }
let routeMap: ml.Map | undefined, plan: FlightPlan | undefined;
let ownship: ml.Marker | undefined, lastPosition: TelemetrySnapshot | undefined;
let markers: ml.Marker[] = [], currentTab: 'flight' | 'route' | 'log' = 'flight', globeMode = true;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function store(value: unknown): void { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Session remains usable. */ } }
function feedback(text: string, error = false): void { $('fd-feedback').textContent = text; $('fd-feedback').classList.toggle('error', error); }
function button(text: string, fn: () => void, className = ''): HTMLButtonElement {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.className = className; b.onclick = fn; return b;
}
export function setupFlightDeck(): void {
  document.body.classList.add('flightdeck');
  const flightNumber = document.createElement('strong'); flightNumber.id = 'fd-flight-number';
  $('airport-picker-toggle').prepend(flightNumber);
  const nav = document.createElement('nav'); nav.className = 'fd-tabs'; nav.setAttribute('aria-label', 'Flight navigation');
  for (const tab of ['flight', 'route', 'log'] as const) {
    const b = button(tr(tab), () => { setMode(true); currentTab = tab; $('fd-panel').hidden = false; renderPanel(); });
    b.id = `fd-tab-${tab}`; nav.append(b);
  }
  const title = document.createElement('div'); title.id = 'fd-title'; title.textContent = 'TaxiNow · ' + tr('view'); nav.append(title);
  document.querySelector('header')!.append(nav);
  const rail = document.createElement('nav'); rail.className = 'fd-rail'; rail.setAttribute('aria-label', 'Map views');
  rail.append(button('◎\n' + tr('globe'), () => setMode(true)), button('↗\n' + tr('ground'), () => { setMode(false); $('open-taxi-plan').click(); }));
  rail.children[0]!.id = 'fd-globe-mode'; rail.children[1]!.id = 'fd-ground-mode';
  // Move existing controls so their established handlers and dialogs are retained.
  for (const [id, icon, label] of [['open-assets', '▤', tr('maps')]] as const) {
    const control = $(id);
    control.removeAttribute('data-i18n');
    control.textContent = `${icon}\n${label}`;
    control.setAttribute('aria-label', label);
    control.title = label;
    rail.append(control);
  }
  $('open-taxi-plan').hidden = true;
  const about = $('open-about'), settingsMenu = $('settings-menu');
  about.classList.add('settings-check-row');
  about.setAttribute('role', 'menuitem');
  settingsMenu.append(about);
  about.addEventListener('click', () => {
    settingsMenu.hidden = true;
    $('settings-selector').setAttribute('aria-expanded', 'false');
  });
  document.getElementById('app')!.append(rail);
  const root = document.createElement('section'); root.id = 'fd-root'; root.setAttribute('aria-label', tr('view'));
  root.innerHTML = `<div id="fd-map"></div><aside id="fd-panel"><div class="fd-panel-head"><strong id="fd-panel-title"></strong><button id="fd-close" type="button" aria-label="${tr('close')}">×</button></div><div id="fd-form"><div class="fd-service">SimBrief <span>FLIGHT PLANNING</span></div><button id="fd-import" type="button" class="fd-primary">↓ &nbsp;${tr('import')}</button><p id="fd-feedback" role="status"></p></div><div id="fd-content"></div></aside><div class="fd-map-top"><button id="fd-north" type="button">↑ &nbsp;${tr('north')}</button><button id="fd-projection" type="button">3D</button></div><div class="fd-map-tools"><button id="fd-fit" type="button" title="${tr('fit')}" aria-label="${tr('fit')}">⛶</button><button id="fd-locate" type="button" title="${tr('locate')}" aria-label="${tr('locate')}">⌖</button><button id="fd-grid" type="button" title="${tr('grid')}" aria-label="${tr('grid')}" aria-pressed="true">⊞</button><button id="fd-fir" type="button" title="FIR / ATC boundaries" aria-label="FIR / ATC boundaries" aria-pressed="true">FIR</button><button id="fd-terrain" type="button" title="${tr('terrain')}" aria-label="${tr('terrain')}" aria-pressed="${terrainEnabled}"><svg viewBox="0 0 28 22" width="28" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M2 19 11 3l6 10 3-5 6 11H2Z"/><path d="m8 8 3 3 3-3"/></svg><span>${tr('terrain')}</span></button><button id="fd-plus" type="button" aria-label="Zoom in">+</button><button id="fd-minus" type="button" aria-label="Zoom out">−</button></div><div class="fd-map-bottom"><span>${tr('local')} · <a href="https://github.com/vatsimnetwork/vatspy-data-project" target="_blank" rel="noopener">FIR/ATC: VAT-Spy · CC BY-SA 4.0</a></span><span id="fd-terrain-credit"><a href="https://goto.arcgisonline.com/maps/World_Physical_Map" target="_blank" rel="noopener">Terrain: Esri · U.S. National Park Service</a></span><span id="fd-position">${tr('noPosition')}</span></div><p id="fd-map-error" role="alert" hidden></p></section>`;
  document.getElementById('app')!.append(root);
  $('fd-close').onclick = () => { $('fd-panel').hidden = true; $(`fd-tab-${currentTab}`).focus(); };
  $('fd-import').onclick = () => void importPlan();
  const accountSettings = document.createElement('div'); accountSettings.className = 'fd-account-settings';
  accountSettings.innerHTML = '<strong>SimBrief</strong><label for="fd-identifier">Username</label><input id="fd-identifier" maxlength="100" placeholder="Navigraph Alias" autocomplete="off" spellcheck="false"><small>' + (getLocale().startsWith('zh') ? '自动保存在此浏览器，无需密码。' : 'Saved in this browser. No password required.') + '</small>';
  settingsMenu.prepend(accountSettings);
  $('fd-identifier').addEventListener('input', () => { try { localStorage.setItem(usernameKey, $<HTMLInputElement>('fd-identifier').value.trim()); } catch { /* Keep usable in memory. */ } });
  $('fd-identifier').addEventListener('keydown', e => { if (e.key === 'Enter') { settingsMenu.hidden = true; $('settings-selector').setAttribute('aria-expanded', 'false'); } });
  $('fd-north').onclick = () => routeMap?.easeTo({ bearing: 0, pitch: 0 });
  $('fd-plus').onclick = () => routeMap?.zoomIn(); $('fd-minus').onclick = () => routeMap?.zoomOut();
  $('fd-fit').onclick = fitRoute;
  $('fd-terrain-credit').hidden = !terrainEnabled;
  $('fd-terrain').onclick = () => {
    terrainEnabled = !terrainEnabled;
    $('fd-terrain').setAttribute('aria-pressed', String(terrainEnabled));
    $('fd-terrain-credit').hidden = !terrainEnabled;
    if (routeMap?.getLayer('terrain')) routeMap.setLayoutProperty('terrain', 'visibility', terrainEnabled ? 'visible' : 'none');
    try { localStorage.setItem('taxinow.terrain', String(terrainEnabled)); } catch { /* Keep usable. */ }
    $('fd-map-error').hidden = true;
  };
  $('fd-fir').onclick = () => { if (!routeMap?.getLayer('fir-boundary')) return; const on = $('fd-fir').getAttribute('aria-pressed') !== 'true'; $('fd-fir').setAttribute('aria-pressed', String(on)); for (const layer of ['fir-boundary', 'fir-hit']) routeMap.setLayoutProperty(layer, 'visibility', on ? 'visible' : 'none'); };
  $('fd-locate').onclick = () => { if (validPosition(lastPosition)) routeMap?.easeTo({ center: [lastPosition!.longitude, lastPosition!.latitude], zoom: 5 }); else feedback(tr('noPosition')); };
  $('fd-grid').onclick = () => { if (!routeMap?.getLayer('grid')) return; const on = $('fd-grid').getAttribute('aria-pressed') !== 'true'; $('fd-grid').setAttribute('aria-pressed', String(on)); routeMap.setLayoutProperty('grid', 'visibility', on ? 'visible' : 'none'); };
  $('fd-projection').onclick = () => { globeMode = !globeMode; routeMap?.setProjection({ type: globeMode ? 'globe' : 'mercator' }); $('fd-projection').textContent = globeMode ? '3D' : '2D'; };
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    if (saved.kind !== 'userid' && typeof saved.identifier === 'string') $<HTMLInputElement>('fd-identifier').value = saved.identifier;
    const username = localStorage.getItem(usernameKey); if (username !== null) $<HTMLInputElement>('fd-identifier').value = username;
    if (saved.raw) { plan = parseSimBrief(saved.raw); if (typeof saved.importedAt === 'string' && Number.isFinite(Date.parse(saved.importedAt))) plan.importedAt = saved.importedAt; feedback(tr('saved')); }
  } catch { /* An invalid cached plan does not block startup. */ }
  $('open-taxi-plan').addEventListener('click', () => setMode(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('fd-root').hidden) $('fd-close').click(); });
  new MutationObserver(() => applyGlobeTheme()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  setMode(true); renderPanel();
  window.setInterval(() => { if (!validPosition(lastPosition)) { ownship?.remove(); ownship = undefined; $('fd-position').textContent = tr('noPosition'); } }, 2000);
}
function setMode(globe: boolean): void {
  $('fd-root').hidden = !globe; document.body.dataset.mapView = globe ? 'globe' : 'ground';
  $('fd-globe-mode').setAttribute('aria-current', String(globe)); $('fd-ground-mode').setAttribute('aria-current', String(!globe));
  if (globe) {
    const taxiPanel = $('taxi-plan-panel'); if (taxiPanel) { taxiPanel.classList.remove('open'); taxiPanel.setAttribute('aria-hidden', 'true'); }
    if (!routeMap) createGlobe(); else routeMap.resize();
  } else { const existing = (window as unknown as { taxiNowMap?: ml.Map }).taxiNowMap; requestAnimationFrame(() => existing?.resize()); }
}
async function importPlan(): Promise<void> {
  const control = $<HTMLButtonElement>('fd-import'); if (control.disabled) return;
  const identifier = $<HTMLInputElement>('fd-identifier').value.trim(), kind = 'username';
  if (!identifier) { feedback(getLocale().startsWith('zh') ? '请先在右上角设置中填写 SimBrief Username。' : 'Enter your SimBrief Username in Settings first.', true); $('settings-menu').hidden = false; $('settings-selector').setAttribute('aria-expanded', 'true'); $('fd-identifier').focus(); return; }
  control.disabled = true; control.textContent = tr('loading'); feedback('');
  try {
    const response = await fetch('/api/v1/integrations/simbrief/plan?' + new URLSearchParams({ kind, identifier }), { signal: AbortSignal.timeout(25000) });
    if (!response.ok) throw new Error(response.status === 400 ? (getLocale().startsWith('zh') ? '未找到计划：请核对 Username，并在 SimBrief 生成计划。' : 'Plan unavailable: check Username and generate a plan in SimBrief.') : response.status === 504 ? (getLocale().startsWith('zh') ? 'SimBrief 请求超时，请重试。' : 'SimBrief timed out. Please retry.') : (getLocale().startsWith('zh') ? '无法连接 SimBrief 服务，请稍后重试。' : 'SimBrief service unavailable. Please retry.'));
    const data: unknown = await response.json(), parsed = parseSimBrief(data);
    plan = parsed; store({ identifier, kind, raw: data, importedAt: parsed.importedAt }); renderPanel(); drawRoute(); fitRoute(); feedback(tr('ready'));
  } catch (error) { feedback(error instanceof Error ? (error.name === 'TimeoutError' ? 'SimBrief request timed out.' : error.message === 'Invalid flight plan' || error.message.includes('navlog') ? (getLocale().startsWith('zh') ? '计划缺少详细航路，请启用 Detailed Navlog 后重新生成。' : 'Generate a plan with Detailed Navlog enabled.') : error.message) : tr('failed'), true); }
  finally { control.disabled = false; control.textContent = '↓  ' + tr('import'); }
}
function renderPanel(): void {
  const flightLabel = plan?.callsign || (getLocale().startsWith('zh') ? '未设置航班号' : 'No flight number');
  $('fd-flight-number').textContent = flightLabel;
  $('airport-picker-toggle').setAttribute('aria-label', flightLabel + (getLocale().startsWith('zh') ? '，选择机场' : ', select airport'));
  $('airport-picker-toggle').title = getLocale().startsWith('zh') ? '选择地面地图机场' : 'Select ground map airport';
  for (const tab of ['flight', 'route', 'log']) $(`fd-tab-${tab}`).setAttribute('aria-pressed', String(tab === currentTab));
  $('fd-panel').dataset.tab = currentTab;
  $('fd-panel-title').textContent = tr(currentTab); $('fd-form').hidden = currentTab !== 'flight';
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
    const meta = document.createElement('small'); meta.textContent = currentTab === 'log' ? `${i ? Math.round(distanceNm(plan!.points[i - 1]!.position, p.position)) : 0} NM` : p.airway || (i === 0 ? plan!.origin : i === plan!.points.length - 1 ? plan!.destination : 'DCT');
    row.title = `${p.position[1].toFixed(4)}, ${p.position[0].toFixed(4)}`; row.append(number, name, meta); list.append(row);
  }); content.append(list);
  const actions = document.createElement('div'); actions.className = 'fd-plan-actions';
  actions.append(button(tr('fit'), fitRoute), button(tr('clear'), () => { plan = undefined; store({ identifier: $<HTMLInputElement>('fd-identifier').value, kind: 'username' }); $('fd-title').textContent = 'TaxiNow · ' + tr('view'); renderPanel(); drawRoute(); feedback(''); }));
  const stamp = document.createElement('small'); stamp.textContent = `${tr('imported')} ${new Date(plan.importedAt).toLocaleTimeString()}`; actions.append(stamp); content.append(actions);
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
        route: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
      }, layers: [
        { id: 'ocean', type: 'background', paint: { 'background-color': '#b9cbe2' } },
        { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#e6e9d6' } },
        { id: 'coast', type: 'line', source: 'land', paint: { 'line-color': '#a7b5a3', 'line-width': 0.7 } },
        { id: 'terrain', type: 'raster', source: 'terrain', layout: { visibility: terrainEnabled ? 'visible' : 'none' }, paint: { 'raster-opacity': 0.88, 'raster-saturation': -0.3, 'raster-fade-duration': 200 } },
        { id: 'grid', type: 'line', source: 'grid', paint: { 'line-color': '#83b394', 'line-width': 0.65, 'line-opacity': 0.65 } },
        { id: 'fir-hit', type: 'fill', source: 'fir', paint: { 'fill-opacity': 0 } },
        { id: 'fir-boundary', type: 'line', source: 'fir', paint: { 'line-color': '#516577', 'line-width': 1, 'line-opacity': 0.8 } },
        { id: 'route-casing', type: 'line', source: 'route', filter: ['==', ['get', 'procedure'], false], paint: { 'line-color': '#ffffff', 'line-width': 5.5, 'line-opacity': 0.65 } },
        { id: 'route-line', type: 'line', source: 'route', filter: ['==', ['get', 'procedure'], false], paint: { 'line-color': '#1163d9', 'line-width': 3.5 } },
        { id: 'procedure-casing', type: 'line', source: 'route', filter: ['==', ['get', 'procedure'], true], paint: { 'line-color': '#ffffff', 'line-width': 5.5, 'line-opacity': 0.65, 'line-dasharray': [1.91, 1.27] } },
        { id: 'procedure-line', type: 'line', source: 'route', filter: ['==', ['get', 'procedure'], true], paint: { 'line-color': '#1163d9', 'line-width': 3.5, 'line-dasharray': [3, 2] } }
      ] }
    });
    routeMap.on('click', 'fir-hit', e => { void showFirFrequencies(e); });
    routeMap.on('error', e => { $('fd-map-error').hidden = false; $('fd-map-error').textContent = ('sourceId' in e && e.sourceId === 'terrain') ? (getLocale().startsWith('zh') ? '部分地形未能加载，请检查网络，或关闭地形使用基础地图。' : 'Some terrain tiles could not load. Check your connection or turn off Terrain.') : tr('mapError'); });
    routeMap.once('style.load', () => { applyGlobeTheme(); drawRoute(); if (plan) fitRoute(); });
  } catch { $('fd-map-error').hidden = false; $('fd-map-error').textContent = tr('mapError'); }
}
function applyGlobeTheme(): void {
  if (!routeMap?.getLayer('land')) return;
  const dark = document.documentElement.dataset.theme === 'dark';
  if (routeMap.getLayer('terrain')) routeMap.setPaintProperty('terrain', 'raster-brightness-max', dark ? 0.55 : 1);
  routeMap.setPaintProperty('ocean', 'background-color', dark ? '#293e53' : '#b9cbe2');
  routeMap.setPaintProperty('land', 'fill-color', dark ? '#566364' : '#e6e9d6');
  routeMap.setPaintProperty('coast', 'line-color', dark ? '#849995' : '#a7b5a3');
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
export function updateFlightDeckPosition(sample: TelemetrySnapshot): void {
  lastPosition = sample;
  if (!routeMap || !validPosition(sample)) { ownship?.remove(); ownship = undefined; if ($('fd-position')) $('fd-position').textContent = tr('noPosition'); return; }
  if (!ownship) { const el = document.createElement('div'); el.className = 'fd-ownship'; el.textContent = '▲'; ownship = new ml.Marker({ element: el, rotationAlignment: 'map' }).setLngLat([sample.longitude, sample.latitude]).addTo(routeMap); }
  ownship.setLngLat([sample.longitude, sample.latitude]).setRotation(sample.trueHeadingDegrees);
  $('fd-position').textContent = `${Math.round(sample.trueHeadingDegrees)}°  ·  ${Math.round(sample.groundSpeedKnots)} KT`;
}




let firMappings: Promise<FirCallsign[]> | undefined;
async function showFirFrequencies(e: ml.MapLayerMouseEvent): Promise<void> {
  if (!routeMap) return;
  const zh = getLocale().startsWith('zh');
  const areas = [...new Map((e.features || []).map(f => [String(f.properties?.id), String(f.properties?.name || f.properties?.id)])).entries()];
  if (!areas.length) return;
  const content = document.createElement('div'); content.className = 'fd-fir-popup';
  const title = document.createElement('strong'); title.textContent = zh ? 'VATSIM 在线区域管制' : 'VATSIM online area control';
  const body = document.createElement('div');
  const popup = new ml.Popup({ maxWidth: '360px' }).setLngLat(e.lngLat).setDOMContent(content).addTo(routeMap);
  const refresh = button(zh ? '刷新频率' : 'Refresh frequencies', () => void load());
  content.append(title, body, refresh);
  async function load(): Promise<void> {
    refresh.disabled = true; body.textContent = zh ? '正在获取在线频率…' : 'Loading online frequencies…';
    try {
      firMappings ??= fetch('/fir-callsigns.json').then(r => { if (!r.ok) throw new Error(); return r.json() as Promise<FirCallsign[]>; }).catch(error => { firMappings = undefined; throw error; });
      const [mappings, response] = await Promise.all([firMappings, fetch('/api/v1/integrations/vatsim/controllers', { signal: AbortSignal.timeout(15000) })]);
      if (!response.ok) throw new Error();
      const feed = await response.json() as { controllers: Controller[]; isStale: boolean; feedUpdatedAtUtc: string };
      if (!popup.isOpen()) return;
      body.replaceChildren();
      if (feed.isStale) { body.textContent = zh ? '在线数据已过期，请刷新后查看频率。' : 'Online data is stale. Refresh to see current frequencies.'; return; }
      for (const [id, name] of areas) {
        const section = document.createElement('section'); const heading = document.createElement('h4'); heading.textContent = name; section.append(heading);
        const matches = controllersForFir(id, feed.controllers, mappings);
        if (!matches.length) { const empty = document.createElement('p'); empty.textContent = zh ? '暂无匹配的在线区域管制席位' : 'No matching area controller online'; section.append(empty); }
        for (const station of matches) { const row = document.createElement('p'); row.textContent = station.callsign + ' · ' + station.frequency + ' MHz'; section.append(row); }
        body.append(section);
      }
      const updated = document.createElement('small'); updated.textContent = (zh ? '数据更新：' : 'Feed updated: ') + new Date(feed.feedUpdatedAtUtc).toLocaleTimeString(); body.append(updated);
    } catch { if (popup.isOpen()) body.textContent = zh ? '频率获取失败，请重试。' : 'Could not load frequencies. Please retry.'; }
    finally { refresh.disabled = false; }
  }
  await load();
}

function renderFlightOverview(content: HTMLElement): void {
  if (!plan) return;
  const current = plan, zh = getLocale().startsWith('zh');
  const card = document.createElement('div'); card.className = 'fd-flight-card';
  for (const [code, name, label, position] of [
    [current.origin, current.originName, zh ? '出发' : 'FROM', current.points[0]!.position],
    [current.destination, current.destinationName, zh ? '到达' : 'TO', current.points.at(-1)!.position]
  ] as const) {
    const row = button('', () => routeMap?.easeTo({ center: position, zoom: 6 }), 'fd-airport-row');
    const badge = document.createElement('strong'); badge.textContent = code;
    const fullName = document.createElement('span'); fullName.textContent = name; fullName.title = name;
    const caption = document.createElement('small'); caption.textContent = label;
    row.append(badge, fullName, caption); card.append(row);
  }
  const route = document.createElement('section'); route.className = 'fd-route-chips-section';
  const caption = document.createElement('div'); caption.className = 'fd-section-label'; caption.textContent = zh ? '航路点与航路' : 'WAYPOINTS & AIRWAYS'; route.append(caption);
  const chips = document.createElement('div'); chips.className = 'fd-route-chips';
  let lastAirway = '';
  current.points.slice(1, -1).forEach(point => {
    if (point.airway && point.airway !== lastAirway) { const airway = document.createElement('span'); airway.className = 'fd-airway-chip'; airway.textContent = point.airway; chips.append(airway); lastAirway = point.airway; }
    const chip = button(point.ident, () => { routeMap?.easeTo({ center: point.position, zoom: 6 }); chips.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', 'false')); chip.setAttribute('aria-pressed', 'true'); }, 'fd-route-chip');
    chip.title = zh ? '在地图上查看 ' + point.ident : 'Locate ' + point.ident; chip.setAttribute('aria-pressed', 'false'); chips.append(chip);
  });
  if (current.points.length === 2) { const direct = document.createElement('span'); direct.className = 'fd-airway-chip'; direct.textContent = 'DCT'; chips.append(direct); }
  route.append(chips); card.append(route);
  const distance = document.createElement('div'); distance.className = 'fd-flight-distance';
  const metric = document.createElement('div'); const label = document.createElement('small'); label.textContent = tr('distance'); const value = document.createElement('strong'); value.textContent = Math.round(current.distance).toLocaleString() + ' NM'; metric.append(label, value);
  distance.append(metric, button(tr('fit'), fitRoute)); card.append(distance); content.append(card);
  const details = document.createElement('div'); details.className = 'fd-flight-details';
  for (const [label, value] of [[zh ? '机型' : 'Aircraft', current.aircraft || '—'], [tr('altitude'), current.altitude ? current.altitude + ' FT' : '—']]) { const row = document.createElement('div'); const caption = document.createElement('span'); caption.textContent = label!; const text = document.createElement('strong'); text.textContent = value!; row.append(caption, text); details.append(row); }
  content.append(details);
  const actions = document.createElement('div'); actions.className = 'fd-plan-actions';
  const stamp = document.createElement('small'); stamp.textContent = tr('imported') + ' ' + new Date(current.importedAt).toLocaleTimeString();
  actions.append(stamp, button(tr('clear'), () => { plan = undefined; store({ identifier: $<HTMLInputElement>('fd-identifier').value, kind: 'username' }); $('fd-title').textContent = 'TaxiNow · ' + tr('view'); renderPanel(); drawRoute(); feedback(''); })); content.append(actions);
}
