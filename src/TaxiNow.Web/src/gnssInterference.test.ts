import { describe, expect, it } from 'vitest';
import { loadGnssInterference, parseGnssInterference } from './gnssInterference';

describe('parseGnssInterference', () => {
  it('keeps valid FIR warnings and separates spoofing from other interference', () => {
    expect(parseGnssInterference({ observedOn: '2026-09-09', isStale: false, regions: [
      { rank: 1, region: 'EUR', icao: 'LTAA', name: 'ANKARA', spoofing: false, reported: true },
      { rank: 2, region: 'EUR', icao: 'EPWW', name: 'WARSZAWA', spoofing: true, reported: true },
      { rank: 3, region: 'EUR', icao: 'bad', name: '', spoofing: false, reported: false }
    ] })).toEqual({
      observedOn: '2026-09-09', isStale: false,
      interferenceIds: ['LTAA'], spoofingIds: ['EPWW'],
      regions: [
        { rank: 1, region: 'EUR', icao: 'LTAA', name: 'ANKARA', spoofing: false, reported: true },
        { rank: 2, region: 'EUR', icao: 'EPWW', name: 'WARSZAWA', spoofing: true, reported: true }
      ]
    });
  });

  it('rejects malformed responses', () => {
    expect(parseGnssInterference(null)).toBeNull();
    expect(parseGnssInterference({ observedOn: '', regions: [] })).toBeNull();
  });

  it('uses the bundled snapshot when the live endpoint is unavailable', async () => {
    const requested: string[] = [];
    const request: typeof fetch = async input => {
      const url = String(input);
      requested.push(url);
      if (url.includes('/api/')) return new Response('', { status: 502 });
      return new Response(JSON.stringify({
        observedOn: '2026-09-09', isStale: true, regions: [
          { rank: 1, region: 'EUR', icao: 'LTAA', name: 'ANKARA', spoofing: false, reported: true }
        ]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const feed = await loadGnssInterference(request);

    expect(requested).toEqual(['/api/v1/integrations/gnss/interference', '/easa-gnss-seven-day.json']);
    expect(feed?.isStale).toBe(true);
    expect(feed?.interferenceIds).toEqual(['LTAA']);
  });

});
