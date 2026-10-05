import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildVerticalProfileModel, type VerticalProfileModel } from './verticalProfile';
import { distanceNm } from './flightPlan';
import {
  profilePanelHeight,
  selectWaypointLabelIndexes,
  verticalProfileSummary,
  profileInspection,
  createVerticalProfileView
} from './verticalProfileView';

function model(): VerticalProfileModel {
  return {
    origin: 'KAAA', destination: 'KBBB', totalDistanceNm: 100,
    routePoints: [
      { ident: 'KAAA', position: [0, 0], distanceNm: 0, waypointIndex: 0 },
      { ident: 'KBBB', position: [1, 0], distanceNm: 100, waypointIndex: 1 }
    ],
    altitudePath: [
      { distanceNm: 0, altitudeFeet: 500, estimated: false, waypointIndex: 0 },
      { distanceNm: 100, altitudeFeet: 2000, estimated: true, waypointIndex: 1 }
    ],
    constraints: [{ ident: 'KBBB', distanceNm: 100, kind: 'atOrAbove', minimumAltitudeFeet: 2000, maximumAltitudeFeet: undefined, waypointIndex: 1 }],
    terrain: [
      { longitude: 0, latitude: 0, distanceNm: 0, elevationFeet: 500, referenceAltitudeFeet: 500, clearanceFeet: 0, clearanceBand: 'normal' },
      { longitude: 1, latitude: 0, distanceNm: 100, elevationFeet: 800, referenceAltitudeFeet: 2000, clearanceFeet: 1200, clearanceBand: 'amber' }
    ],
    aircraft: { distanceNm: 40, altitudeMslFeet: 12500, altitudeAglFeet: 11000, crossTrackDistanceNm: 0, terrainElevationFeet: 1500, clearanceFeet: 11000, clearanceBand: 'normal' },
    weatherBands: [], weatherWarnings: [], weatherSourceSummary: '',
    source: { name: 'Open-Meteo', cacheState: 'fresh', generatedAt: '2026-09-12T00:00:00Z', attribution: 'Open-Meteo · Copernicus DEM' },
    metrics: { currentAltitudeFeet: 12500, currentAglFeet: 11000, terrainClearanceFeet: 11000, nextRestriction: null, distanceRemainingNm: 60, sourceCacheBadge: 'Fresh' },
    accessibilitySummary: 'KAAA to KBBB vertical profile.'
  };
}

describe('vertical profile layout without a browser', () => {
  it('uses the complete available main region on desktop and mobile', () => {
    expect(profilePanelHeight(1200, false)).toBe(1200);
    expect(profilePanelHeight(600, true)).toBe(600);
    expect(profilePanelHeight(300, false)).toBe(300);
    expect(profilePanelHeight(2000, false)).toBe(2000);
  });

  it('keeps both route ends visible and selects a bounded unique label set', () => {
    const indexes = selectWaypointLabelIndexes(80, 8);
    expect(indexes).toHaveLength(8);
    expect(indexes[0]).toBe(0);
    expect(indexes.at(-1)).toBe(79);
    expect(new Set(indexes).size).toBe(8);
    expect(selectWaypointLabelIndexes(3, 8)).toEqual([0, 1, 2]);
    expect(selectWaypointLabelIndexes(80, 0)).toEqual([]);
    expect(selectWaypointLabelIndexes(0, 8)).toEqual([]);
    expect(selectWaypointLabelIndexes(Number.NaN, 8)).toEqual([]);
  });
});

