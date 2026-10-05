import type { VerticalProfileModel } from './verticalProfile';
import { distanceToProfileX, type ProfileViewport } from './verticalProfileViewport';

export type ProfileLabelReason = 'endpoint' | 'next' | 'constraint' | 'step' | 'toc' | 'tod';

export interface ProfileLabelCandidate {
  ident: string;
  distanceNm: number;
  waypointIndex: number;
  priority: number;
  critical: boolean;
  reasons: ProfileLabelReason[];
}

export interface ProfileLabelPlacement {
  candidate: ProfileLabelCandidate;
  x: number;
  row: number;
  width: number;
}

const routeChangeThresholdFeet = 500;
const stepAltitudeThresholdFeet = 1000;
const stepDistanceThresholdNm = 20;

export function classifyVerticalProfilePoints(
  model: VerticalProfileModel
): ProfileLabelCandidate[] {
  const altitudeByWaypoint = new Map<number, { distanceNm: number; altitudeFeet: number }>();
  for (const point of model.altitudePath) {
    if (point.waypointIndex !== null) altitudeByWaypoint.set(point.waypointIndex, point);
  }
  const trends = model.routePoints.slice(1).map((point, index) => {
    const previousAltitude = altitudeByWaypoint.get(model.routePoints[index]!.waypointIndex)?.altitudeFeet;
    const altitude = altitudeByWaypoint.get(point.waypointIndex)?.altitudeFeet;
    if (!Number.isFinite(previousAltitude) || !Number.isFinite(altitude)) return 0;
    const change = altitude! - previousAltitude!;
    return change > routeChangeThresholdFeet ? 1 : change < -routeChangeThresholdFeet ? -1 : 0;
  });
  const next = model.aircraft
    ? model.routePoints.find(point => point.distanceNm > model.aircraft!.distanceNm + 1e-6)
    : undefined;
  const constrained = new Set(model.constraints.map(constraint => constraint.waypointIndex));

  return model.routePoints.map((point, index) => {
    const reasons: ProfileLabelReason[] = [];
    if (index === 0 || index === model.routePoints.length - 1) reasons.push('endpoint');
    if (point.waypointIndex === next?.waypointIndex) reasons.push('next');
    if (constrained.has(point.waypointIndex)) reasons.push('constraint');

    if (index > 0) {
      const previous = model.routePoints[index - 1]!;
      const previousAltitude = altitudeByWaypoint.get(previous.waypointIndex)?.altitudeFeet;
      const altitude = altitudeByWaypoint.get(point.waypointIndex)?.altitudeFeet;
      if (Number.isFinite(previousAltitude) && Number.isFinite(altitude) &&
          Math.abs(altitude! - previousAltitude!) >= stepAltitudeThresholdFeet - 1e-9 &&
          hasStableBandBefore(index - 1, model, altitudeByWaypoint)) {
        reasons.push('step');
      }
    }
    if (index > 0 && index < model.routePoints.length - 1) {
      if (trends[index - 1] === 1 && trends[index] !== 1) reasons.push('toc');
      if (trends[index - 1] !== -1 && trends[index] === -1) reasons.push('tod');
    }

    const priority = reasons.includes('endpoint') ? 100
      : reasons.includes('next') ? 95
        : reasons.includes('constraint') ? 90
          : reasons.includes('step') ? 85
            : reasons.includes('toc') || reasons.includes('tod') ? 80
              : 0;
    return {
      ident: point.ident,
      distanceNm: point.distanceNm,
      waypointIndex: point.waypointIndex,
      priority,
      critical: priority > 0,
      reasons
    };
  });
}

function hasStableBandBefore(
  endIndex: number,
  model: VerticalProfileModel,
  altitudeByWaypoint: ReadonlyMap<number, { distanceNm: number; altitudeFeet: number }>
): boolean {
  if (endIndex <= 0) return false;
  const end = model.routePoints[endIndex]!;
  const endAltitude = altitudeByWaypoint.get(end.waypointIndex)?.altitudeFeet;
  if (!Number.isFinite(endAltitude)) return false;
  let minimum = endAltitude!;
  let maximum = endAltitude!;
  for (let index = endIndex - 1; index >= 0; index--) {
    const point = model.routePoints[index]!;
    const altitude = altitudeByWaypoint.get(point.waypointIndex)?.altitudeFeet;
    if (!Number.isFinite(altitude)) return false;
    minimum = Math.min(minimum, altitude!);
    maximum = Math.max(maximum, altitude!);
    if (maximum - minimum > routeChangeThresholdFeet + 1e-9) return false;
    if (end.distanceNm - point.distanceNm >= stepDistanceThresholdNm - 1e-9) return true;
  }
  return false;
}

export function layoutVerticalProfileLabels(
  candidates: readonly ProfileLabelCandidate[],
  viewport: ProfileViewport,
  width: number,
  measureText: (text: string) => number
): ProfileLabelPlacement[] {
  if (!Number.isFinite(width) || width <= 0) return [];
  const span = viewport.endDistanceNm - viewport.startDistanceNm;
  const shortRange = span <= 120 + 1e-9;
  const fullRoute = viewport.totalDistanceNm > 0 && span >= viewport.totalDistanceNm - 1e-6;
  const visible = candidates.filter(candidate =>
    candidate.distanceNm >= viewport.startDistanceNm - 1e-6 &&
    candidate.distanceNm <= viewport.endDistanceNm + 1e-6 &&
    (!fullRoute || shortRange || candidate.critical));
  const ordered = shortRange
    ? [...visible].sort((left, right) => left.distanceNm - right.distanceNm)
    : [...visible].sort((left, right) => right.priority - left.priority || left.distanceNm - right.distanceNm);
  const occupied: Array<Array<[number, number]>> = [[], [], []];
  const placements: ProfileLabelPlacement[] = [];

  for (const candidate of ordered) {
    const labelWidth = Math.min(width, Math.max(1, measureText(candidate.ident) + 12));
    const rawX = distanceToProfileX(candidate.distanceNm, viewport, width);
    const x = Math.max(labelWidth / 2, Math.min(width - labelWidth / 2, rawX));
    const interval: [number, number] = [x - labelWidth / 2, x + labelWidth / 2];
    const availableRow = occupied.findIndex(row =>
      row.every(existing => interval[1] + 4 <= existing[0] || interval[0] >= existing[1] + 4));
    if (!shortRange && !candidate.critical && availableRow < 0) continue;
    const row = availableRow >= 0
      ? availableRow
      : occupied.map((items, index) => ({ index, overlap: overlapAmount(items, interval) }))
          .sort((left, right) => left.overlap - right.overlap)[0]!.index;
    occupied[row]!.push(interval);
    placements.push({ candidate, x, row, width: labelWidth });
  }

  return placements.sort((left, right) => left.candidate.distanceNm - right.candidate.distanceNm);
}

function overlapAmount(existing: Array<[number, number]>, interval: [number, number]): number {
  return existing.reduce((total, item) =>
    total + Math.max(0, Math.min(item[1], interval[1]) - Math.max(item[0], interval[0])), 0);
}
