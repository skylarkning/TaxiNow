import { describe, expect, it } from "vitest";
import type { InterpolatedOwnship } from "./interpolation";
import {
  isSameOwnshipFrame,
  ownshipNeedsSynchronization
} from "./ownshipPresentation";

const stationaryFrame: InterpolatedOwnship = {
  longitude: -79.6166645,
  latitude: 43.6805474,
  heading: 136.56,
  visible: true,
  stale: false
};

describe("ownship render synchronization", () => {
  it("synchronizes a stationary frame when the map layer becomes ready", () => {
    expect(ownshipNeedsSynchronization(
      stationaryFrame,
      stationaryFrame,
      {
        map: { ready: false, synchronized: false },
        fallback: { ready: false, synchronized: false }
      }
    )).toBe(false);

    expect(ownshipNeedsSynchronization(
      stationaryFrame,
      stationaryFrame,
      {
        map: { ready: true, synchronized: false },
        fallback: { ready: false, synchronized: false }
      }
    )).toBe(true);
  });

  it("synchronizes an unchanged frame when a fallback overlay is activated", () => {
    expect(ownshipNeedsSynchronization(
      stationaryFrame,
      stationaryFrame,
      {
        map: { ready: true, synchronized: true },
        fallback: { ready: true, synchronized: false }
      }
    )).toBe(true);
  });

  it("skips a frame only after every available target is synchronized", () => {
    expect(ownshipNeedsSynchronization(
      stationaryFrame,
      stationaryFrame,
      {
        map: { ready: true, synchronized: true },
        fallback: { ready: false, synchronized: false }
      }
    )).toBe(false);
  });

  it("detects position, heading, visibility, and stale-state changes", () => {
    for (const current of [
      { ...stationaryFrame, longitude: stationaryFrame.longitude + 0.000001 },
      { ...stationaryFrame, heading: stationaryFrame.heading + 1 },
      { ...stationaryFrame, visible: false },
      { ...stationaryFrame, stale: true }
    ]) {
      expect(isSameOwnshipFrame(stationaryFrame, current)).toBe(false);
    }
  });
});
