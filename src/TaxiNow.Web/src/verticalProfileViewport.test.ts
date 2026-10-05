import { describe, expect, it } from 'vitest';
import {
  createProfileViewport,
  distanceToProfileX,
  panProfileViewport,
  profileXToDistance,
  resetProfileViewport,
  zoomProfileViewport
} from './verticalProfileViewport';

describe('vertical profile viewport', () => {
  it('defaults to five hundred nautical miles ahead of the aircraft', () => {
    expect(createProfileViewport(1200, 300)).toEqual({
      totalDistanceNm: 1200,
      startDistanceNm: 300,
      endDistanceNm: 800
    });
    expect(createProfileViewport(1200)).toEqual({
      totalDistanceNm: 1200,
      startDistanceNm: 0,
      endDistanceNm: 500
    });
  });

  it('keeps at least twenty five nautical miles visible near destination', () => {
    expect(createProfileViewport(1000, 990)).toMatchObject({
      startDistanceNm: 975,
      endDistanceNm: 1000
    });
    expect(createProfileViewport(10, 8)).toMatchObject({
      startDistanceNm: 0,
      endDistanceNm: 10
    });
  });

  it('zooms around the pointer distance and clamps to full route', () => {
    const initial = createProfileViewport(1000, 250);
    const zoomed = zoomProfileViewport(initial, 2, 375);
    expect(zoomed.endDistanceNm - zoomed.startDistanceNm).toBe(250);
    expect((375 - zoomed.startDistanceNm) / 250).toBeCloseTo(0.25);
    expect(zoomProfileViewport(zoomed, 0.01, 375)).toEqual({
      totalDistanceNm: 1000,
      startDistanceNm: 0,
      endDistanceNm: 1000
    });
  });

  it('clamps pan and reset to route bounds', () => {
    const viewport = createProfileViewport(1000, 250);
    expect(panProfileViewport(viewport, -500).startDistanceNm).toBe(0);
    expect(panProfileViewport(viewport, 1000).endDistanceNm).toBe(1000);
    expect(resetProfileViewport(viewport, 400)).toEqual(createProfileViewport(1000, 400));
  });

  it('round trips pixel and route distances', () => {
    const viewport = createProfileViewport(1000, 250);
    for (const distance of [250, 375, 750]) {
      expect(profileXToDistance(distanceToProfileX(distance, viewport, 800), viewport, 800))
        .toBeCloseTo(distance, 8);
    }
  });

  it('keeps zero-distance and invalid inputs finite', () => {
    const viewport = createProfileViewport(0, Number.NaN);
    expect(viewport).toEqual({ totalDistanceNm: 0, startDistanceNm: 0, endDistanceNm: 0 });
    expect(Number.isFinite(distanceToProfileX(0, viewport, 320))).toBe(true);
    expect(Number.isFinite(profileXToDistance(0, viewport, 320))).toBe(true);
    expect(zoomProfileViewport(viewport, Number.NaN, Number.POSITIVE_INFINITY)).toEqual(viewport);
  });
});
