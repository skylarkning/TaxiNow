import type {
  Feature,
  FeatureCollection,
  LineString,
  Point,
  Polygon
} from "geojson";
import type { AirportFeature } from "./contracts";

interface LocalRunway {
  origin: [number, number];
  metersPerLongitude: number;
  metersPerLatitude: number;
  length: number;
  along: [number, number];
  across: [number, number];
}

export interface RunwayDecorationData {
  markings: FeatureCollection<LineString | Polygon>;
  pavementLabels: FeatureCollection<Point>;
}

export function buildRunwayDecorations(
  features: AirportFeature[]
): RunwayDecorationData {
  const markings: Array<Feature<LineString | Polygon>> = [];
  const pavementLabels: Array<Feature<Point>> = [];

  for (const feature of features) {
    if (feature.kind !== "runway" || feature.points.length < 2) {
      continue;
    }
    const runway = localRunway(feature.points[0]!, feature.points.at(-1)!);
    if (runway.length < 100) {
      continue;
    }
    const width = feature.widthMeters && feature.widthMeters > 0
      ? feature.widthMeters
      : 45;
    const thresholdInset = Math.min(8, Math.max(3, width * 0.1));
    const centerlineInset = Math.min(
      runway.length * 0.18,
      Math.max(85, width * 1.8)
    );

    // Use the same physical local coordinates for the runway surface and all
    // painted markings. This binds aiming and touchdown blocks to the runway
    // edges at every zoom level instead of approximating pavement width in
    // browser pixels.
    markings.push(rectangleFeature(
      `${feature.id}-pavement`,
      "pavement",
      runway,
      runway.length / 2,
      0,
      runway.length,
      width
    ));

    // Use a short, generic blast-pad presentation outside each runway end.
    // Yellow chevrons distinguish the non-runway area from the white threshold
    // and landing markings without inventing a magnetic heading value.
    const blastPadLength = Math.max(36, Math.min(75, width * 1.35));
    for (const end of [0, 1] as const) {
      const direction = end === 0 ? 1 : -1;
      const origin = end === 0 ? 0 : runway.length;
      markings.push(rectangleFeature(
        `${feature.id}-${end}-blastpad`,
        "blastpad",
        runway,
        origin - direction * blastPadLength / 2,
        0,
        blastPadLength,
        width
      ));
      const chevronDepth = Math.min(blastPadLength * 0.22, width * 0.38);
      for (let chevron = 0; chevron < 3; chevron++) {
        const centerDistance = blastPadLength * (chevron + 0.52) / 3;
        const baseAlong = origin - direction * (centerDistance + chevronDepth / 2);
        const apexAlong = origin - direction * (centerDistance - chevronDepth / 2);
        markings.push(lineFeature(
          `${feature.id}-${end}-blastpad-chevron-${chevron}`,
          "blastpad-chevron",
          [
            localPoint(runway, baseAlong, -width * 0.36),
            localPoint(runway, apexAlong, 0),
            localPoint(runway, baseAlong, width * 0.36)
          ]
        ));
      }
    }

    markings.push(lineFeature(
      feature.id,
      "centerline",
      localLine(runway, centerlineInset, 0, runway.length - centerlineInset, 0)
    ));

    const designators = runwayEndDesignators(
      feature.ref,
      feature.points[0]!,
      feature.points.at(-1)!
    );
    for (const end of [0, 1] as const) {
      const direction = end === 0 ? 1 : -1;
      const origin = end === 0 ? 0 : runway.length;
      markings.push(lineFeature(
        `${feature.id}-${end}`,
        "threshold",
        localLine(
          runway,
          origin + direction * thresholdInset,
          -width * 0.42,
          origin + direction * thresholdInset,
          width * 0.42
        )
      ));

      // Threshold "piano keys" run in the landing direction. The number of
      // stripes scales with pavement width so narrow regional runways do not
      // become a solid white block.
      const stripePairs = Math.max(3, Math.min(8, Math.round(width / 8)));
      for (let stripe = 0; stripe < stripePairs; stripe++) {
        const lateral = width * 0.08 + stripe *
          (width * 0.36 / Math.max(1, stripePairs - 1));
        for (const side of [-1, 1]) {
          markings.push(rectangleFeature(
            `${feature.id}-${end}-stripe-${stripe}-${side}`,
            "threshold-stripe",
            runway,
            origin + direction * (thresholdInset + Math.min(16, width * 0.25)),
            side * lateral,
            Math.min(30, width * 0.7),
            Math.max(1.5, Math.min(2.2, width * 0.035))
          ));
        }
      }

      const aimingDistance = Math.min(runway.length * 0.28, 400);
      if (aimingDistance > width * 4 && aimingDistance < runway.length / 2) {
        const aimingBarWidth = Math.max(4.5, Math.min(7, width * 0.1));
        const edgeMargin = Math.max(1.5, width * 0.06);
        const aimingAcross = Math.max(0, Math.min(
          width * 0.34,
          width / 2 - edgeMargin - aimingBarWidth / 2
        ));
        for (const side of [-1, 1]) {
          markings.push(rectangleFeature(
            `${feature.id}-${end}-${side}`,
            "aiming",
            runway,
            origin + direction * aimingDistance,
            side * aimingAcross,
            Math.min(45, runway.length * 0.035),
            aimingBarWidth
          ));
        }
      }

      // Use the distance-coded touchdown-zone pattern: three bars at 150 m,
      // two at 300 m, and one at 450 m from each threshold. Each bar uses the
      // standard 22.5 m by 1.8 m proportions and therefore scales with the
      // physical runway instead of with browser pixels.
      for (const [touchdownDistance, barCount] of [
        [150, 3],
        [300, 2],
        [450, 1]
      ] as const) {
        if (touchdownDistance + 24 >= runway.length / 2) {
          continue;
        }
        for (const side of [-1, 1]) {
          const groupWidth = barCount * 1.8 + (barCount - 1) * 1.5;
          const edgeMargin = Math.max(1.5, width * 0.06);
          const groupAcross = Math.max(0, Math.min(
            width * 0.36,
            width / 2 - edgeMargin - groupWidth / 2
          ));
          for (let bar = 0; bar < barCount; bar++) {
            const offset = -groupWidth / 2 + 0.9 + bar * 3.3;
            markings.push(rectangleFeature(
              `${feature.id}-${end}-tdz-${touchdownDistance}-${side}-${bar}`,
              "touchdown",
              runway,
              origin + direction * touchdownDistance,
              side * groupAcross + offset,
              22.5,
              1.8
            ));
          }
        }
      }

      const text = designators[end] ?? designators[0] ?? "";
      if (text) {
        const heading = runwayBearing(runway) + (end === 0 ? 0 : 180);
        // MapLibre text rotation is measured clockwise from an east-west
        // baseline. Using the runway heading turns the label baseline across
        // the runway, matching real threshold numerals and the AMM capsule.
        const rotation = normalizeSymbolRotation(heading);
        pavementLabels.push({
          type: "Feature",
          properties: {
            text,
            rotation
          },
          geometry: {
            type: "Point",
            coordinates: localPoint(
              runway,
              origin + direction * Math.max(58, width * 1.05),
              0
            )
          }
        });
      }
    }
  }

  return {
    markings: { type: "FeatureCollection", features: markings },
    pavementLabels: {
      type: "FeatureCollection",
      features: pavementLabels
    }
  };
}

