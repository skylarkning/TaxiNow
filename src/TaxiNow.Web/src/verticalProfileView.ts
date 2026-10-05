import { t } from './localization';
const tr = (key: string, values?: Record<string, string | number>) => t('flightdeck.' + key, values);
import type { VerticalProfileConstraint, VerticalProfileModel } from './verticalProfile';
import { classifyVerticalProfilePoints, layoutVerticalProfileLabels } from './verticalProfileLabels';
import {
  drawVerticalProfile,
  verticalProfileBounds,
  type VerticalProfilePalette
} from './verticalProfileRenderer';
import {
  createProfileViewport,
  profileXToDistance,
  type ProfileViewport
} from './verticalProfileViewport';

export interface VerticalProfileViewState {
  status: 'ready' | 'loading' | 'empty' | 'error';
  message?: string;
}

export interface VerticalProfileView {
  render(model: VerticalProfileModel | null, state?: VerticalProfileViewState): void;
  setOpen(open: boolean): void;
  resize(): void;
  destroy(): void;
}

const simulationNotice = () => tr('simulationNotice');
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
const identifier = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 24);
const feet = (value: number | null | undefined) => finite(value) ? `${Math.round(value).toLocaleString('en-US')} ft` : tr('unavailable');

export function profilePanelHeight(hostHeight: number, _mobile: boolean): number {
  return finite(hostHeight) ? Math.max(0, hostHeight) : 0;
}

export function selectWaypointLabelIndexes(count: number, maximum: number): number[] {
  if (!finite(count) || !finite(maximum)) return [];
  const length = Math.max(0, Math.floor(count));
  const slots = clamp(Math.floor(maximum), 0, length);
  if (!slots) return [];
  if (slots === 1) return [0];
  return Array.from({ length: slots }, (_, index) => Math.round(index * (length - 1) / (slots - 1)));
}

function restrictionLabel(constraint: VerticalProfileConstraint | null | undefined): string {
  if (!constraint) return tr('noRestriction');
  switch (constraint.kind) {
    case 'at': return tr('at', { altitude: feet(constraint.minimumAltitudeFeet ?? constraint.maximumAltitudeFeet) });
    case 'atOrAbove': return tr('above', { altitude: feet(constraint.minimumAltitudeFeet) });
    case 'atOrBelow': return tr('below', { altitude: feet(constraint.maximumAltitudeFeet) });
    case 'between': return tr('between', { minimum: feet(constraint.minimumAltitudeFeet), maximum: feet(constraint.maximumAltitudeFeet) });
  }
}

function statusMessage(model: VerticalProfileModel | null, state: VerticalProfileViewState): string {
  if (state.message) return state.message.slice(0, 240);
  if (state.status === 'loading') return tr('profileLoading');
  if (state.status === 'error') return tr('profileError');
  if (!model || state.status === 'empty') return tr('profileEmpty');
  return model.terrain.length ? '' : tr('profileNoTerrain');
}

export function verticalProfileSummary(
  model: VerticalProfileModel | null,
  state: VerticalProfileViewState = { status: model ? 'ready' : 'empty' }
): string {
  if (!model) return `${statusMessage(model, state)} ${simulationNotice()}`;
  const altitude = finite(model.aircraft?.altitudeMslFeet)
    ? tr('liveAltitude', { altitude: feet(model.aircraft.altitudeMslFeet) })
    : tr('liveUnavailable');
  const terrain = model.terrain.length
    ? `${tr('terrainSource', { name: model.source.name })} ${model.source.cacheState === 'cachedOffline' ? tr('cachedTerrain') : tr('freshTerrain')}`
    : tr('terrainUnavailable');
  const stateText = state.status === 'ready' ? '' : ` ${statusMessage(model, state)}`;
  return `${tr('profileRoute', { origin: identifier(model.origin), destination: identifier(model.destination) })} ${altitude} ${terrain}${stateText} ${simulationNotice()}`;
}

export interface ProfileInspection {
  index: number;
  distanceNm: number;
  label: string;
}

