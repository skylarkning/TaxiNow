import type { AirportFeature } from "./contracts";
import { runwayEndDesignators } from "./runwayGeometry";

export type Coordinate = [number, number];

interface GraphNode {
  id: number;
  coordinate: Coordinate;
  x: number;
  y: number;
  edges: GraphEdge[];
}

interface GraphEdge {
  to: number;
  distanceMeters: number;
  ref: string;
  featureId: string;
  key: string;
}

export interface TaxiGraph {
  nodes: GraphNode[];
  referenceLatitude: number;
}

export interface TaxiDestination {
  kind: "runway" | "gate";
  ref: string;
  label: string;
  coordinate: Coordinate;
}

export interface TaxiRoute {
  id: string;
  coordinates: Coordinate[];
  edgeRefs: string[];
  distanceMeters: number;
  score: number;
  turnCount: number;
  summary: string;
  destination: TaxiDestination;
}

export interface TaxiRouteProgress {
  segmentIndex: number;
  projection: Coordinate;
  remainingCoordinates: Coordinate[];
  remainingMeters: number;
  offRouteMeters: number;
  currentRef: string;
  nextRef: string | null;
  maneuver: "left" | "right" | "straight" | "arrive";
  distanceToManeuverMeters: number;
}

interface SearchState {
  node: number;
  previousNode: number | null;
  previousRef: string;
  cost: number;
  distanceMeters: number;
  key: string;
}

interface SearchResult {
  nodes: number[];
  edges: GraphEdge[];
  cost: number;
  distanceMeters: number;
}

const earthRadiusMeters = 6_371_000;
const nodeMergeMeters = 2.5;
const unnamedRef = "";

export function buildTaxiGraph(features: AirportFeature[]): TaxiGraph {
  const routable = features.filter((feature) =>
    !feature.closed &&
    (feature.kind === "taxiway" || feature.kind === "taxilane") &&
    feature.points.length >= 2
  );
  const allPoints = routable.flatMap((feature) => feature.points);
  const referenceLatitude = allPoints.length
    ? allPoints.reduce((sum, point) => sum + point[1], 0) / allPoints.length
    : 0;
  const nodes: GraphNode[] = [];
  const cells = new Map<string, number[]>();

  const getNode = (coordinate: Coordinate): GraphNode => {
    const projected = projectMeters(coordinate, referenceLatitude);
    const cellX = Math.floor(projected[0] / nodeMergeMeters);
    const cellY = Math.floor(projected[1] / nodeMergeMeters);
    let nearest: GraphNode | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const id of cells.get(`${cellX + dx}:${cellY + dy}`) ?? []) {
          const candidate = nodes[id]!;
          const distance = Math.hypot(
            candidate.x - projected[0],
            candidate.y - projected[1]
          );
          if (distance <= nodeMergeMeters && distance < nearestDistance) {
            nearest = candidate;
            nearestDistance = distance;
          }
        }
      }
    }
    if (nearest) {
      return nearest;
    }
    const node: GraphNode = {
      id: nodes.length,
      coordinate: [...coordinate] as Coordinate,
      x: projected[0],
      y: projected[1],
      edges: []
    };
    nodes.push(node);
    const cellKey = `${cellX}:${cellY}`;
    const bucket = cells.get(cellKey) ?? [];
    bucket.push(node.id);
    cells.set(cellKey, bucket);
    return node;
  };

  for (const feature of routable) {
    const ref = normalizeTaxiwayRef(feature.ref ?? feature.name ?? "");
    for (let index = 1; index < feature.points.length; index++) {
      const from = getNode(feature.points[index - 1]!);
      const to = getNode(feature.points[index]!);
      if (from.id === to.id) {
        continue;
      }
      const distanceMeters = Math.hypot(to.x - from.x, to.y - from.y);
      if (!Number.isFinite(distanceMeters) || distanceMeters < 0.25) {
        continue;
      }
      const key = from.id < to.id
        ? `${from.id}:${to.id}:${feature.id}`
        : `${to.id}:${from.id}:${feature.id}`;
      from.edges.push({
        to: to.id,
        distanceMeters,
        ref,
        featureId: feature.id,
        key
      });
      to.edges.push({
        to: from.id,
        distanceMeters,
        ref,
        featureId: feature.id,
        key
      });
    }
  }

  return { nodes, referenceLatitude };
}