/**
 * Return runway designators in geometric endpoint order.
 *
 * OSM and supplemental sources do not guarantee that a `05/23` reference is
 * ordered the same way as the LineString coordinates. The designator painted
 * at an endpoint describes the direction travelled from that threshold into
 * the runway, so compare both possible assignments with the physical runway
 * bearings instead of trusting source order.
 */
export function runwayEndDesignators(
  reference: string | null | undefined,
  start: [number, number],
  end: [number, number]
): [string, string] {
  const values = (reference ?? "")
    .split("/")
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length !== 2) {
    const first = values[0] ?? "";
    return [first, values[1] ?? first];
  }

  const firstBearing = designatorBearing(values[0]!);
  const secondBearing = designatorBearing(values[1]!);
  if (firstBearing === null || secondBearing === null) {
    return [values[0]!, values[1]!];
  }

  const physical = coordinateBearing(start, end);
  const reciprocal = (physical + 180) % 360;
  const sourceOrderScore =
    angularDistance(firstBearing, physical) +
    angularDistance(secondBearing, reciprocal);
  const reversedOrderScore =
    angularDistance(secondBearing, physical) +
    angularDistance(firstBearing, reciprocal);
  return reversedOrderScore < sourceOrderScore
    ? [values[1]!, values[0]!]
    : [values[0]!, values[1]!];
}

