import { describe, expect, it } from 'vitest';
import { flightDeckTabs, formatWaypointCoordinates } from './flightDeckPresentation';

describe('flight deck navigation', () => {
  it('keeps detailed route information in Route Info instead of a separate NavLog tab', () => {
    expect(flightDeckTabs).toEqual(['flight', 'route']);
  });
});

describe('waypoint coordinate presentation', () => {
  it('shows latitude before longitude with four decimals and hemisphere letters', () => {
    expect(formatWaypointCoordinates([-79.6248, 43.6777])).toBe('43.6777°N · 79.6248°W');
    expect(formatWaypointCoordinates([116.4074, -39.9042])).toBe('39.9042°S · 116.4074°E');
  });
});