export function listRunwayDestinations(
  features: AirportFeature[]
): TaxiDestination[] {
  const destinations: TaxiDestination[] = [];
  for (const feature of features) {
    if (feature.kind !== "runway" || feature.closed || feature.points.length < 2) {
      continue;
    }
    const start = feature.points[0]!;
    const end = feature.points.at(-1)!;
    const designators = runwayEndDesignators(feature.ref, start, end);
    for (const endpoint of [0, 1] as const) {
      const ref = designators[endpoint]?.trim();
      if (!ref) {
        continue;
      }
      destinations.push({
        kind: "runway",
        ref,
        label: `RWY${ref}`,
        coordinate: [...(endpoint === 0 ? start : end)] as Coordinate
      });
    }
  }
  return uniqueDestinations(destinations);
}

export function listGateDestinations(
  features: AirportFeature[]
): TaxiDestination[] {
  const destinations: TaxiDestination[] = [];
  for (const feature of features) {
    if (
      feature.closed ||
      (feature.kind !== "gate" && feature.kind !== "parking_position") ||
      feature.points.length === 0
    ) {
      continue;
    }
    const ref = (feature.ref ?? feature.name ?? "").trim();
    if (!ref) {
      continue;
    }
    destinations.push({
      kind: "gate",
      ref,
      label: `Gate ${ref}`,
      coordinate: [...feature.points[0]!] as Coordinate
    });
  }
  return uniqueDestinations(destinations);
}

export function nearestStandLabel(
  features: AirportFeature[],
  coordinate: Coordinate,
  maximumMeters = 90
): string {
  let nearest = "Aircraft";
  let distance = maximumMeters;
  for (const destination of listGateDestinations(features)) {
    const candidateDistance = geographicDistanceMeters(
      coordinate,
      destination.coordinate
    );
    if (candidateDistance < distance) {
      nearest = destination.label;
      distance = candidateDistance;
    }
  }
  return nearest;
}

export function planTaxiRoutes(
  graph: TaxiGraph,
  start: Coordinate,
  destination: TaxiDestination,
  startLabel = "Aircraft",
  maximumRoutes = 5
): TaxiRoute[] {
  if (graph.nodes.length === 0) {
    return [];
  }
  const startNode = nearestNode(graph, start);
  const destinationNode = nearestNode(graph, destination.coordinate);
  if (startNode === null || destinationNode === null) {
    return [];
  }

  const routes: TaxiRoute[] = [];
  const edgePenalties = new Map<string, number>();
  const signatures = new Set<string>();
  const attempts = Math.max(10, maximumRoutes * 5);
  let primaryDistance = 0;
  let primaryScore = 0;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = searchRoute(
      graph,
      startNode,
      destinationNode,
      edgePenalties,
      attempt
    );
    if (!result) {
      break;
    }
    const signature = result.edges.map((edge) => edge.key).join("|");
    const route = makeRoute(
      graph,
      result,
      start,
      destination,
      startLabel,
      routes.length
    );
    if (routes.length === 0) {
      primaryDistance = route.distanceMeters;
      primaryScore = route.score;
    }
    const reasonable = routes.length === 0 || (
      route.distanceMeters <= primaryDistance * 2.4 + 300 &&
      route.score <= primaryScore * 3 + 420
    );
    if (!signatures.has(signature) && reasonable) {
      signatures.add(signature);
      routes.push(route);
    }
    for (const edge of result.edges) {
      edgePenalties.set(
        edge.key,
        (edgePenalties.get(edge.key) ?? 0) +
          Math.max(28, edge.distanceMeters * (0.8 + attempt * 0.08))
      );
    }
    if (routes.length >= maximumRoutes) {
      break;
    }
  }

  return routes.sort((left, right) => left.score - right.score);
}

