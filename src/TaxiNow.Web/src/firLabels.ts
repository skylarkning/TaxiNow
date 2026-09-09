export interface FirLabel {
  id: string;
  name: string;
  longitude: number;
  latitude: number;
}

export function parseFirLabels(value: unknown): FirLabel[] {
  if (!value || typeof value !== 'object') return [];
  const features = (value as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];
  const labels: FirLabel[] = [];
  for (const feature of features) {
    if (!feature || typeof feature !== 'object') continue;
    const properties = (feature as { properties?: unknown }).properties;
    if (!properties || typeof properties !== 'object') continue;
    const item = properties as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const longitude = Number(item.label_lon), latitude = Number(item.label_lat);
    if (!id || !Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) continue;
    const fullName = typeof item.name === 'string' ? item.name.trim() : id;
    const prefix = `${id} · `;
    labels.push({ id, name: fullName.startsWith(prefix) ? fullName.slice(prefix.length) : fullName, longitude, latitude });
  }
  return labels;
}