function designatorBearing(value: string): number | null {
  // Some otherwise usable sources append an operational annotation or a
  // non-standard suffix (for example `25(NOTINUSE)` or `11H`). Preserve the
  // displayed text, but use its leading runway number for endpoint matching.
  const match = /^(?:RWY\s*)?(\d{1,2})/i.exec(value.trim());
  if (!match) {
    return null;
  }
  const number = Number(match[1]);
  if (!Number.isInteger(number) || number < 1 || number > 36) {
    return null;
  }
  return (number % 36) * 10;
}

function coordinateBearing(
  start: [number, number],
  end: [number, number]
): number {
  const latitude = (start[1] + end[1]) / 2;
  const dx = (end[0] - start[0]) * Math.cos(latitude * Math.PI / 180);
  const dy = end[1] - start[1];
  return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
}

function angularDistance(left: number, right: number): number {
  const difference = Math.abs(left - right) % 360;
  return Math.min(difference, 360 - difference);
}

function localRunway(
  start: [number, number],
  end: [number, number]
): LocalRunway {
  const latitude = (start[1] + end[1]) / 2;
  const metersPerLongitude = 111_320 * Math.cos(latitude * Math.PI / 180);
  const metersPerLatitude = 110_540;
  const dx = (end[0] - start[0]) * metersPerLongitude;
  const dy = (end[1] - start[1]) * metersPerLatitude;
  const length = Math.hypot(dx, dy);
  const along: [number, number] = [dx / length, dy / length];
  return {
    origin: start,
    metersPerLongitude,
    metersPerLatitude,
    length,
    along,
    across: [-along[1], along[0]]
  };
}

function localPoint(
  runway: LocalRunway,
  along: number,
  across: number
): [number, number] {
  const x = runway.along[0] * along + runway.across[0] * across;
  const y = runway.along[1] * along + runway.across[1] * across;
  return [
    runway.origin[0] + x / runway.metersPerLongitude,
    runway.origin[1] + y / runway.metersPerLatitude
  ];
}

function localLine(
  runway: LocalRunway,
  startAlong: number,
  startAcross: number,
  endAlong: number,
  endAcross: number
): [[number, number], [number, number]] {
  return [
    localPoint(runway, startAlong, startAcross),
    localPoint(runway, endAlong, endAcross)
  ];
}

function lineFeature(
  id: string,
  kind: "centerline" | "threshold" | "threshold-stripe" |
    "aiming" | "touchdown" | "blastpad-chevron",
  coordinates: Array<[number, number]>
): Feature<LineString> {
  return {
    type: "Feature",
    properties: { id, kind },
    geometry: { type: "LineString", coordinates }
  };
}

function rectangleFeature(
  id: string,
  kind: "pavement" | "blastpad" | "threshold-stripe" | "aiming" | "touchdown",
  runway: LocalRunway,
  centerAlong: number,
  centerAcross: number,
  length: number,
  width: number
): Feature<Polygon> {
  const halfLength = length / 2;
  const halfWidth = width / 2;
  const coordinates = [
    localPoint(runway, centerAlong - halfLength, centerAcross - halfWidth),
    localPoint(runway, centerAlong + halfLength, centerAcross - halfWidth),
    localPoint(runway, centerAlong + halfLength, centerAcross + halfWidth),
    localPoint(runway, centerAlong - halfLength, centerAcross + halfWidth)
  ];
  coordinates.push(coordinates[0]!);
  return {
    type: "Feature",
    properties: { id, kind },
    geometry: { type: "Polygon", coordinates: [coordinates] }
  };
}

function runwayBearing(runway: LocalRunway): number {
  return (
    Math.atan2(runway.along[0], runway.along[1]) * 180 / Math.PI + 360
  ) % 360;
}

function normalizeSymbolRotation(value: number): number {
  return (value % 360 + 360) % 360;
}
