export interface RadarFrame {
  observedAtUnix: number;
  tileUrl: string;
}

export interface WeatherMotion {
  position: [number, number];
  speedKnots: number;
  bearingDegrees: number;
}

export interface RadarTilePoint {
  tileX: number;
  tileY: number;
  pixelX: number;
  pixelY: number;
}

interface RainViewerMetadata {
  host?: unknown;
  radar?: { past?: Array<{ time?: unknown; path?: unknown }> };
}

export function latestRadarFrame(value: unknown): RadarFrame | null {
  if (!value || typeof value !== 'object') return null;
  const metadata = value as RainViewerMetadata;
  if (typeof metadata.host !== 'string' || !metadata.host.startsWith('https://')) return null;
  const frames = metadata.radar?.past;
  if (!Array.isArray(frames)) return null;
  const valid = frames.filter((frame): frame is { time: number; path: string } =>
    Number.isFinite(frame.time) && typeof frame.path === 'string' && frame.path.startsWith('/'));
  if (!valid.length) return null;
  const newest = valid.reduce((latest, frame) => frame.time > latest.time ? frame : latest);
  return {
    observedAtUnix: newest.time,
    tileUrl: `${metadata.host}${newest.path}/256/{z}/{x}/{y}/2/1_1.png`
  };
}

export function parseWeatherMotion(value: unknown): WeatherMotion[] {
  const samples = Array.isArray(value) ? value : [value];
  const output: WeatherMotion[] = [];
  for (const sample of samples) {
    if (!sample || typeof sample !== 'object') continue;
    const item = sample as { latitude?: unknown; longitude?: unknown; current?: unknown };
    if (!item.current || typeof item.current !== 'object') continue;
    const current = item.current as Record<string, unknown>;
    const latitude = Number(item.latitude), longitude = Number(item.longitude);
    const speedKnots = Number(current.wind_speed_700hPa);
    const directionFrom = Number(current.wind_direction_700hPa);
    if (![latitude, longitude, speedKnots, directionFrom].every(Number.isFinite) ||
        Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
    output.push({
      position: [longitude, latitude],
      speedKnots,
      bearingDegrees: (directionFrom + 180) % 360
    });
  }
  return output;
}

export function radarTilePoint(position: [number, number], zoom: number): RadarTilePoint {
  const level = Math.max(0, Math.floor(zoom));
  const tileCount = 2 ** level;
  const longitude = ((position[0] + 180) % 360 + 360) % 360 - 180;
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, position[1]));
  const globalX = (longitude + 180) / 360 * tileCount * 256;
  const latitudeRadians = latitude * Math.PI / 180;
  const globalY = (1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2 * tileCount * 256;
  return {
    tileX: Math.min(tileCount - 1, Math.floor(globalX / 256)),
    tileY: Math.min(tileCount - 1, Math.floor(globalY / 256)),
    pixelX: Math.min(255, Math.max(0, Math.floor(globalX) % 256)),
    pixelY: Math.min(255, Math.max(0, Math.floor(globalY) % 256))
  };
}

export function hasRadarEcho(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius = 5
): boolean {
  const left = Math.max(0, centerX - radius), right = Math.min(width - 1, centerX + radius);
  const top = Math.max(0, centerY - radius), bottom = Math.min(height - 1, centerY + radius);
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if ((pixels[(y * width + x) * 4 + 3] ?? 0) >= 20) return true;
    }
  }
  return false;
}
