import { HealthResponse } from '@bar/shared';

export type ServerStatus = { online: true; health: HealthResponse } | { online: false; reason: string };

/** Fetches and validates the server health contract. Never throws. */
export async function fetchServerStatus(fetchFn: typeof fetch = fetch, url = '/health'): Promise<ServerStatus> {
  try {
    const res = await fetchFn(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return { online: false, reason: `HTTP ${res.status}` };
    const parsed = HealthResponse.safeParse(await res.json());
    return parsed.success ? { online: true, health: parsed.data } : { online: false, reason: 'resposta inválida' };
  } catch {
    return { online: false, reason: 'servidor indisponível' };
  }
}
