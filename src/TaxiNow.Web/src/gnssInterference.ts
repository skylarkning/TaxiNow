export interface GnssInterferenceRegion {
  rank: number;
  region: string;
  icao: string;
  name: string;
  spoofing: boolean;
  reported: boolean;
}

export interface GnssInterference {
  observedOn: string;
  isStale: boolean;
  interferenceIds: string[];
  spoofingIds: string[];
  regions: GnssInterferenceRegion[];
}

export function parseGnssInterference(value: unknown): GnssInterference | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as { observedOn?: unknown; isStale?: unknown; regions?: unknown };
  if (typeof input.observedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.observedOn) || !Array.isArray(input.regions)) return null;
  const regions: GnssInterferenceRegion[] = [];
  for (const entry of input.regions) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const icao = typeof item.icao === 'string' ? item.icao.trim().toUpperCase() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const rank = Number(item.rank);
    if (!/^[A-Z0-9]{4}$/.test(icao) || !name || !Number.isInteger(rank) || rank < 1) continue;
    regions.push({
      rank,
      region: typeof item.region === 'string' ? item.region.trim().toUpperCase() : '',
      icao,
      name,
      spoofing: item.spoofing === true,
      reported: item.reported === true
    });
  }
  if (!regions.length) return null;
  return {
    observedOn: input.observedOn,
    isStale: input.isStale === true,
    interferenceIds: regions.filter(region => !region.spoofing).map(region => region.icao),
    spoofingIds: regions.filter(region => region.spoofing).map(region => region.icao),
    regions
  };
}

export async function loadGnssInterference(request: typeof fetch = fetch): Promise<GnssInterference | null> {
  for (const url of ['/api/v1/integrations/gnss/interference', '/easa-gnss-seven-day.json']) {
    try {
      const response = await request(url, { signal: AbortSignal.timeout(18_000) });
      if (!response.ok) continue;
      const feed = parseGnssInterference(await response.json());
      if (feed) return feed;
    } catch { /* Try the bundled EASA snapshot. */ }
  }
  return null;
}
