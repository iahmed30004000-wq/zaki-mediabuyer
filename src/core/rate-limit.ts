/**
 * A sliding-window limiter, in memory (one app instance serves the site). `makeLimiter(120, 60_000)` allows 120 calls per
 * minute per key; a refused call says in how many seconds the oldest one falls out of the window. `cost` is how many calls this one counts for
 * (a batch of tool calls counts for each of them). Pure but for its map.
 */
export function makeLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string, now = Date.now(), cost = 1): { ok: boolean; retryAfterS: number } => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    const n = Math.max(1, Math.floor(cost));
    if (recent.length + n > limit) {
      hits.set(key, recent);
      return { ok: false, retryAfterS: Math.max(1, Math.ceil((windowMs - (now - (recent[0] ?? now))) / 1000)) };
    }
    for (let i = 0; i < n; i++) recent.push(now);
    hits.set(key, recent);
    if (hits.size > 1000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    return { ok: true, retryAfterS: 0 };
  };
}

/** The MCP server may be called from Claude (its own servers send no Origin) and from the site itself — nothing else. */
export function originAllowed(origin: string | null, appOrigin: string): boolean {
  if (!origin) return true;
  try {
    const u = new URL(origin);
    if (u.origin === new URL(appOrigin).origin) return true;
    return u.protocol === "https:" && /(^|\.)(claude\.ai|claude\.com|anthropic\.com)$/.test(u.hostname);
  } catch {
    return false;
  }
}
