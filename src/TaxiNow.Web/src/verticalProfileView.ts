import type { VerticalProfileConstraint, VerticalProfileModel } from './verticalProfile';

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

const simulationNotice = 'Terrain colours are a simulation advisory only.';
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
const identifier = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 24);
const feet = (value: number | null | undefined) => finite(value) ? `${Math.round(value).toLocaleString('en-US')} ft` : 'Unavailable';

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
  if (!constraint) return 'No restriction';
  switch (constraint.kind) {
    case 'at': return `At ${feet(constraint.minimumAltitudeFeet ?? constraint.maximumAltitudeFeet)}`;
    case 'atOrAbove': return `At or above ${feet(constraint.minimumAltitudeFeet)}`;
    case 'atOrBelow': return `At or below ${feet(constraint.maximumAltitudeFeet)}`;
    case 'between': return `Between ${feet(constraint.minimumAltitudeFeet)} and ${feet(constraint.maximumAltitudeFeet)}`;
  }
}

function statusMessage(model: VerticalProfileModel | null, state: VerticalProfileViewState): string {
  if (state.message) return state.message.slice(0, 240);
  if (state.status === 'loading') return 'Loading terrain profile…';
  if (state.status === 'error') return 'Terrain unavailable. Try again.';
  if (!model || state.status === 'empty') return 'Import a flight plan to see the vertical profile.';
  return model.terrain.length ? '' : 'Terrain unavailable. Planned profile remains visible.';
}

export function verticalProfileSummary(
  model: VerticalProfileModel | null,
  state: VerticalProfileViewState = { status: model ? 'ready' : 'empty' }
): string {
  if (!model) return `${statusMessage(model, state)} ${simulationNotice}`;
  const altitude = finite(model.aircraft?.altitudeMslFeet)
    ? `Live aircraft altitude ${feet(model.aircraft.altitudeMslFeet)} MSL.`
    : 'Live aircraft altitude unavailable.';
  const terrain = model.terrain.length
    ? `Terrain source ${model.source.name}. ${model.source.cacheState === 'cachedOffline' ? 'Cached offline terrain.' : 'Fresh terrain profile.'}`
    : 'Terrain unavailable.';
  const stateText = state.status === 'ready' ? '' : ` ${statusMessage(model, state)}`;
  return `${identifier(model.origin)} to ${identifier(model.destination)} vertical profile. ${altitude} ${terrain}${stateText} ${simulationNotice}`;
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
  const terrain = 'elevationFeet' in sample ? `Terrain ${feet(sample.elevationFeet)}` : 'Terrain unavailable';
  // Terrain reference altitude may be live MSL for clearance colouring; inspect the plotted path instead.
  const planned = plannedAltitudeAt(model, sample.distanceNm);
  return {
    index, distanceNm: sample.distanceNm,
    label: `${sample.distanceNm.toFixed(1)} NM · Nearest waypoint ${identifier(waypoint?.ident ?? 'Unavailable')} · ${terrain} · Planned ${feet(planned)} · ${restrictionLabel(restriction)}`
  };
}

interface Palette {
  background: string; text: string; muted: string; grid: string;
  terrain: string; terrainStroke: string; route: string; amber: string; red: string; aircraft: string; font: string;
}

