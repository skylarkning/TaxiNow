export type Position = [number, number];
export type AltitudeConstraintKind = 'at' | 'atOrAbove' | 'atOrBelow' | 'between';
export interface FlightPoint {
  ident: string;
  position: Position;
  airway: string;
  isProcedure?: boolean;
  plannedAltitudeFeet?: number;
  constraintKind?: AltitudeConstraintKind;
  minimumAltitudeFeet?: number;
  maximumAltitudeFeet?: number;
}
export interface FlightPlan {
  origin: string; destination: string; originName: string; destinationName: string;
  callsign: string; aircraft: string; altitude: string; route: string;
  points: FlightPoint[]; distance: number; importedAt: string;
  originElevationFeet?: number; destinationElevationFeet?: number;
  departureTimeUtc?: string; estimatedEnrouteSeconds?: number;
}
type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid flight plan');
  return value as RecordValue;
}
function label(value: unknown): string { return typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 12000) : ''; }
function optionalUtcTime(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? value.trim() : value;
  if (raw === '' || (typeof raw !== 'string' && typeof raw !== 'number')) return undefined;
  const numeric = typeof raw === 'number' ? raw : /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : Number.NaN;
  const milliseconds = Number.isFinite(numeric) && numeric > 0
    ? numeric * (numeric < 100_000_000_000 ? 1000 : 1)
    : typeof raw === 'string' ? Date.parse(raw) : Number.NaN;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return undefined;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
function optionalDurationSeconds(value: unknown): number | undefined {
  if (typeof value === 'string' && !value.trim()) return undefined;
  const duration = typeof value === 'number' ? value
    : typeof value === 'string' ? Number(value.trim()) : Number.NaN;
  return Number.isFinite(duration) && duration > 0 && duration <= 7 * 24 * 60 * 60
    ? duration
    : undefined;
}
export function optionalAltitude(value: unknown): number | undefined {
  if (typeof value === 'string' && !value.trim()) return undefined;
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const altitude = typeof value === 'string' ? Number(value.trim()) : value;
  return Number.isFinite(altitude) && altitude >= -2000 && altitude <= 100000 ? altitude : undefined;
}
function constraintKind(value: unknown): AltitudeConstraintKind | undefined {
  const descriptor = typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : typeof value === 'string' ? value.trim().toUpperCase() : '';
  switch (descriptor) {
    case '1': case 'AT': return 'at';
    case '2': case 'AT_OR_ABOVE': return 'atOrAbove';
    case '3': case 'AT_OR_BELOW': return 'atOrBelow';
    case '4': case 'BETWEEN': return 'between';
    default: return undefined;
  }
}
function verticalFields(obj: RecordValue): Pick<FlightPoint, 'plannedAltitudeFeet' | 'constraintKind' | 'minimumAltitudeFeet' | 'maximumAltitudeFeet'> {
  const plannedAltitudeFeet = optionalAltitude(obj.altitude_feet);
  const kind = constraintKind(obj.altitude_desc);
  const first = optionalAltitude(obj.altitude1);
  const second = optionalAltitude(obj.altitude2);
  const fields: Pick<FlightPoint, 'plannedAltitudeFeet' | 'constraintKind' | 'minimumAltitudeFeet' | 'maximumAltitudeFeet'> = {};
  if (plannedAltitudeFeet !== undefined) fields.plannedAltitudeFeet = plannedAltitudeFeet;
  if (!kind || (kind === 'between' && (first === undefined || second === undefined)) ||
      (kind !== 'between' && first === undefined)) {
    return fields;
  }
  fields.constraintKind = kind;
  if (kind === 'at') {
    fields.minimumAltitudeFeet = first;
    fields.maximumAltitudeFeet = first;
  } else if (kind === 'atOrAbove') {
    fields.minimumAltitudeFeet = first;
  } else if (kind === 'atOrBelow') {
    fields.maximumAltitudeFeet = first;
  } else {
    fields.minimumAltitudeFeet = first;
    fields.maximumAltitudeFeet = second;
  }
  return fields;
}
function point(value: unknown, airport = false): FlightPoint {
  const obj = record(value);
  const lng = label(obj.pos_long).trim(), lat = label(obj.pos_lat).trim();
  const position: Position = [Number(lng), Number(lat)];
  const ident = label(airport ? obj.icao_code : obj.ident).trim();
  if (!ident || !lng || !lat || !position.every(Number.isFinite) || Math.abs(position[0]) > 180 || Math.abs(position[1]) > 90) {
    throw new Error(`Invalid waypoint: ${ident || '?'}`);
  }
  return {
    ident: ident.slice(0, 40), position, airway: label(obj.via_airway).slice(0, 40),
    isProcedure: obj.is_sid_star === true || obj.is_sid_star === 1 || obj.is_sid_star === "1",
    ...verticalFields(obj)
  };
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
  const points: FlightPoint[] = [];
  for (const current of all) {
    const previous = points.at(-1);
    if (!previous || distanceNm(previous.position, current.position) > 0.005) {
      points.push(current);
      continue;
    }
    if (current.plannedAltitudeFeet !== undefined) previous.plannedAltitudeFeet = current.plannedAltitudeFeet;
    if (current.constraintKind !== undefined) {
      previous.constraintKind = current.constraintKind;
      delete previous.minimumAltitudeFeet;
      delete previous.maximumAltitudeFeet;
    }
    if (current.minimumAltitudeFeet !== undefined) previous.minimumAltitudeFeet = current.minimumAltitudeFeet;
    if (current.maximumAltitudeFeet !== undefined) previous.maximumAltitudeFeet = current.maximumAltitudeFeet;
  }
  if (points.length < 2) throw new Error('Route needs distinct points');
  const parsed: FlightPlan = {
    origin: label(origin.icao_code), destination: label(destination.icao_code),
    originName: label(origin.name), destinationName: label(destination.name),
    callsign: label(general.icao_airline) + label(general.flight_number),
    aircraft: data.aircraft && typeof data.aircraft === 'object' ? label(record(data.aircraft).icaocode) : '',
    altitude: label(general.initial_altitude), route: label(general.route), points,
    distance: points.slice(1).reduce((sum, p, i) => sum + distanceNm(points[i]!.position, p.position), 0),
    importedAt: new Date().toISOString()
  };
  const originElevationFeet = optionalAltitude(origin.elevation);
  const destinationElevationFeet = optionalAltitude(destination.elevation);
  if (originElevationFeet !== undefined) parsed.originElevationFeet = originElevationFeet;
  if (destinationElevationFeet !== undefined) parsed.destinationElevationFeet = destinationElevationFeet;
  const times = data.times && typeof data.times === 'object' && !Array.isArray(data.times)
    ? data.times as RecordValue
    : undefined;
  const departureTimeUtc = optionalUtcTime(times?.sched_out);
  const estimatedEnrouteSeconds = optionalDurationSeconds(times?.est_time_enroute);
  if (departureTimeUtc !== undefined) parsed.departureTimeUtc = departureTimeUtc;
  if (estimatedEnrouteSeconds !== undefined) parsed.estimatedEnrouteSeconds = estimatedEnrouteSeconds;
  return parsed;
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
