import { describe, expect, it, vi } from 'vitest';
import { fetchLatestSimBriefPlan, filterSimBriefNavigation } from './simBriefClient';

describe('SimBrief client', () => {
  it('uses the local integration when it succeeds', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"origin":{}}', { status: 200 }));

    await fetchLatestSimBriefPlan('Pilot Name', undefined, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const localCall = fetcher.mock.calls[0];
    expect(localCall).toBeDefined();
    expect(String(localCall![0])).toContain('/api/v1/integrations/simbrief/plan?');
    expect(String(localCall![0])).toContain('kind=username');
    expect(String(localCall![0])).toContain('identifier=Pilot+Name');
  });

  it('falls back to the official CORS endpoint when the local TLS proxy is unavailable', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 502 }))
      .mockResolvedValueOnce(new Response('{"origin":{}}', { status: 200 }));

    const response = await fetchLatestSimBriefPlan('stewie', undefined, fetcher);

    expect(response.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const fallbackCall = fetcher.mock.calls[1];
    expect(fallbackCall).toBeDefined();
    expect(String(fallbackCall![0])).toBe(
      'https://www.simbrief.com/api/xml.fetcher.php?username=stewie&json=v2'
    );
  });

  it('keeps a not-found response without making a second request', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 400 }));

    const response = await fetchLatestSimBriefPlan('missing', undefined, fetcher);

    expect(response.status).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps only navigation fields from an official response', () => {
    const filtered = filterSimBriefNavigation({
      origin: { icao_code: 'ZBAA' },
      navlog: { fix: [] },
      times: { sched_out: '1791244800', est_time_enroute: '7200' },
      pilot: { name: 'Private' },
      files: { pdf: 'private-url' }
    });

    expect(filtered).toEqual({
      origin: { icao_code: 'ZBAA' },
      navlog: { fix: [] },
      times: { sched_out: '1791244800', est_time_enroute: '7200' }
    });
  });
});
