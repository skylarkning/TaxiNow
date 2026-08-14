import type {
  Feature,
  FeatureCollection,
  LineString,
  Point
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
  markings: FeatureCollection<LineString>;
  labels: FeatureCollection<Point>;
}

export function buildRunwayDecorations(
  features: AirportFeature[]
): RunwayDecorationData {
  const markings: Array<Feature<LineString>> = [];
  const labels: Array<Feature<Point>> = [];

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
    const threshold = Math.min(
      Math.max(width * 1.5, 45),
      runway.length * 0.18
    );

    // Runway edge markings make the pavement readable at the same zoom level
    // as taxiway centerlines without changing the underlying airport data.
    for (const side of [-1, 1]) {
      markings.push(lineFeature(
        `${feature.id}-edge-${side}`,
        "edge",
        localLine(runway, 0, side * width * 0.47, runway.length, side * width * 0.47)
      ));
    }

    markings.push(lineFeature(
      feature.id,
      "centerline",
      localLine(runway, threshold + width, 0, runway.length - threshold - width, 0)
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
          origin + direction * threshold,
          -width * 0.42,
          origin + direction * threshold,
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
          markings.push(lineFeature(
            `${feature.id}-${end}-stripe-${stripe}-${side}`,
            "threshold-stripe",
            localLine(
              runway,
              origin + direction * (threshold + 2),
              side * lateral,
              origin + direction * (threshold + Math.min(30, width * 0.7)),
              side * lateral
            )
          ));
        }
      }

      const aimingDistance = Math.min(runway.length * 0.28, 300);
      if (aimingDistance > width * 4 && aimingDistance < runway.length / 2) {
        for (const side of [-1, 1]) {
          markings.push(lineFeature(
            `${feature.id}-${end}-${side}`,
            "aiming",
            localLine(
              runway,
              origin + direction * (aimingDistance - 18),
              side * width * 0.27,
              origin + direction * (aimingDistance + 18),
              side * width * 0.27
            )
          ));
        }
      }


      // Touchdown-zone bars provide distance cues between the threshold and
      // aiming point. They intentionally stop before the runway midpoint so
      // reciprocal markings never collide on short runways.
      for (const touchdownDistance of [150, 450, 600]) {
        if (touchdownDistance + 24 >= runway.length / 2) {
          continue;
        }
        for (const side of [-1, 1]) {
          markings.push(lineFeature(
            `${feature.id}-${end}-tdz-${touchdownDistance}-${side}`,
            "touchdown",
            localLine(
              runway,
              origin + direction * (touchdownDistance - 11),
              side * width * 0.3,
              origin + direction * (touchdownDistance + 11),
              side * width * 0.3
            )
          ));
        }
      }

      const text = designators[end] ?? designators[0] ?? "";
      if (text) {
        const heading = normalizeAviationHeading(
          runwayBearing(runway) + (end === 0 ? 0 : 180)
        );
        labels.push({
          type: "Feature",
          properties: {
            text,
            heading: `${String(heading).padStart(3, "0")}°`
          },
          geometry: {
            type: "Point",
            coordinates: localPoint(
              runway,
              origin - direction * Math.max(50, width * 1.15),
              0
            )
          }
        });
      }
    }
  }

  return {
    markings: { type: "FeatureCollection", features: markings },
    labels: { type: "FeatureCollection", features: labels }
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
    "aiming" | "touchdown" | "edge",
  coordinates: [[number, number], [number, number]]
): Feature<LineString> {
  return {
    type: "Feature",
    properties: { id, kind },
    geometry: { type: "LineString", coordinates }
  };
}

function runwayBearing(runway: LocalRunway): number {
  return (
    Math.atan2(runway.along[0], runway.along[1]) * 180 / Math.PI + 360
  ) % 360;
}

function normalizeAviationHeading(value: number): number {
  const rounded = Math.round((value % 360 + 360) % 360);
  return rounded === 0 ? 360 : rounded;
}