// Node has no browser DOM/canvas. This boundary double retains observable tree,
// event, sizing and focus behavior; the view and all profile data remain real.
class TestElement extends EventTarget {
  id = ''; className = ''; textContent = ''; hidden = false; tabIndex = -1;
  type = ''; width = 0; height = 0; clientWidth = 800; clientHeight = 200;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: TestElement[] = [];
  parent: TestElement | null = null;
  style = { setProperty: vi.fn(), removeProperty: vi.fn(), left: '', top: '' };
  ownerDocument!: ReturnType<typeof browserFixture>['document'];
  constructor(readonly tagName: string) { super(); }
  append(...elements: TestElement[]) { elements.forEach(element => { element.parent = this; this.children.push(element); }); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  getBoundingClientRect() { return { width: this.clientWidth, height: this.clientHeight, left: 0, top: 0 }; }
  contains(element: TestElement | null): boolean { return element === this || this.children.some(child => child.contains(element)); }
  focus() { this.ownerDocument.activeElement = this; this.dispatchEvent(new Event('focus')); }
  find(id: string): TestElement | undefined { return this.id === id ? this : this.children.map(child => child.find(id)).find(Boolean); }
  context: unknown = null;
  getContext() { return this.context; }
  setPointerCapture = vi.fn();
  releasePointerCapture = vi.fn();
}

function browserFixture(mobile = false, paint = false, styleValues: Record<string, string> = {}, reducedMotion = false) {
  const operations = new Map<string, ReturnType<typeof vi.fn>>();
  const context = new Proxy({}, {
    get: (_, name: string) => {
      if (!operations.has(name)) operations.set(name, vi.fn(name === 'measureText' ? (text: string) => ({ width: text.length * 6 }) : () => undefined));
      return operations.get(name);
    },
    set: (_, name: string, value: unknown) => {
      const operation = `set:${name}`;
      if (!operations.has(operation)) operations.set(operation, vi.fn());
      (operations.get(operation)! as unknown as (next: unknown) => void)(value);
      return true;
    }
  });
  const observers: Array<{ callback: () => void; disconnected: boolean }> = [];
  class Observer {
    disconnected = false;
    constructor(readonly callback: () => void) { observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  const window = Object.assign(new EventTarget(), {
    innerWidth: mobile ? 500 : 1200, devicePixelRatio: 2,
    matchMedia: (query: string) => ({ matches: query.includes('prefers-reduced-motion') ? reducedMotion : mobile }),
    getComputedStyle: () => ({ getPropertyValue: (name: string): string => styleValues[name] ?? '', fontFamily: 'sans-serif' }),
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrame++; frames.set(id, callback); return id;
    }),
    cancelAnimationFrame: vi.fn((id: number) => { frames.delete(id); }),
    CustomEvent,
    ResizeObserver: Observer,
    MutationObserver: Observer
  });
  const document = {
    defaultView: window, activeElement: null as TestElement | null,
    documentElement: new TestElement('html'), body: new TestElement('body'),
    createElement(tag: string): TestElement {
      const element = new TestElement(tag);
      if (tag === 'canvas' && paint) element.context = context;
      element.ownerDocument = document;
      return element;
    }
  };
  const host = document.createElement('section');
  host.clientHeight = 800;
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', window);
  const flushFrames = () => {
    const pending = [...frames.entries()]; frames.clear();
    pending.forEach(([, callback]) => callback(0));
  };
  return { document, window, host, operations, observers, flushFrames };
}

afterEach(() => vi.unstubAllGlobals());

describe('panel lifecycle', () => {
  it.each([false, true])('fills the host while open and releases its entire height while closed (mobile=%s)', mobile => {
    const { host } = browserFixture(mobile);
    const view = createVerticalProfileView(host as unknown as HTMLElement);
    view.setOpen(true);
    expect(host.find('fd-vertical-profile')!.hidden).toBe(false);
    expect(host.style.setProperty).toHaveBeenLastCalledWith('--fd-profile-height', '800px');
    host.clientHeight = 620;
    view.resize();
    expect(host.style.setProperty).toHaveBeenLastCalledWith('--fd-profile-height', '620px');
    view.setOpen(false);
    expect(host.find('fd-vertical-profile')!.hidden).toBe(true);
    expect(host.style.setProperty).toHaveBeenLastCalledWith('--fd-profile-height', '0px');
    view.destroy();
  });

  it('fully collapses through setOpen and Escape, and publishes state for the map', () => {
    const { host } = browserFixture();
    const view = createVerticalProfileView(host as unknown as HTMLElement);
    view.render(model());
    const panel = host.find('fd-vertical-profile')!;
    expect(panel.hidden).toBe(false);
    view.setOpen(false);
    expect(panel.hidden).toBe(true);
    expect(host.dataset.profileOpen).toBe('false');
    view.setOpen(true);
    const changed = vi.fn();
    panel.addEventListener('vertical-profile-open-change', changed);
    panel.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    expect(panel.hidden).toBe(true);
    expect(host.dataset.profileOpen).toBe('false');
    expect(changed.mock.calls[0]?.[0].detail).toEqual({ open: false });
    view.destroy();
  });

  it('starts mobile closed, announces errors, and emits retry without fetching', () => {
    const { host } = browserFixture(true);
    const view = createVerticalProfileView(host as unknown as HTMLElement);
    const panel = host.find('fd-vertical-profile')!;
    expect(panel.hidden).toBe(true);
    view.setOpen(true);
    view.render(null, { status: 'error', message: 'Terrain unavailable. Try again.' });
    expect(host.find('fd-profile-status')?.textContent).toContain('Terrain unavailable');
    expect(host.find('fd-profile-retry')?.hidden).toBe(false);
    const retry = vi.fn();
    panel.addEventListener('vertical-profile-retry', retry);
    host.find('fd-profile-retry')!.dispatchEvent(new Event('click'));
    expect(retry).toHaveBeenCalledOnce();
    view.destroy();
  });

  it('updates keyboard inspection after model shrink and removes owned DOM on destroy', () => {
    const { host } = browserFixture();
    const view = createVerticalProfileView(host as unknown as HTMLElement);
    view.render(model());
    const panel = host.find('fd-vertical-profile')!;
    const canvas = host.find('fd-profile-canvas')!;
    canvas.focus();
    panel.dispatchEvent(Object.assign(new Event('keydown'), { key: 'ArrowRight' }));
    expect(host.find('fd-profile-tooltip')?.textContent).toContain('KBBB');
    const shorter = model();
    shorter.terrain = shorter.terrain.slice(0, 1);
    view.render(shorter);
    expect(host.find('fd-profile-tooltip')?.textContent).toContain('KAAA');
    view.destroy();
    expect(host.children).toHaveLength(0);
    expect(host.dataset.profileOpen).toBe('false');
    expect(() => { view.resize(); view.setOpen(true); view.render(model()); }).not.toThrow();
    expect(host.children).toHaveLength(0);
  });

  it('does not advertise fresh terrain when terrain samples are absent', () => {
    const { host } = browserFixture();
    const view = createVerticalProfileView(host as unknown as HTMLElement);
    const unavailable = model(); unavailable.terrain = [];
    view.render(unavailable, { status: 'error' });
    expect(host.find('fd-profile-value-5')?.textContent).toBe('Unavailable');
    view.destroy();
  });

  it('scales and draws the canvas, skips unchanged redraws, and releases all observers', () => {
    const { host, window, operations, observers } = browserFixture(false, true);
    const view = createVerticalProfileView(host as unknown as HTMLElement);
    const profile = model();
    view.render(profile);
    const canvas = host.find('fd-profile-canvas')!;
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(400);
    expect(operations.get('setTransform')).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
    const renderedLabels = operations.get('fillText')!.mock.calls.map(call => call[0]);
    expect(renderedLabels).not.toContain('KAAA');
    expect(renderedLabels).toContain('KBBB');
    expect(operations.get('fill')!.mock.calls.length).toBeGreaterThanOrEqual(2);
    const paints = operations.get('clearRect')!.mock.calls.length;
    view.render(profile); view.resize();
    expect(operations.get('clearRect')).toHaveBeenCalledTimes(paints);
    canvas.clientWidth = 600; view.resize();
    expect(canvas.width).toBe(1200);
    expect(operations.get('clearRect')).toHaveBeenCalledTimes(paints + 1);
    window.getComputedStyle = () => ({ getPropertyValue: () => '#123456', fontFamily: 'sans-serif' });
    observers[1]!.callback();
    expect(operations.get('clearRect')).toHaveBeenCalledTimes(paints + 2);
    view.destroy();
    expect(observers.every(observer => observer.disconnected)).toBe(true);
    canvas.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('resize'));
    observers.forEach(observer => observer.callback());
    expect(operations.get('clearRect')).toHaveBeenCalledTimes(paints + 2);
  });

  it('keeps the avionics plot dark in a light shell and outlines low terrain', () => {
    const { host, operations } = browserFixture(false, true, {
      '--fd-field': '#ffffff',
      '--fd-text': '#111111',
      '--fd-muted': '#777777',
      '--fd-line': '#dddddd'
    });
    const view = createVerticalProfileView(host as unknown as HTMLElement);
    view.render(model());

    expect(operations.get('set:fillStyle')?.mock.calls[0]?.[0]).toBe('#071826');
    expect(operations.get('set:strokeStyle')?.mock.calls.map(call => call[0])).toContain('#6f9ca8');
    expect(operations.get('set:lineWidth')?.mock.calls.map(call => call[0])).toContain(2);
    view.destroy();
  });

  it('zooms around the wheel pointer and shares transforms with visible controls', () => {
    const { host, flushFrames } = browserFixture(false, true);
    const view = createVerticalProfileView(host as unknown as HTMLElement);
    const profile = model();
    profile.totalDistanceNm = 1000;
    profile.routePoints[1]!.distanceNm = 1000;
    profile.altitudePath[1]!.distanceNm = 1000;
    profile.terrain[1]!.distanceNm = 1000;
    profile.aircraft!.distanceNm = 100;
    view.render(profile);
    const canvas = host.find('fd-profile-canvas')!;
    expect(canvas.dataset.viewportStart).toBe('100');
    expect(canvas.dataset.viewportEnd).toBe('600');

    const wheel = Object.assign(new Event('wheel', { cancelable: true }), {
      deltaY: -120, clientX: 416, clientY: 80
    });
    canvas.dispatchEvent(wheel);
    flushFrames();
    const start = Number(canvas.dataset.viewportStart);
    const end = Number(canvas.dataset.viewportEnd);
    expect(end - start).toBeLessThan(500);
    expect((start + end) / 2).toBeCloseTo(350, 0);
    expect(wheel.defaultPrevented).toBe(true);

    host.find('fd-profile-zoom-out')!.dispatchEvent(new Event('click'));
    flushFrames();
    expect(Number(canvas.dataset.viewportEnd) - Number(canvas.dataset.viewportStart)).toBeGreaterThan(end - start);
    host.find('fd-profile-reset')!.dispatchEvent(new Event('click'));
    flushFrames();
    expect(canvas.dataset.viewportStart).toBe('100');
    expect(canvas.dataset.viewportEnd).toBe('600');
    view.destroy();
  });

  it('drags and keyboard-pans within route bounds while plain arrows keep inspection', () => {
    const { host, flushFrames } = browserFixture(false, true);
    const view = createVerticalProfileView(host as unknown as HTMLElement);
    const profile = model();
    profile.totalDistanceNm = 1000;
    profile.routePoints[1]!.distanceNm = 1000;
    profile.altitudePath[1]!.distanceNm = 1000;
    profile.terrain[1]!.distanceNm = 1000;
    profile.aircraft!.distanceNm = 300;
    view.render(profile);
    const canvas = host.find('fd-profile-canvas')!;
    const panel = host.find('fd-vertical-profile')!;

    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerId: 1, clientX: 400 }));
    canvas.dispatchEvent(Object.assign(new Event('pointermove'), { pointerId: 1, clientX: 1000, clientY: 80 }));
    canvas.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 1, clientX: 1000 }));
    flushFrames();
    expect(canvas.dataset.viewportStart).toBe('0');
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(1);
    expect(canvas.releasePointerCapture).toHaveBeenCalledWith(1);

    canvas.focus();
    panel.dispatchEvent(Object.assign(new Event('keydown'), { key: 'ArrowRight', altKey: false }));
    expect(host.find('fd-profile-tooltip')?.textContent).toContain('KBBB');
    panel.dispatchEvent(Object.assign(new Event('keydown'), { key: 'ArrowRight', altKey: true }));
    flushFrames();
    expect(Number(canvas.dataset.viewportStart)).toBeGreaterThan(0);
    view.destroy();
  });

  it('retains route-distance viewport through resize and cancels queued draws on destroy', () => {
    const { host, window, flushFrames } = browserFixture(false, true, {}, true);
    const view = createVerticalProfileView(host as unknown as HTMLElement);
    const profile = model();
    profile.totalDistanceNm = 1000;
    profile.routePoints[1]!.distanceNm = 1000;
    profile.altitudePath[1]!.distanceNm = 1000;
    profile.terrain[1]!.distanceNm = 1000;
    view.render(profile);
    host.find('fd-profile-zoom-in')!.dispatchEvent(new Event('click'));
    const canvas = host.find('fd-profile-canvas')!;
    const before = [canvas.dataset.viewportStart, canvas.dataset.viewportEnd];
    canvas.clientWidth = 320;
    view.resize();
    expect([canvas.dataset.viewportStart, canvas.dataset.viewportEnd]).toEqual(before);
    view.destroy();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
    flushFrames();
  });

  it('renders every identifier in a dense eighty-mile viewport at narrow width', () => {
    const { host, operations } = browserFixture(false, true);
    const view = createVerticalProfileView(host as unknown as HTMLElement);
    const profile = model();
    profile.aircraft = undefined;
    profile.totalDistanceNm = 80;
    profile.routePoints = Array.from({ length: 9 }, (_, waypointIndex) => ({
      ident: `FIX${waypointIndex}`,
      position: [waypointIndex / 6, 0] as [number, number],
      distanceNm: waypointIndex * 10,
      waypointIndex
    }));
    profile.altitudePath = profile.routePoints.map(point => ({
      distanceNm: point.distanceNm, altitudeFeet: 10_000, estimated: false, waypointIndex: point.waypointIndex
    }));
    const canvas = host.find('fd-profile-canvas')!;
    canvas.clientWidth = 320;
    view.render(profile);
    const labels = operations.get('fillText')!.mock.calls.map(call => call[0]);
    for (let index = 0; index < 9; index++) expect(labels).toContain(`FIX${index}`);
    view.destroy();
  });
});