function plannedAltitudeAt(model: VerticalProfileModel, distance: number): number | null {
  const path = model.altitudePath;
  if (!path.length) return null;
  if (distance <= path[0]!.distanceNm) return path[0]!.altitudeFeet;
  for (let index = 1; index < path.length; index++) {
    const previous = path[index - 1]!, next = path[index]!;
    if (distance > next.distanceNm) continue;
    const span = next.distanceNm - previous.distanceNm;
    const fraction = span > 0 ? (distance - previous.distanceNm) / span : 0;
    return previous.altitudeFeet + fraction * (next.altitudeFeet - previous.altitudeFeet);
  }
  return path.at(-1)!.altitudeFeet;
}

export function profileInspection(model: VerticalProfileModel, requestedIndex: number): ProfileInspection | null {
  const samples = model.terrain.length ? model.terrain : model.altitudePath;
  if (!samples.length) return null;
  const index = clamp(finite(requestedIndex) ? Math.round(requestedIndex) : 0, 0, samples.length - 1);
  const sample = samples[index]!;
  const waypoint = model.routePoints.reduce<typeof model.routePoints[number] | undefined>((nearest, point) =>
    !nearest || Math.abs(point.distanceNm - sample.distanceNm) < Math.abs(nearest.distanceNm - sample.distanceNm) ? point : nearest, undefined);
  const restriction = model.constraints.find(item => item.waypointIndex === waypoint?.waypointIndex);
  const terrain = 'elevationFeet' in sample ? `${tr('terrain')} ${feet(sample.elevationFeet)}` : tr('terrainUnavailable');
  // Terrain reference altitude may be live MSL for clearance colouring; inspect the plotted path instead.
  const planned = plannedAltitudeAt(model, sample.distanceNm);
  return {
    index, distanceNm: sample.distanceNm,
    label: `${sample.distanceNm.toFixed(1)} NM · ${tr('nearest')} ${identifier(waypoint?.ident ?? tr('unavailable'))} · ${terrain} · ${tr('planned')} ${feet(planned)} · ${restrictionLabel(restriction)}`
  };
}

