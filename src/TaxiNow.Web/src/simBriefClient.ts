type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const navigationFields = ['origin', 'destination', 'general', 'navlog', 'aircraft'] as const;

export function filterSimBriefNavigation(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  return Object.fromEntries(navigationFields.flatMap(field =>
    Object.hasOwn(input, field) ? [[field, input[field]]] : []));
}

export async function fetchLatestSimBriefPlan(
  username: string,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch
): Promise<Response> {
  const localUrl = '/api/v1/integrations/simbrief/plan?' + new URLSearchParams({
    kind: 'username',
    identifier: username
  });

  try {
    const localResponse = await fetcher(localUrl, { signal });
    if (localResponse.ok || ![502, 504].includes(localResponse.status)) return localResponse;
  } catch (error) {
    if (signal?.aborted) throw error;
  }

  const officialUrl = 'https://www.simbrief.com/api/xml.fetcher.php?' + new URLSearchParams({
    username,
    json: 'v2'
  });
  return fetcher(officialUrl, { signal });
}
