import type { Request } from 'express';

/**
 * In-process hit counters for the legacy connection routes that are now
 * compatibility aliases of the account-connections module (contract v153). Logged
 * at most once per hour with the route and a coarse client family only, never an
 * identifier or credential, so retirement can wait until the counts read zero.
 */
const counts = new Map<string, number>();
const LOG_INTERVAL_MS = 60 * 60 * 1000;
let lastLoggedAt = Date.now();

function clientFamily(req: Request): string {
  const declared = req.get('x-overlord-client')?.trim().toLowerCase();
  if (declared && /^[a-z0-9_-]{1,32}$/.test(declared)) return declared;
  const agent = req.get('user-agent') ?? '';
  if (/OverlordMobile|CFNetwork|Darwin/i.test(agent)) return 'mobile';
  if (/Electron/i.test(agent)) return 'desktop';
  if (/Mozilla/i.test(agent)) return 'web';
  return 'other';
}

export function recordConnectionAliasHit(route: string, req: Request, now = Date.now()): void {
  const key = `${req.method} ${route} ${clientFamily(req)}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
  if (now - lastLoggedAt < LOG_INTERVAL_MS) return;
  lastLoggedAt = now;
  const summary = [...counts.entries()].map(([k, n]) => `${k}=${n}`).join(', ');
  counts.clear();
  console.warn(`[connections] legacy alias hits in the last hour: ${summary}`);
}

/** Current counts (tests and diagnostics). */
export function connectionAliasHitCounts(): Record<string, number> {
  return Object.fromEntries(counts);
}
