import { describe, expect, it, vi } from 'vitest';
import { followAircraft } from './aircraftFollow';

describe('aircraft camera follow', () => {
  it('replaces the current animation with the new position and heading', () => {
    const camera = { getZoom: () => 17, easeTo: vi.fn(), isMoving: () => true };
    followAircraft(camera, [-79.6, 43.6], 90, [175, 100], 16);
    followAircraft(camera, [-79.61, 43.61], 100, [175, 100], 16);
    expect(camera.easeTo).toHaveBeenCalledTimes(2);
    expect(camera.easeTo).toHaveBeenLastCalledWith({
      center: [-79.61, 43.61], bearing: 100, zoom: 17,
      offset: [175, 100], duration: 250, essential: true
    });
  });

  it('recenters an aircraft outside the current viewport while preserving MAP zoom', () => {
    const camera = { getZoom: () => 3, easeTo: vi.fn() };
    followAircraft(camera, [140, 35], 270, [0, 0]);
    expect(camera.easeTo.mock.calls[0]![0]).toMatchObject({ center: [140, 35], zoom: 3 });
    followAircraft(camera, [140, 35], 270, [0, 0], 16);
    expect(camera.easeTo.mock.calls[1]![0].zoom).toBe(16);
  });

  it('does not move the camera for invalid simulator coordinates', () => {
    const camera = { getZoom: () => 16, easeTo: vi.fn() };
    followAircraft(camera, [Number.NaN, 43], 0, [0, 0]);
    followAircraft(camera, [0, 91], 0, [0, 0]);
    expect(camera.easeTo).not.toHaveBeenCalled();
  });
});