describe('accessible profile summary', () => {
  it('announces route endpoints, valid live altitude, source and simulation context', () => {
    const summary = verticalProfileSummary(model());
    expect(summary).toContain('KAAA');
    expect(summary).toContain('KBBB');
    expect(summary).toContain('12,500');
    expect(summary).toMatch(/MSL/);
    expect(summary).toContain('Open-Meteo');
    expect(summary).toMatch(/simulation.*only/i);
  });

  it('announces missing terrain without claiming a fresh terrain profile', () => {
    const missing = model();
    missing.terrain = [];
    missing.aircraft = undefined;
    const summary = verticalProfileSummary(missing, { status: 'error' });
    expect(summary).toMatch(/terrain unavailable/i);
    expect(summary).toMatch(/live aircraft altitude unavailable/i);
    expect(summary).not.toContain('12,500');
    expect(summary).not.toMatch(/terrain.*fresh/i);
  });

  it('announces loading and empty states without a model', () => {
    expect(verticalProfileSummary(null, { status: 'loading' })).toMatch(/loading/i);
    expect(verticalProfileSummary(null, { status: 'empty' })).toMatch(/import.*flight plan/i);
    expect(verticalProfileSummary(null)).toMatch(/simulation.*only/i);
  });
});

describe('profile inspection', () => {
  it('interpolates the planned line while airborne terrain clearance uses live altitude', () => {
    const routeDistance = distanceNm([0, 0], [1, 0]);
    const profile = buildVerticalProfileModel({
      flightPlan: {
        origin: 'KAAA', destination: 'KBBB', originName: 'Alpha', destinationName: 'Bravo',
        callsign: 'TEST1', aircraft: 'A320', altitude: '10000', route: 'DCT', distance: routeDistance,
        importedAt: '2026-09-12T00:00:00Z',
        points: [
          { ident: 'KAAA', position: [0, 0], airway: '', plannedAltitudeFeet: 2000 },
          { ident: 'KBBB', position: [1, 0], airway: '', plannedAltitudeFeet: 10000 }
        ]
      },
      elevationProfile: {
        samples: [0, 0.25, 0.5, 0.75, 1].map(fraction => ({
          longitude: fraction, latitude: 0, distanceNm: routeDistance * fraction, elevationFeet: 1000
        })),
        cacheState: 'fresh', generatedAt: '2026-09-12T00:00:00Z',
        source: 'Open-Meteo', attribution: 'Open-Meteo · Copernicus DEM'
      },
      telemetry: {
        sequence: 1, simulator: 'replay', connected: true, onGround: false,
        latitude: 0, longitude: 0.5, trueHeadingDegrees: 90, groundSpeedKnots: 200,
        sourceTimestampUtc: new Date().toISOString(), serverTimestampUtc: new Date().toISOString(),
        sourceMonotonicMilliseconds: 1, hasPosition: true, isStale: false,
        altitudeMslFeet: 12500, altitudeAglFeet: 11500, state: 'airborne'
      }
    });
    expect(profile.terrain[2]!.referenceAltitudeFeet).toBe(12500);
    expect(profile.terrain[2]!.clearanceFeet).toBe(11500);
    for (const [index, expected] of ['2,000', '4,000', '6,000', '8,000', '10,000'].entries()) {
      expect(profileInspection(profile, index)?.label).toContain(`Planned ${expected} ft`);
    }
  });

  it('does not substitute clearance altitude when the planned path is absent', () => {
    const missing = model(); missing.altitudePath = [];
    expect(profileInspection(missing, 0)?.label).toContain('Planned Unavailable');
  });

  it('clamps keyboard indexes at both ends and exposes the plotted sample values', () => {
    const first = profileInspection(model(), -100);
    const last = profileInspection(model(), 1000);
    expect(first?.index).toBe(0);
    expect(first?.label).toContain('KAAA');
    expect(last?.index).toBe(1);
    expect(last?.label).toContain('100.0 NM');
    expect(last?.label).toContain('800 ft');
    expect(last?.label).toContain('2,000 ft');
    expect(last?.label).toMatch(/at or above/i);
  });

  it('handles absent terrain, non-finite indexes, and untrusted long identifiers', () => {
    const missing = model();
    missing.terrain = [];
    missing.routePoints[0]!.ident = 'LONG'.repeat(300);
    const inspection = profileInspection(missing, Number.NaN);
    expect(inspection?.index).toBe(0);
    expect(inspection?.label).toMatch(/terrain unavailable/i);
    expect(inspection!.label.length).toBeLessThan(300);
    missing.altitudePath = [];
    expect(profileInspection(missing, 0)).toBeNull();
  });
});
