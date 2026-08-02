import { describe, expect, it } from "vitest";
import type { AirportFeature } from "./contracts";
import ciyyzFixture from "../../../tests/fixtures/airport-maps/CYYZ.v2.json";
import type { AirportMap } from "./contracts";
import {
  buildTaxiGraph,
  listGateDestinations,
  listRunwayDestinations,
  listTaxiwayRefs,
  planCustomTaxiRoute,
  planTaxiRoutes,
  suggestTaxiwayRefs,
  updateTaxiRouteProgress
} from "./taxiRouting";

function feature(
  id: string,
  kind: AirportFeature["kind"],
  points: [number, number][],
  ref: string | null
): AirportFeature {
  return {
    id,
    kind,
    points,
    ref,
    name: null,
    widthMeters: kind === "runway" ? 45 : null,
    headingDegrees: null,
    closed: false,
    source: "test"
  };
}

const airport: AirportFeature[] = [
  feature("a", "taxiway", [[0, 0], [0.001, 0], [0.002, 0]], "A"),
  feature("h", "taxiway", [[0.001, 0], [0.001, 0.001]], "H"),
  feature("q", "taxiway", [[0.001, 0.001], [0.002, 0.001]], "Q"),
  feature("b", "taxiway", [[0, 0], [0, 0.001], [0.002, 0.001]], "B"),
  feature("gate", "gate", [[0, 0]], "105"),
  feature("runway", "runway", [[0.002, 0.001], [0.012, 0.001]], "09/27")
];