export function createVerticalProfileView(host: HTMLElement): VerticalProfileView {
  const document = host.ownerDocument;
  const window = document.defaultView;
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, id: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag); node.id = id;
    if (text) node.textContent = text;
    return node;
  };
  const panel = element('section', 'fd-vertical-profile');
  panel.setAttribute('aria-label', tr('profileAria'));
  const header = element('div', 'fd-profile-header');
  const title = element('strong', 'fd-profile-title', tr('profileTitle'));
  const metrics = element('dl', 'fd-profile-metrics');
  const metricValues: HTMLElement[] = [];
  for (const [index, name] of ['MSL', 'AGL', tr('clearance'), tr('nextRestriction'), tr('remaining'), tr('terrain')].entries()) {
    const group = element('div', `fd-profile-metric-${index}`);
    const value = element('dd', `fd-profile-value-${index}`, '—');
    group.append(element('dt', `fd-profile-label-${index}`, name), value);
    metrics.append(group); metricValues.push(value);
  }
  const close = element('button', 'fd-profile-close', '×');
  close.type = 'button'; close.setAttribute('aria-label', tr('profileClose'));
  header.append(title, metrics, close);
  const plot = element('div', 'fd-profile-plot');
  const canvas = element('canvas', 'fd-profile-canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', tr('profileKeyboard'));
  canvas.setAttribute('aria-describedby', 'fd-profile-summary fd-profile-tooltip');
  canvas.textContent = tr('profileFallback');
  const status = element('p', 'fd-profile-status'); status.setAttribute('role', 'status');
  const retry = element('button', 'fd-profile-retry', tr('retry')); retry.type = 'button'; retry.hidden = true;
  const overlay = element('div', 'fd-profile-overlay'); overlay.append(status, retry);
  const tooltip = element('div', 'fd-profile-tooltip'); tooltip.hidden = true;
  tooltip.setAttribute('role', 'status'); tooltip.setAttribute('aria-live', 'polite'); tooltip.setAttribute('aria-atomic', 'true');
  plot.append(canvas, overlay, tooltip);
  const footer = element('div', 'fd-profile-footer');
  const attribution = element('span', 'fd-profile-attribution');
  footer.append(attribution, element('span', 'fd-profile-notice', tr('profileLegend')));
  const summary = element('p', 'fd-profile-summary'); summary.className = 'fd-profile-sr-only';
  summary.setAttribute('aria-live', 'polite'); summary.setAttribute('aria-atomic', 'true');
  panel.append(header, plot, footer, summary); host.append(panel);

  let model: VerticalProfileModel | null = null;
  let viewport: ProfileViewport | null = null;
  let viewportRouteKey = '';
  let state: VerticalProfileViewState = { status: 'empty' };
  let open = !(window?.matchMedia?.('(max-width: 620px)').matches ?? false);
  let destroyed = false, dirty = true, selectedIndex = 0;
  let previousFocus: HTMLElement | null = null;
  let lastWidth = 0, lastHeight = 0, lastDpr = 0, lastPalette = '';
  let context: CanvasRenderingContext2D | null = null;
  try { context = canvas.getContext('2d'); } catch { /* Text and controls still work when canvas is unavailable. */ }
  const listeners: Array<() => void> = [];
  function listen(target: EventTarget, type: string, handler: EventListener) {
    target.addEventListener(type, handler); listeners.push(() => target.removeEventListener(type, handler));
  }
  function emit(type: string, detail?: { open: boolean }) {
    const EventClass = window?.CustomEvent ?? CustomEvent;
    panel.dispatchEvent(new EventClass(type, { bubbles: true, detail }));
  }
  function inspect(index: number) {
    const point = model && profileInspection(model, index);
    tooltip.hidden = !point;
    if (!point) return;
    selectedIndex = point.index;
    if (tooltip.textContent !== point.label) tooltip.textContent = point.label;
  }
  function resize() {
    if (destroyed) return;
    const mobile = window?.matchMedia?.('(max-width: 620px)').matches ?? false;
    const panelHeight = open ? profilePanelHeight(host.getBoundingClientRect().height, mobile) : 0;
    host.style.setProperty('--fd-profile-height', `${panelHeight}px`);
    if (!open || !context) return;
    const bounds = canvas.getBoundingClientRect();
    const width = Math.round(bounds.width), height = Math.round(bounds.height);
    if (width <= 0 || height <= 0) return;
    const dpr = Math.max(1, window?.devicePixelRatio ?? 1);
    const style = window?.getComputedStyle(panel);
    const color = (name: string, fallback: string) => style?.getPropertyValue(name).trim() || fallback;
    const palette: VerticalProfilePalette = {
      background: color('--fd-profile-background', '#071826'), text: color('--fd-profile-text', '#e9f6ff'),
      muted: color('--fd-profile-muted', '#9bb7c8'), grid: color('--fd-profile-grid', '#28495c'),
      terrain: color('--fd-profile-terrain', '#335966'), terrainStroke: color('--fd-profile-terrain-stroke', '#6f9ca8'),
      route: color('--fd-profile-route', '#42c7ff'), amber: color('--fd-profile-amber', '#ffc857'),
      red: color('--fd-profile-red', '#ff6961'), aircraft: color('--fd-profile-aircraft', '#7ef0b8'),
      weatherWeak: color('--fd-profile-weather-weak', '#35c96f'),
      weatherModerate: color('--fd-profile-weather-moderate', '#f2cf3a'),
      weatherStrong: color('--fd-profile-weather-strong', '#ef5350'),
      font: style?.fontFamily || 'sans-serif'
    };
    const paletteKey = JSON.stringify(palette);
    if (!dirty && width === lastWidth && height === lastHeight && dpr === lastDpr && paletteKey === lastPalette) return;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (model) {
      viewport ??= createProfileViewport(model.totalDistanceNm, model.aircraft?.distanceNm);
      const bounds = verticalProfileBounds(width, height);
      const labels = layoutVerticalProfileLabels(
        classifyVerticalProfilePoints(model),
        viewport,
        bounds.right - bounds.left,
        text => context!.measureText(identifier(text)).width);
      drawVerticalProfile(context, model, viewport, bounds, palette, labels);
    }
    else context.clearRect(0, 0, width, height);
    lastWidth = width; lastHeight = height; lastDpr = dpr; lastPalette = paletteKey; dirty = false;
  }
  function setOpen(next: boolean) {
    if (destroyed) return;
    const changed = next !== open;
    if (next && changed) previousFocus = document.activeElement as HTMLElement | null;
    open = next; panel.hidden = !open; host.dataset.profileOpen = String(open);
    if (!open) {
      tooltip.hidden = true;
      if (panel.contains(document.activeElement)) previousFocus?.focus();
    }
    resize();
    if (changed) emit('vertical-profile-open-change', { open });
  }
  function render(next: VerticalProfileModel | null, nextState?: VerticalProfileViewState) {
    if (destroyed) return;
    dirty ||= model !== next;
    const nextRouteKey = next
      ? JSON.stringify([next.totalDistanceNm, next.routePoints.map(point => [point.position[0], point.position[1]])])
      : '';
    if (nextRouteKey !== viewportRouteKey) {
      viewport = next ? createProfileViewport(next.totalDistanceNm, next.aircraft?.distanceNm) : null;
      viewportRouteKey = nextRouteKey;
    }
    model = next; state = nextState ?? { status: next ? 'ready' : 'empty' };
    const message = statusMessage(model, state);
    status.textContent = message; overlay.hidden = !message;
    panel.dataset.status = state.status;
    panel.setAttribute('aria-busy', String(state.status === 'loading'));
    retry.hidden = state.status !== 'error';
    const text = verticalProfileSummary(model, state);
    if (summary.textContent !== text) summary.textContent = text;
    title.textContent = model ? `${identifier(model.origin)} → ${identifier(model.destination)}` : tr('profileTitle');
    attribution.textContent = model ? `${model.source.name} · ${model.source.attribution}` : tr('terrainUnavailable');
    const values = model ? [
      feet(model.metrics.currentAltitudeFeet), feet(model.metrics.currentAglFeet), feet(model.metrics.terrainClearanceFeet),
      model.metrics.nextRestriction ? `${identifier(model.metrics.nextRestriction.ident)} · ${restrictionLabel(model.metrics.nextRestriction)}` : tr('none'),
      `${model.metrics.distanceRemainingNm.toFixed(1)} NM`, model.terrain.length ? `${model.source.name} · ${tr(model.source.cacheState === 'cachedOffline' ? 'offline' : 'fresh')}` : tr('unavailable')
    ] : ['—', '—', '—', '—', '—', tr('unavailable')];
    metricValues.forEach((value, index) => { value.textContent = values[index]!; });
    if (!tooltip.hidden) inspect(selectedIndex);
    resize();
  }
  listen(close, 'click', () => setOpen(false));
  listen(retry, 'click', () => emit('vertical-profile-retry'));
  listen(panel, 'keydown', event => {
    const key = (event as KeyboardEvent).key;
    if (key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); }
    else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      event.preventDefault(); inspect(selectedIndex + (key === 'ArrowRight' ? 1 : -1));
    }
  });
  listen(canvas, 'focus', () => inspect(selectedIndex));
  listen(canvas, 'blur', () => { tooltip.hidden = true; });
  listen(canvas, 'pointermove', event => {
    if (!model || !viewport) return;
    const bounds = canvas.getBoundingClientRect();
    const plotBounds = verticalProfileBounds(bounds.width, bounds.height);
    const plotX = clamp(
      (event as PointerEvent).clientX - bounds.left - plotBounds.left,
      0,
      plotBounds.right - plotBounds.left);
    const distance = profileXToDistance(
      plotX,
      viewport,
      plotBounds.right - plotBounds.left);
    const samples = model.terrain.length ? model.terrain : model.altitudePath;
    let index = 0;
    for (let candidate = 1; candidate < samples.length; candidate++) {
      if (Math.abs(samples[candidate]!.distanceNm - distance) < Math.abs(samples[index]!.distanceNm - distance)) index = candidate;
    }
    inspect(index);
  });
  listen(canvas, 'pointerleave', () => { if (document.activeElement !== canvas) tooltip.hidden = true; });
  if (window) listen(window, 'resize', resize);
  const resizeObserver = window?.ResizeObserver ? new window.ResizeObserver(resize) : null;
  resizeObserver?.observe(host); resizeObserver?.observe(canvas);
  const themeObserver = window?.MutationObserver ? new window.MutationObserver(resize) : null;
  themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
  themeObserver?.observe(document.body, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
  panel.hidden = !open; host.dataset.profileOpen = String(open);
  render(null);
  return {
    render, setOpen, resize,
    destroy() {
      if (destroyed) return;
      setOpen(false); destroyed = true;
      resizeObserver?.disconnect(); themeObserver?.disconnect();
      listeners.forEach(remove => remove()); panel.remove();
      host.style.removeProperty('--fd-profile-height');
      model = null; viewport = null; context = null;
    }
  };
}