export function updateTaxiRouteProgress(
  route: TaxiRoute,
  position: Coordinate,
  previousSegmentIndex = 0
): TaxiRouteProgress {
  if (route.coordinates.length < 2) {
    return {
      segmentIndex: 0,
      projection: position,
      remainingCoordinates: [position],
      remainingMeters: 0,
      offRouteMeters: 0,
      currentRef: "",
      nextRef: null,
      maneuver: "arrive",
      distanceToManeuverMeters: 0
    };
  }
  // Navigation progress is intentionally monotonic. GPS/interpolation noise may
  // briefly place the aircraft behind its last matched segment; starting the
  // search at the previously passed segment keeps cleared guidance from
  // reappearing on the map.
  const first = Math.max(
    0,
    Math.min(previousSegmentIndex, route.coordinates.length - 2)
  );
  let nearestIndex = first;
  let nearestProjection = route.coordinates[first]!;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = first; index < route.coordinates.length - 1; index++) {
    const projected = projectPointToSegment(
      position,
      route.coordinates[index]!,
      route.coordinates[index + 1]!
    );
    if (projected.distanceMeters < nearestDistance) {
      nearestDistance = projected.distanceMeters;
      nearestIndex = index;
      nearestProjection = projected.coordinate;
    }
  }

  const currentRef = route.edgeRefs[nearestIndex] ?? "";
  let transitionIndex = -1;
  let nextRef: string | null = null;
  for (let index = nearestIndex + 1; index < route.edgeRefs.length; index++) {
    const candidate = route.edgeRefs[index] ?? "";
    if (candidate && candidate !== currentRef) {
      transitionIndex = index;
      nextRef = candidate;
      break;
    }
  }

  let distanceToManeuverMeters = geographicDistanceMeters(
    nearestProjection,
    route.coordinates[nearestIndex + 1]!
  );
  const distanceLimit = transitionIndex >= 0
    ? transitionIndex
    : route.coordinates.length - 1;
  for (let index = nearestIndex + 1; index < distanceLimit; index++) {
    distanceToManeuverMeters += geographicDistanceMeters(
      route.coordinates[index]!,
      route.coordinates[index + 1]!
    );
  }

  let maneuver: TaxiRouteProgress["maneuver"] = "arrive";
  if (transitionIndex >= 0 && nextRef) {
    const inboundStart = route.coordinates[Math.max(0, transitionIndex - 1)]!;
    const turn = route.coordinates[transitionIndex]!;
    const outboundEnd = route.coordinates[Math.min(
      route.coordinates.length - 1,
      transitionIndex + 1
    )]!;
    const delta = signedBearingDelta(
      coordinateBearing(inboundStart, turn),
      coordinateBearing(turn, outboundEnd)
    );
    maneuver = Math.abs(delta) < 28
      ? "straight"
      : delta > 0 ? "right" : "left";
  }

  let remainingMeters = geographicDistanceMeters(
    nearestProjection,
    route.coordinates[nearestIndex + 1]!
  );
  for (let index = nearestIndex + 1; index < route.coordinates.length - 1; index++) {
    remainingMeters += geographicDistanceMeters(
      route.coordinates[index]!,
      route.coordinates[index + 1]!
    );
  }

  return {
    segmentIndex: Math.max(previousSegmentIndex, nearestIndex),
    projection: nearestProjection,
    remainingCoordinates: [
      nearestProjection,
      ...route.coordinates.slice(nearestIndex + 1)
    ],
    remainingMeters,
    offRouteMeters: nearestDistance,
    currentRef,
    nextRef,
    maneuver,
    distanceToManeuverMeters
  };
}

