export interface RadarFrame {
  observedAtUnix: number;
  tileUrl: string;
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