function drawProfile(context: CanvasRenderingContext2D, model: VerticalProfileModel, width: number, height: number, palette: Palette): void {
  const left = Math.min(54, width * 0.2), right = Math.max(left + 1, width - 22);
  const top = 22, bottom = Math.max(top + 1, height - 33);
  const distance = Math.max(1, model.totalDistanceNm);
  const altitudes = [...model.altitudePath.map(point => point.altitudeFeet), ...model.terrain.map(point => point.elevationFeet),
    ...model.constraints.flatMap(point => [point.minimumAltitudeFeet, point.maximumAltitudeFeet]), model.aircraft?.altitudeMslFeet].filter(finite);
  const lower = Math.floor(Math.min(0, ...altitudes) / 1000) * 1000;
  const upper = Math.ceil(Math.max(3000, ...altitudes) * 1.12 / 1000) * 1000;
  const x = (value: number) => left + clamp(value / distance, 0, 1) * (right - left);
  const y = (value: number) => bottom - clamp((value - lower) / (upper - lower), 0, 1) * (bottom - top);
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke();
  };
  const label = (text: string, atX: number, atY: number, maximum = right - left) => {
    const measured = Math.min(context.measureText(text).width, maximum);
    context.fillText(text, clamp(atX - measured / 2, 2, Math.max(2, width - measured - 2)), clamp(atY, 10, height - 2), maximum);
  };
  context.clearRect(0, 0, width, height);
  context.fillStyle = palette.background;
  context.fillRect(0, 0, width, height);
  context.font = `10px ${palette.font}`;
  context.lineWidth = 1;
  context.strokeStyle = palette.grid;
  context.fillStyle = palette.muted;
  for (let tick = 0; tick <= 4; tick++) {
    const altitude = lower + (upper - lower) * tick / 4;
    line(left, y(altitude), right, y(altitude));
    context.fillText(`${Math.round(altitude / 1000)}k`, 6, y(altitude) + 3);
  }
  context.fillText('FT MSL', 6, 11);
  const horizontalTicks = Math.max(2, Math.min(8, Math.floor((right - left) / 85)));
  for (let tick = 0; tick <= horizontalTicks; tick++) {
    const value = distance * tick / horizontalTicks;
    line(x(value), top, x(value), bottom);
    label(`${Math.round(value)}`, x(value), height - 4, 42);
  }
  context.fillText('NM', Math.max(2, width - 19), height - 4);

  // Clip functional data to the plot while keeping tick and waypoint labels readable.
  context.save(); context.beginPath(); context.rect(left, top, right - left, bottom - top); context.clip();
  if (model.terrain.length) {
    context.beginPath(); context.moveTo(x(model.terrain[0]!.distanceNm), bottom);
    for (const point of model.terrain) context.lineTo(x(point.distanceNm), y(point.elevationFeet));
    context.lineTo(x(model.terrain.at(-1)!.distanceNm), bottom); context.closePath();
    context.fillStyle = palette.terrain; context.fill();
    for (let index = 1; index < model.terrain.length; index++) {
      const previous = model.terrain[index - 1]!, point = model.terrain[index]!;
      if (point.clearanceBand === 'normal') continue;
      context.beginPath(); context.moveTo(x(previous.distanceNm), bottom);
      context.lineTo(x(previous.distanceNm), y(previous.elevationFeet));
      context.lineTo(x(point.distanceNm), y(point.elevationFeet)); context.lineTo(x(point.distanceNm), bottom); context.closePath();
      context.fillStyle = point.clearanceBand === 'red' ? palette.red : palette.amber; context.fill();
    }
    context.beginPath();
    context.moveTo(x(model.terrain[0]!.distanceNm), y(model.terrain[0]!.elevationFeet));
    for (const point of model.terrain.slice(1)) context.lineTo(x(point.distanceNm), y(point.elevationFeet));
    context.strokeStyle = palette.terrainStroke;
    context.lineWidth = 2;
    context.stroke();
  }
  context.strokeStyle = palette.route; context.lineWidth = 1.5;
  for (let index = 1; index < model.altitudePath.length; index++) {
    const previous = model.altitudePath[index - 1]!, point = model.altitudePath[index]!;
    context.setLineDash(point.estimated || previous.estimated ? [5, 3] : []);
    line(x(previous.distanceNm), y(previous.altitudeFeet), x(point.distanceNm), y(point.altitudeFeet));
  }
  context.setLineDash([]);
  context.strokeStyle = palette.text; context.lineWidth = 1;
  for (const restriction of model.constraints) {
    const atX = x(restriction.distanceNm);
    const bar = (altitude: number | undefined, direction: number) => {
      if (!finite(altitude)) return;
      const atY = y(altitude);
      line(atX - 5, atY, atX + 5, atY);
      if (direction) { line(atX - 5, atY, atX - 5, atY + direction * 5); line(atX + 5, atY, atX + 5, atY + direction * 5); }
    };
    if (restriction.kind === 'at') bar(restriction.minimumAltitudeFeet ?? restriction.maximumAltitudeFeet, 0);
    else { bar(restriction.minimumAltitudeFeet, -1); bar(restriction.maximumAltitudeFeet, 1); }
  }
  context.restore();
  context.fillStyle = palette.text;
  for (const point of [model.routePoints[0], model.routePoints.at(-1)]) {
    if (!point) continue;
    context.fillRect(x(point.distanceNm) - 3, bottom - 3, 6, 6);
  }
  const indexes = selectWaypointLabelIndexes(model.routePoints.length, Math.min(8, Math.max(2, Math.floor((right - left) / 90))));
  let labelEnd = -Infinity;
  for (const index of indexes) {
    const point = model.routePoints[index]!;
    const text = identifier(point.ident).slice(0, 12);
    const labelWidth = Math.min(context.measureText(text).width, 82);
    const start = clamp(x(point.distanceNm) - labelWidth / 2, 2, width - labelWidth - 2);
    if (start < labelEnd + 6 && index !== model.routePoints.length - 1) continue;
    label(text, x(point.distanceNm), index === model.routePoints.length - 1 && start < labelEnd + 6 ? top + 12 : top - 7, 82);
    labelEnd = start + labelWidth;
  }
  if (model.aircraft && finite(model.aircraft.altitudeMslFeet)) {
    const atX = x(model.aircraft.distanceNm), atY = y(model.aircraft.altitudeMslFeet);
    context.fillStyle = palette.aircraft;
    context.beginPath(); context.moveTo(atX, atY - 6); context.lineTo(atX + 5, atY + 5);
    context.lineTo(atX, atY + 2); context.lineTo(atX - 5, atY + 5); context.closePath(); context.fill();
  }
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
  panel.setAttribute('aria-label', 'Vertical situation profile');
  const header = element('div', 'fd-profile-header');
  const title = element('strong', 'fd-profile-title', 'Vertical profile');
  const metrics = element('dl', 'fd-profile-metrics');
  const metricValues: HTMLElement[] = [];
  for (const [index, name] of ['MSL', 'AGL', 'Clearance', 'Next restriction', 'Remaining', 'Terrain'].entries()) {
    const group = element('div', `fd-profile-metric-${index}`);
    const value = element('dd', `fd-profile-value-${index}`, '—');
    group.append(element('dt', `fd-profile-label-${index}`, name), value);
    metrics.append(group); metricValues.push(value);
  }
  const close = element('button', 'fd-profile-close', '×');
  close.type = 'button'; close.setAttribute('aria-label', 'Close vertical profile');
  header.append(title, metrics, close);
  const plot = element('div', 'fd-profile-plot');
  const canvas = element('canvas', 'fd-profile-canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Route altitude and terrain profile. Use Left and Right arrows to inspect samples; Escape to close.');
  canvas.setAttribute('aria-describedby', 'fd-profile-summary fd-profile-tooltip');
  canvas.textContent = 'Route altitude and terrain profile. A text summary is available below.';
  const status = element('p', 'fd-profile-status'); status.setAttribute('role', 'status');
  const retry = element('button', 'fd-profile-retry', 'Retry'); retry.type = 'button'; retry.hidden = true;
  const overlay = element('div', 'fd-profile-overlay'); overlay.append(status, retry);
  const tooltip = element('div', 'fd-profile-tooltip'); tooltip.hidden = true;
  tooltip.setAttribute('role', 'status'); tooltip.setAttribute('aria-live', 'polite'); tooltip.setAttribute('aria-atomic', 'true');
  plot.append(canvas, overlay, tooltip);
  const footer = element('div', 'fd-profile-footer');
  const attribution = element('span', 'fd-profile-attribution');
  footer.append(attribution, element('span', 'fd-profile-notice', 'Simulation only · Dashed: estimated · Amber/red: terrain clearance'));
  const summary = element('p', 'fd-profile-summary'); summary.className = 'fd-profile-sr-only';
  summary.setAttribute('aria-live', 'polite'); summary.setAttribute('aria-atomic', 'true');
  panel.append(header, plot, footer, summary); host.append(panel);

  let model: VerticalProfileModel | null = null;
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
    const palette: Palette = {
      background: color('--fd-profile-background', '#071826'), text: color('--fd-profile-text', '#e9f6ff'),
      muted: color('--fd-profile-muted', '#9bb7c8'), grid: color('--fd-profile-grid', '#28495c'),
      terrain: color('--fd-profile-terrain', '#335966'), terrainStroke: color('--fd-profile-terrain-stroke', '#6f9ca8'),
      route: color('--fd-profile-route', '#42c7ff'), amber: color('--fd-profile-amber', '#ffc857'),
      red: color('--fd-profile-red', '#ff6961'), aircraft: color('--fd-profile-aircraft', '#7ef0b8'),
      font: style?.fontFamily || 'sans-serif'
    };
    const paletteKey = JSON.stringify(palette);
    if (!dirty && width === lastWidth && height === lastHeight && dpr === lastDpr && paletteKey === lastPalette) return;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (model) drawProfile(context, model, width, height, palette);
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
    model = next; state = nextState ?? { status: next ? 'ready' : 'empty' };
    const message = statusMessage(model, state);
    status.textContent = message; overlay.hidden = !message;
    panel.dataset.status = state.status;
    panel.setAttribute('aria-busy', String(state.status === 'loading'));
    retry.hidden = state.status !== 'error';
    const text = verticalProfileSummary(model, state);
    if (summary.textContent !== text) summary.textContent = text;
    title.textContent = model ? `${identifier(model.origin)} → ${identifier(model.destination)}` : 'Vertical profile';
    attribution.textContent = model ? `${model.source.name} · ${model.source.attribution}` : 'Terrain unavailable';
    const values = model ? [
      feet(model.metrics.currentAltitudeFeet), feet(model.metrics.currentAglFeet), feet(model.metrics.terrainClearanceFeet),
      model.metrics.nextRestriction ? `${identifier(model.metrics.nextRestriction.ident)} · ${restrictionLabel(model.metrics.nextRestriction)}` : 'None',
      `${model.metrics.distanceRemainingNm.toFixed(1)} NM`, model.terrain.length ? model.metrics.sourceCacheBadge : 'Unavailable'
    ] : ['—', '—', '—', '—', '—', 'Unavailable'];
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
    if (!model) return;
    const bounds = canvas.getBoundingClientRect();
    const left = Math.min(54, bounds.width * 0.2), right = Math.max(left + 1, bounds.width - 22);
    const distance = clamp(((event as PointerEvent).clientX - bounds.left - left) / (right - left), 0, 1) * model.totalDistanceNm;
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
      model = null; context = null;
    }
  };
}
