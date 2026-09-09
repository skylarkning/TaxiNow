import { describe, expect, it } from 'vitest';
import { isOnVisibleHemisphere } from './globeVisibility';

describe('isOnVisibleHemisphere', () => {
  it('keeps points on the visible half of the globe', () => {
    expect(isOnVisibleHemisphere([0, 0], [80, 0])).toBe(true);
    expect(isOnVisibleHemisphere([0, 0], [-80, 30])).toBe(true);
  });

  it('rejects points on the far side of the globe', () => {
    expect(isOnVisibleHemisphere([0, 0], [120, 0])).toBe(false);
    expect(isOnVisibleHemisphere([100, 35], [-80, -35])).toBe(false);
  });
});
