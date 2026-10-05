export interface ProfileViewport {
  totalDistanceNm: number;
  startDistanceNm: number;
  endDistanceNm: number;
}

const defaultRangeNm = 500;
const minimumRangeNm = 25;

export function createProfileViewport(
  totalDistanceNm: number,
  aircraftDistanceNm?: number
): ProfileViewport {
  const total = Number.isFinite(totalDistanceNm) ? Math.max(0, totalDistanceNm) : 0;
  if (total === 0) return { totalDistanceNm: 0, startDistanceNm: 0, endDistanceNm: 0 };
  const start = Number.isFinite(aircraftDistanceNm)
    ? Math.max(0, Math.min(total, aircraftDistanceNm!))
    : 0;
  const desiredSpan = Math.min(defaultRangeNm, total);
  let end = Math.min(total, start + desiredSpan);
  let adjustedStart = start;
  if (end - adjustedStart < Math.min(minimumRangeNm, total)) {
    adjustedStart = Math.max(0, total - Math.min(minimumRangeNm, total));
    end = total;
  }
  return { totalDistanceNm: total, startDistanceNm: adjustedStart, endDistanceNm: end };
}

export function zoomProfileViewport(
  viewport: ProfileViewport,
  factor: number,
  anchorDistanceNm: number
): ProfileViewport {
  if (!Number.isFinite(factor) || factor <= 0 ||
      !Number.isFinite(anchorDistanceNm) || viewport.totalDistanceNm <= 0) return viewport;
  const span = viewport.endDistanceNm - viewport.startDistanceNm;
  const minimum = Math.min(minimumRangeNm, viewport.totalDistanceNm);
  const nextSpan = Math.max(minimum, Math.min(viewport.totalDistanceNm, span / factor));
  const anchor = Math.max(viewport.startDistanceNm, Math.min(viewport.endDistanceNm, anchorDistanceNm));
  const ratio = span > 0 ? (anchor - viewport.startDistanceNm) / span : 0.5;
  return withWindow(viewport.totalDistanceNm, anchor - ratio * nextSpan, nextSpan);
}

export function panProfileViewport(
  viewport: ProfileViewport,
  deltaNm: number
): ProfileViewport {
  if (!Number.isFinite(deltaNm) || viewport.totalDistanceNm <= 0) return viewport;
  return withWindow(
    viewport.totalDistanceNm,
    viewport.startDistanceNm + deltaNm,
    viewport.endDistanceNm - viewport.startDistanceNm);
}

export function resetProfileViewport(
  viewport: ProfileViewport,
  aircraftDistanceNm?: number
): ProfileViewport {
  return createProfileViewport(viewport.totalDistanceNm, aircraftDistanceNm);
}

export function distanceToProfileX(
  distanceNm: number,
  viewport: ProfileViewport,
  width: number
): number {
  const span = viewport.endDistanceNm - viewport.startDistanceNm;
  if (!Number.isFinite(distanceNm) || !Number.isFinite(width) || width <= 0 || span <= 0) return 0;
  return (distanceNm - viewport.startDistanceNm) / span * width;
}

export function profileXToDistance(
  x: number,
  viewport: ProfileViewport,
  width: number
): number {
  const span = viewport.endDistanceNm - viewport.startDistanceNm;
  if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0 || span <= 0) {
    return viewport.startDistanceNm;
  }
  return viewport.startDistanceNm + x / width * span;
}

function withWindow(totalDistanceNm: number, requestedStart: number, requestedSpan: number): ProfileViewport {
  const span = Math.max(0, Math.min(totalDistanceNm, requestedSpan));
  const start = Math.max(0, Math.min(totalDistanceNm - span, requestedStart));
  return { totalDistanceNm, startDistanceNm: start, endDistanceNm: start + span };
}
