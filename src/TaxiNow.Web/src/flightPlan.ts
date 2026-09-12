export type Position = [number, number];
export interface FlightPoint { ident: string; position: Position; airway: string; isProcedure?: boolean }
export interface FlightPlan {
  origin: string; destination: string; originName: string; destinationName: string;
  callsign: string; aircraft: string; altitude: string; route: string;
  points: FlightPoint[]; distance: number; importedAt: string;
}
type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid flight plan');
  return value as RecordValue;
}
function label(value: unknown): string { return typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 12000) : ''; }
function point(value: unknown, airport = false): FlightPoint {
  const obj = record(value);
  const lng = label(obj.pos_long).trim(), lat = label(obj.pos_lat).trim();
  const position: Position = [Number(lng), Number(lat)];
  const ident = label(airport ? obj.icao_code : obj.ident).trim();
  if (!ident || !lng || !lat || !position.every(Number.isFinite) || Math.abs(position[0]) > 180 || Math.abs(position[1]) > 90) {
    throw new Error(`Invalid waypoint: ${ident || '?'}`);
  }
  return { ident: ident.slice(0, 40), position, airway: label(obj.via_airway).slice(0, 40), isProcedure: obj.is_sid_star === true || obj.is_sid_star === 1 || obj.is_sid_star === "1" };
}
export function parseSimBrief(input: unknown): FlightPlan {
  const data = record(input), origin = record(data.origin), destination = record(data.destination);
  const general = record(data.general);
  const navlog = Array.isArray(data.navlog) ? { fix: data.navlog } : record(data.navlog);
  const fixes = Array.isArray(navlog.fix) ? navlog.fix : navlog.fix ? [navlog.fix] : [];
  if (!fixes.length || fixes.length > 3000) throw new Error('Missing or oversized navlog');
  const navPoints = fixes.map(fix => point(fix));
  const arrival = point(destination, true); arrival.isProcedure = navPoints.at(-1)?.isProcedure;
  const all = [point(origin, true), ...navPoints, arrival];
  const points = all.filter((p, i) => i === 0 || distanceNm(all[i - 1]!.position, p.position) > 0.005);
  if (points.length < 2) throw new Error('Route needs distinct points');
  return {
    origin: label(origin.icao_code), destination: label(destination.icao_code),
    originName: label(origin.name), destinationName: label(destination.name),
    callsign: label(general.icao_airline) + label(general.flight_number),
    aircraft: data.aircraft && typeof data.aircraft === 'object' ? label(record(data.aircraft).icaocode) : '',
    altitude: label(general.initial_altitude), route: label(general.route), points,
    distance: points.slice(1).reduce((sum, p, i) => sum + distanceNm(points[i]!.position, p.position), 0),
    importedAt: new Date().toISOString()
  };
}
const rad = Math.PI / 180;
export function distanceNm(a: Position, b: Position): number {
  const h = Math.sin((b[1] - a[1]) * rad / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin((b[0] - a[0]) * rad / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
export function routeCoordinates(points: Position[]): Position[] {
  if (!points.length) return [];
  const output: Position[] = [[...points[0]!]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!, angle = distanceNm(a, b) / 3440.065;
    const count = Math.max(2, Math.ceil(angle / rad));
    for (let j = 1; j <= count; j++) {
      const f = j / count;
      let lon: number, lat: number;
      if (Math.abs(Math.sin(angle)) < 1e-7) {
        // Near-antipodal points have no unique great circle; retain a stable path.
        let delta = b[0] - a[0]; delta -= Math.round(delta / 360) * 360;
        lon = a[0] + delta * f; lat = a[1] + (b[1] - a[1]) * f;
      } else {
        const w1 = Math.sin((1 - f) * angle) / Math.sin(angle), w2 = Math.sin(f * angle) / Math.sin(angle);
        const x = w1 * Math.cos(a[1] * rad) * Math.cos(a[0] * rad) + w2 * Math.cos(b[1] * rad) * Math.cos(b[0] * rad);
        const y = w1 * Math.cos(a[1] * rad) * Math.sin(a[0] * rad) + w2 * Math.cos(b[1] * rad) * Math.sin(b[0] * rad);
        const z = w1 * Math.sin(a[1] * rad) + w2 * Math.sin(b[1] * rad);
        lon = Math.atan2(y, x) / rad; lat = Math.atan2(z, Math.hypot(x, y)) / rad;
      }
      lon += Math.round((output[output.length - 1]![0] - lon) / 360) * 360;
      output.push([lon, lat]);
    }
  }
  return output;
}


export function routeSections(points: FlightPoint[]): { procedure: boolean; coordinates: Position[] }[] {
  const sections: { procedure: boolean; points: Position[] }[] = [];
  for (let i = 1; i < points.length; i++) {
    const procedure = points[i]!.isProcedure === true;
    const previous = sections.at(-1);
    if (previous && previous.procedure === procedure) previous.points.push(points[i]!.position);
    else sections.push({ procedure, points: [points[i - 1]!.position, points[i]!.position] });
  }
  return sections.map(section => ({ procedure: section.procedure, coordinates: routeCoordinates(section.points) }));
}

export function activeRouteLeg(points: FlightPoint[], aircraft: Position): { nextIndex: number; coordinates: Position[] } | undefined {
  if (points.length < 2) return undefined;
  let bestIndex = 1, bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!.position, b = points[i]!.position;
    const meanLat = (aircraft[1] + a[1] + b[1]) / 3 * rad;
    const scale = Math.cos(meanLat);
    const ax = a[0] * scale, ay = a[1], bx = b[0] * scale, by = b[1], px = aircraft[0] * scale, py = aircraft[1];
    const dx = bx - ax, dy = by - ay;
    const fraction = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    const distance = Math.hypot(px - (ax + fraction * dx), py - (ay + fraction * dy));
    if (distance < bestDistance) { bestDistance = distance; bestIndex = i; }
  }
  return { nextIndex: bestIndex, coordinates: routeCoordinates([aircraft, points[bestIndex]!.position]) };
}
