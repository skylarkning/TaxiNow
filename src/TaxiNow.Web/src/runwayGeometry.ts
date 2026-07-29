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

    markings.push(lineFeature(
      feature.id,
      "centerline",
      localLine(runway, threshold + width, 0, runway.length - threshold - width, 0)
    ));

    const designators = (feature.ref ?? "").split("/");
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

      const text = designators[end] ?? designators[0] ?? "";
      if (text) {
        labels.push({
          type: "Feature",
          properties: {
            text,
            rotation: runwayBearing(runway) + (end === 0 ? 0 : 180)
          },
          geometry: {
            type: "Point",
            coordinates: localPoint(
              runway,
              origin + direction * (threshold + width * 1.15),
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
  kind: "centerline" | "threshold" | "aiming",
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
