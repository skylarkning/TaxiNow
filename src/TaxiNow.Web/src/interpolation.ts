import type { TelemetrySnapshot } from "./contracts";

export interface InterpolatedOwnship {
  longitude: number;
  latitude: number;
  heading: number;
  visible: boolean;
  stale: boolean;
}

export function interpolateHeading(
  from: number,
  to: number,
  fraction: number
): number {
  const start = normalizeHeading(from);
  const end = normalizeHeading(to);
  const delta = ((end - start + 540) % 360) - 180;
  return normalizeHeading(start + delta * clamp(fraction, 0, 1));
}

export function interpolateOwnship(
  samples: readonly TelemetrySnapshot[],
  renderTimeMs: number,
  interpolationDelayMs = 100,
  maximumExtrapolationMs = 250
): InterpolatedOwnship | null {
  const latest = samples.at(-1);
  if (!latest) {
    return null;
  }

  const previous = samples.at(-2);
  const targetTime = renderTimeMs - interpolationDelayMs;
  if (!previous) {
    return toOwnship(latest);
  }

  const previousTime = Date.parse(previous.serverTimestampUtc);
  const latestTime = Date.parse(latest.serverTimestampUtc);
  const interval = Math.max(1, latestTime - previousTime);
  const fraction = clamp((targetTime - previousTime) / interval, 0, 1);
  let longitude =
    previous.longitude + (latest.longitude - previous.longitude) * fraction;
  let latitude =
    previous.latitude + (latest.latitude - previous.latitude) * fraction;
  let heading = interpolateHeading(
    previous.trueHeadingDegrees,
    latest.trueHeadingDegrees,
    fraction
  );

  if (targetTime > latestTime) {
    const extrapolation = Math.min(
      targetTime - latestTime,
      maximumExtrapolationMs
    );
    const ratio = extrapolation / interval;
    longitude += (latest.longitude - previous.longitude) * ratio;
    latitude += (latest.latitude - previous.latitude) * ratio;
    heading = interpolateHeading(
      latest.trueHeadingDegrees,
      latest.trueHeadingDegrees +
        shortestHeadingDelta(
          previous.trueHeadingDegrees,
          latest.trueHeadingDegrees
        ) *
          ratio,
      1
    );
  }

  return {
    longitude,
    latitude,
    heading,
    visible: latest.connected && latest.onGround,
    stale: latest.isStale
  };
}

function toOwnship(sample: TelemetrySnapshot): InterpolatedOwnship {
  return {
    longitude: sample.longitude,
    latitude: sample.latitude,
    heading: normalizeHeading(sample.trueHeadingDegrees),
    visible: sample.connected && sample.onGround,
    stale: sample.isStale
  };
}

function shortestHeadingDelta(from: number, to: number): number {
  return ((normalizeHeading(to) - normalizeHeading(from) + 540) % 360) - 180;
}

function normalizeHeading(value: number): number {
  const result = value % 360;
  return result < 0 ? result + 360 : result;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