describe("taxi routing", () => {
  it("lists gate and correctly oriented runway destinations", () => {
    expect(listGateDestinations(airport).map((item) => item.ref)).toEqual(["105"]);
    expect(listRunwayDestinations(airport).map((item) => item.ref)).toEqual([
      "09",
      "27"
    ]);
  });

  it("finds sensible alternative routes and describes their taxiways", () => {
    const graph = buildTaxiGraph(airport);
    const destination = listRunwayDestinations(airport).find(
      (item) => item.ref === "09"
    )!;
    const routes = planTaxiRoutes(graph, [0, 0], destination, "Gate 105", 5);

    expect(routes.length).toBeGreaterThanOrEqual(2);
    expect(routes[0]!.summary).toMatch(/^Gate 105 → /);
    expect(routes[0]!.summary).toContain("RWY09");
    expect(routes.every((route) => route.distanceMeters > 0)).toBe(true);
  });

  it("prefers a highly connected main taxiway over a marginal shortcut", () => {
    const features = [
      feature("main", "taxiway", [
        [0, 0],
        [0.0005, 0.0001],
        [0.001, 0.00012],
        [0.0015, 0.0001],
        [0.002, 0]
      ], "A"),
      feature("shortcut", "taxiway", [[0, 0], [0.002, 0]], "Z"),
      feature("branch-b", "taxiway", [[0.0005, 0.0001], [0.0005, 0.0005]], "B"),
      feature("branch-c", "taxiway", [[0.001, 0.00012], [0.001, 0.0005]], "C"),
      feature("branch-d", "taxiway", [[0.0015, 0.0001], [0.0015, 0.0005]], "D"),
      feature("destination", "runway", [[0.002, 0], [0.012, 0]], "09/27")
    ];
    const graph = buildTaxiGraph(features);
    const destination = listRunwayDestinations(features).find(
      (item) => item.ref === "09"
    )!;

    const route = planTaxiRoutes(graph, [0, 0], destination, "Aircraft", 1)[0]!;

    expect(graph.refImportance.get("A")).toBeGreaterThan(
      graph.refImportance.get("Z") ?? 0
    );
    expect(route.summary).toContain(" → A → ");
    expect(route.summary).not.toContain(" → Z → ");
  });

  it("follows a valid customized taxiway sequence in order", () => {
    const graph = buildTaxiGraph(airport);
    const destination = listRunwayDestinations(airport).find(
      (item) => item.ref === "09"
    )!;
    const route = planCustomTaxiRoute(
      graph,
      [0, 0],
      destination,
      ["A", "H", "Q"],
      "Gate 105"
    );

    expect(route?.custom).toBe(true);
    expect(route?.summary).toBe("Gate 105 → A → H → Q → RWY09");
    expect(route?.coordinates.length).toBeGreaterThan(3);
  });

  it("rejects unavailable custom taxiways and suggests close map labels", () => {
    const graph = buildTaxiGraph(airport);
    const destination = listRunwayDestinations(airport)[0]!;

    expect(listTaxiwayRefs(graph)).toEqual(["A", "B", "H", "Q"]);
    expect(suggestTaxiwayRefs(graph, "A1")).toContain("A");
    expect(
      planCustomTaxiRoute(graph, [0, 0], destination, ["A1", "H"])
    ).toBeNull();
  });

  it("prefers a similarly prefixed taxiway when suggesting a typo fix", () => {
    const graph = buildTaxiGraph([
      feature("eight", "taxiway", [[0, 0], [0.001, 0]], "8"),
      feature("eb", "taxiway", [[0, 0], [0, 0.001]], "EB")
    ]);

    expect(suggestTaxiwayRefs(graph, "E8", 1)).toEqual(["EB"]);
  });

  it("clears passed geometry and produces a turn instruction", () => {
    const graph = buildTaxiGraph(airport);
    const destination = listRunwayDestinations(airport).find(
      (item) => item.ref === "09"
    )!;
    const route = planTaxiRoutes(graph, [0, 0], destination, "Gate 105", 1)[0]!;
    const progress = updateTaxiRouteProgress(route, [0.0008, 0]);

    expect(progress.remainingCoordinates.length).toBeLessThanOrEqual(
      route.coordinates.length
    );
    expect(progress.remainingMeters).toBeLessThan(route.distanceMeters);
    expect(["left", "right", "straight", "arrive"]).toContain(
      progress.maneuver
    );

    const later = updateTaxiRouteProgress(route, [0.001, 0.0007]);
    const noisyBackwardSample = updateTaxiRouteProgress(
      route,
      [0.0002, 0],
      later.segmentIndex
    );
    expect(noisyBackwardSample.segmentIndex).toBeGreaterThanOrEqual(
      later.segmentIndex
    );
    expect(noisyBackwardSample.remainingCoordinates[1]).not.toEqual(
      route.coordinates[1]
    );
  });

  it("recognizes a curved taxiway transition as an upcoming right turn", () => {
    const route = {
      id: "curved-transition",
      coordinates: [
        [0, 0],
        [0, -0.001],
        [0, -0.00112],
        [-0.00025, -0.00135],
        [-0.00055, -0.00135]
      ] as [number, number][],
      edgeRefs: ["E", "H1", "H1", "H1"],
      distanceMeters: 200,
      score: 200,
      turnCount: 1,
      summary: "Aircraft → E → H1 → RWY01L",
      destination: {
        kind: "runway" as const,
        ref: "01L",
        label: "RWY01L",
        coordinate: [-0.00055, -0.00135] as [number, number]
      }
    };

    const progress = updateTaxiRouteProgress(route, [0, -0.0005]);

    expect(progress.currentRef).toBe("E");
    expect(progress.nextRef).toBe("H1");
    expect(progress.maneuver).toBe("right");
    expect(progress.distanceToManeuverMeters).toBeGreaterThan(40);
  });

  it("does not route over a closed taxiway", () => {
    const closed = { ...airport[0]!, closed: true };
    const graph = buildTaxiGraph([closed, ...airport.slice(1)]);
    const destination = listRunwayDestinations(airport)[0]!;
    const routes = planTaxiRoutes(graph, [0, 0], destination, "Gate 105", 5);

    expect(routes.every((route) => !route.summary.includes(" A "))).toBe(true);
  });

  it("routes across the bundled CYYZ map from gate B19 to runway 23", () => {
    const fixture = ciyyzFixture as unknown as AirportMap;
    const gates = listGateDestinations(fixture.features);
    const start = gates.find((gate) =>
      gate.ref.toUpperCase().split(/[\/,]/).includes("B19")
    )!;
    const destination = listRunwayDestinations(fixture.features).find(
      (runway) => runway.ref === "23"
    )!;

    const routes = planTaxiRoutes(
      buildTaxiGraph(fixture.features),
      start.coordinate,
      destination,
      "Gate B19",
      5
    );

    expect(routes.length).toBeGreaterThanOrEqual(3);
    expect(routes.length).toBeLessThanOrEqual(5);
    expect(routes[0]!.summary).toMatch(/^Gate B19 → .*RWY23$/);
  });

  it("accepts a displayed CYYZ taxiway sequence as a custom route", () => {
    const fixture = ciyyzFixture as unknown as AirportMap;
    const destination = listRunwayDestinations(fixture.features).find(
      (runway) => runway.ref === "23"
    )!;
    const route = planCustomTaxiRoute(
      buildTaxiGraph(fixture.features),
      [-79.62991, 43.67643],
      destination,
      ["EB", "E", "H", "Q"]
    );

    expect(route?.summary).toBe("Aircraft → EB → E → H → Q → RWY23");
  });
});
