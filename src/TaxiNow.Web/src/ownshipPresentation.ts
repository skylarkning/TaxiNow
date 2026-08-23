import type { InterpolatedOwnship } from "./interpolation";

export interface OwnshipRenderTarget {
  ready: boolean;
  synchronized: boolean;
}

export interface OwnshipRenderTargets {
  map: OwnshipRenderTarget;
  fallback: OwnshipRenderTarget;
}

export function isSameOwnshipFrame(
  previous: InterpolatedOwnship | null,
  current: InterpolatedOwnship
): boolean {
  return previous !== null &&
    Math.abs(previous.longitude - current.longitude) < 1e-9 &&
    Math.abs(previous.latitude - current.latitude) < 1e-9 &&
    Math.abs(previous.heading - current.heading) < 0.05 &&
    previous.visible === current.visible &&
    previous.stale === current.stale;
}

export function ownshipNeedsSynchronization(
  previous: InterpolatedOwnship | null,
  current: InterpolatedOwnship,
  targets: OwnshipRenderTargets
): boolean {
  return !isSameOwnshipFrame(previous, current) ||
    (targets.map.ready && !targets.map.synchronized) ||
    (targets.fallback.ready && !targets.fallback.synchronized);
}