function searchRoute(
  graph: TaxiGraph,
  startNode: number,
  destinationNode: number,
  edgePenalties: Map<string, number>,
  attempt: number
): SearchResult | null {
  const queue: SearchState[] = [];
  const best = new Map<string, number>();
  const previous = new Map<string, { state: string; edge: GraphEdge }>();
  const initial: SearchState = {
    node: startNode,
    previousNode: null,
    previousRef: "",
    cost: 0,
    distanceMeters: 0,
    key: `${startNode}|`
  };
  queue.push(initial);
  best.set(initial.key, 0);
  let finalState: SearchState | null = null;

  while (queue.length > 0) {
    queue.sort((left, right) => left.cost - right.cost);
    const current = queue.shift()!;
    if (current.cost > (best.get(current.key) ?? Number.POSITIVE_INFINITY)) {
      continue;
    }
    if (current.node === destinationNode) {
      finalState = current;
      break;
    }
    const node = graph.nodes[current.node]!;
    for (const edge of node.edges) {
      if (edge.to === current.previousNode) {
        continue;
      }
      const nextNode = graph.nodes[edge.to]!;
      const turnPenalty = current.previousNode === null
        ? 0
        : calculateTurnPenalty(
          graph.nodes[current.previousNode]!,
          node,
          nextNode
        );
      const refChangePenalty = current.previousRef && edge.ref &&
        current.previousRef !== edge.ref ? 16 : 0;
      const unnamedPenalty = edge.ref ? 0 : 5;
      const alternativePenalty = edgePenalties.get(edge.key) ?? 0;
      const deterministicJitter = attempt === 0
        ? 0
        : ((hashString(`${edge.key}:${attempt}`) % 17) / 17) * 3;
      const cost = current.cost + edge.distanceMeters + turnPenalty +
        refChangePenalty + unnamedPenalty + alternativePenalty +
        deterministicJitter;
      const key = `${edge.to}|${edge.ref}|${current.node}`;
      if (cost >= (best.get(key) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }
      best.set(key, cost);
      previous.set(key, { state: current.key, edge });
      queue.push({
        node: edge.to,
        previousNode: current.node,
        previousRef: edge.ref,
        cost,
        distanceMeters: current.distanceMeters + edge.distanceMeters,
        key
      });
    }
  }

  if (!finalState) {
    return null;
  }
  const nodes = [finalState.node];
  const edges: GraphEdge[] = [];
  let key = finalState.key;
  while (key !== initial.key) {
    const link = previous.get(key);
    if (!link) {
      return null;
    }
    edges.push(link.edge);
    const priorNode = Number(link.state.split("|")[0]);
    nodes.push(priorNode);
    key = link.state;
  }
  nodes.reverse();
  edges.reverse();
  return {
    nodes,
    edges,
    cost: finalState.cost,
    distanceMeters: finalState.distanceMeters
  };
}

function makeRoute(
  graph: TaxiGraph,
  result: SearchResult,
  start: Coordinate,
  destination: TaxiDestination,
  startLabel: string,
  index: number
): TaxiRoute {
  const graphCoordinates = result.nodes.map(
    (node) => graph.nodes[node]!.coordinate
  );
  const coordinates = deduplicateCoordinates([
    start,
    ...graphCoordinates,
    ...(destination.kind === "gate" ? [destination.coordinate] : [])
  ]);
  const leadingConnector = geographicDistanceMeters(start, graphCoordinates[0]!) > 0.5;
  const trailingConnector = destination.kind === "gate" &&
    geographicDistanceMeters(graphCoordinates.at(-1)!, destination.coordinate) > 0.5;
  const edgeRefs = [
    ...(leadingConnector ? [result.edges[0]?.ref ?? unnamedRef] : []),
    ...result.edges.map((edge) => edge.ref),
    ...(trailingConnector ? [result.edges.at(-1)?.ref ?? unnamedRef] : [])
  ];
  while (edgeRefs.length < coordinates.length - 1) {
    edgeRefs.push(edgeRefs.at(-1) ?? unnamedRef);
  }
  if (edgeRefs.length > coordinates.length - 1) {
    edgeRefs.length = coordinates.length - 1;
  }
  const refs = compressRefs(edgeRefs);
  const turnCount = countTurns(coordinates);
  const connectorDistance = geographicDistanceMeters(start, graphCoordinates[0]!) +
    (destination.kind === "gate"
      ? geographicDistanceMeters(graphCoordinates.at(-1)!, destination.coordinate)
      : 0);
  const distanceMeters = result.distanceMeters + connectorDistance;
  return {
    id: `taxi-route-${index + 1}`,
    coordinates,
    edgeRefs,
    distanceMeters,
    score: result.cost + connectorDistance,
    turnCount,
    summary: [startLabel, ...refs, destination.label].join(" → "),
    destination
  };
}

function nearestNode(graph: TaxiGraph, coordinate: Coordinate): number | null {
  if (graph.nodes.length === 0) {
    return null;
  }
  const [x, y] = projectMeters(coordinate, graph.referenceLatitude);
  let nearest = graph.nodes[0]!;
  let distance = Number.POSITIVE_INFINITY;
  for (const node of graph.nodes) {
    const candidate = (node.x - x) ** 2 + (node.y - y) ** 2;
    if (candidate < distance) {
      nearest = node;
      distance = candidate;
    }
  }
  return nearest.id;
}

function uniqueDestinations(destinations: TaxiDestination[]): TaxiDestination[] {
  const seen = new Set<string>();
  return destinations
    .filter((destination) => {
      const key = `${destination.kind}:${destination.ref.toUpperCase()}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.ref.localeCompare(right.ref, undefined, {
      numeric: true,
      sensitivity: "base"
    }));
}

function normalizeTaxiwayRef(value: string): string {
  const trimmed = value.trim().toUpperCase();
  return trimmed.length <= 12 ? trimmed : "";
}

function compressRefs(refs: string[]): string[] {
  const result: string[] = [];
  for (const ref of refs) {
    if (!ref || result.at(-1) === ref) {
      continue;
    }
    result.push(ref);
  }
  return result;
}

function calculateTurnPenalty(
  previous: GraphNode,
  current: GraphNode,
  next: GraphNode
): number {
  const inbound = Math.atan2(current.y - previous.y, current.x - previous.x);
  const outbound = Math.atan2(next.y - current.y, next.x - current.x);
  const delta = Math.abs(normalizeRadians(outbound - inbound)) * 180 / Math.PI;
  if (delta < 25) {
    return 0;
  }
  if (delta < 55) {
    return 8;
  }
  if (delta < 105) {
    return 24;
  }
  if (delta < 145) {
    return 62;
  }
  return 220;
}

function countTurns(coordinates: Coordinate[]): number {
  let turns = 0;
  for (let index = 1; index < coordinates.length - 1; index++) {
    const delta = Math.abs(signedBearingDelta(
      coordinateBearing(coordinates[index - 1]!, coordinates[index]!),
      coordinateBearing(coordinates[index]!, coordinates[index + 1]!)
    ));
    if (delta >= 35) {
      turns++;
    }
  }
  return turns;
}

function projectPointToSegment(
  point: Coordinate,
  start: Coordinate,
  end: Coordinate
): { coordinate: Coordinate; distanceMeters: number } {
  const latitude = (point[1] + start[1] + end[1]) / 3;
  const p = projectMeters(point, latitude);
  const a = projectMeters(start, latitude);
  const b = projectMeters(end, latitude);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const denominator = dx * dx + dy * dy;
  const fraction = denominator === 0
    ? 0
    : Math.max(0, Math.min(1,
      ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / denominator
    ));
  const coordinate: Coordinate = [
    start[0] + (end[0] - start[0]) * fraction,
    start[1] + (end[1] - start[1]) * fraction
  ];
  return {
    coordinate,
    distanceMeters: Math.hypot(
      p[0] - (a[0] + dx * fraction),
      p[1] - (a[1] + dy * fraction)
    )
  };
}

function deduplicateCoordinates(coordinates: Coordinate[]): Coordinate[] {
  const result: Coordinate[] = [];
  for (const coordinate of coordinates) {
    if (
      !result.length ||
      geographicDistanceMeters(result.at(-1)!, coordinate) > 0.25
    ) {
      result.push([...coordinate] as Coordinate);
    }
  }
  return result;
}

function projectMeters(
  coordinate: Coordinate,
  referenceLatitude: number
): Coordinate {
  const radians = Math.PI / 180;
  return [
    coordinate[0] * radians * earthRadiusMeters *
      Math.cos(referenceLatitude * radians),
    coordinate[1] * radians * earthRadiusMeters
  ];
}

function geographicDistanceMeters(left: Coordinate, right: Coordinate): number {
  const latitude = (left[1] + right[1]) / 2;
  const a = projectMeters(left, latitude);
  const b = projectMeters(right, latitude);
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function coordinateBearing(start: Coordinate, end: Coordinate): number {
  const latitude = (start[1] + end[1]) / 2 * Math.PI / 180;
  const dx = (end[0] - start[0]) * Math.cos(latitude);
  const dy = end[1] - start[1];
  return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
}

function signedBearingDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

function normalizeRadians(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
