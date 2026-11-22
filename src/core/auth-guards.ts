/**
 * Small pure guards for the door of the site (v6 P0-1). Edge-safe: no node imports, the middleware uses them too.
 *
 *   safeNext        where to go after signing in — an address inside the site, never another host
 *   sameSiteRequest does a state-changing request come from the site itself (Origin / Sec-Fetch-Site)
 *   loginLimiter    failed sign-in attempts per address + e-mail and per address, in memory
 */

/** An address inside the site only: starts with one `/`, no backslash, no control character, and resolves to the same origin. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return "/";
  try {
    const base = "http://site.invalid";
    return new URL(next, base).origin === base ? next : "/";
  } catch {
    return "/";
  }
}

/** Paths whose callers carry their own proof (a Bearer token, a signed body, a PKCE verifier), not the browser cookie — no Origin is expected from them. */
export const TOKEN_ROUTES: readonly RegExp[] = [/^\/api\/telegram\/webhook/, /^\/api\/inbound\/oms$/, /^\/api\/vidpattern\//, /^\/api\/v1\/vp\//, /^\/api\/v1\/handoffs/, /^\/api\/v1\/video-requests/, /^\/mcp$/, /^\/\.well-known\//, /^\/oauth\/(register|token)$/];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface RequestFacts {
  method: string;
  path: string;
  origin: string | null;
  secFetchSite: string | null;
  /** the hosts this site answers on: the Host header, the forwarded host, the host of APP_URL */
  hosts: string[];
}

const hostOf = (origin: string): string | null => {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * A request that changes something and carries the browser's cookie must come from a page of this site: its `Origin` is one of our hosts.
 * With no `Origin` the browser's `Sec-Fetch-Site` decides (same-origin / none pass); with neither it is not a browser page (a script, curl) and goes on.
 * Token routes are exempt.
 */
export function sameSiteRequest(f: RequestFacts): boolean {
  if (SAFE_METHODS.has(f.method.toUpperCase())) return true;
  if (TOKEN_ROUTES.some((r) => r.test(f.path))) return true;
  if (f.origin !== null) {
    const h = hostOf(f.origin);
    return !!h && f.hosts.map((x) => x.toLowerCase()).includes(h);
  }
  if (f.secFetchSite !== null) return f.secFetchSite === "same-origin" || f.secFetchSite === "none";
  return true;
}

/** The hosts a request may legitimately name as its own, from the headers a proxy sets and the configured address. */
export function ownHosts(h: { host: string | null; forwardedHost: string | null; appUrl: string | undefined }): string[] {
  const out = new Set<string>();
  if (h.host) out.add(h.host.trim().toLowerCase());
  if (h.forwardedHost) out.add(h.forwardedHost.split(",")[0]!.trim().toLowerCase());
  const app = h.appUrl ? hostOf(h.appUrl) : null;
  if (app) out.add(app);
  return [...out];
}

/**
 * Failed sign-in attempts. Keyed on address + e-mail (10 per 15 minutes) and on the address alone (30 per 15 minutes).
 * Only failures count, a success clears its own pair, and old entries are dropped.
 */
export function loginLimiter(opts: { windowMs?: number; perPair?: number; perAddress?: number } = {}) {
  const windowMs = opts.windowMs ?? 15 * 60_000;
  const perPair = opts.perPair ?? 10;
  const perAddress = opts.perAddress ?? 30;
  const seen = new Map<string, { n: number; at: number }>();
  const live = (k: string, now: number) => {
    const e = seen.get(k);
    if (e && now - e.at > windowMs) {
      seen.delete(k);
      return undefined;
    }
    return e;
  };
  const sweep = (now: number) => {
    if (seen.size < 500) return;
    for (const [k, e] of seen) if (now - e.at > windowMs) seen.delete(k);
  };
  const keys = (ip: string, email: string) => [`p:${ip}|${email}`, `a:${ip}`] as const;
  return {
    blocked(ip: string, email: string, now = Date.now()): boolean {
      const [pair, addr] = keys(ip, email);
      return (live(pair, now)?.n ?? 0) >= perPair || (live(addr, now)?.n ?? 0) >= perAddress;
    },
    fail(ip: string, email: string, now = Date.now()): void {
      sweep(now);
      for (const k of keys(ip, email)) {
        const e = live(k, now);
        seen.set(k, { n: (e?.n ?? 0) + 1, at: e?.at ?? now });
      }
    },
    success(ip: string, email: string): void {
      seen.delete(keys(ip, email)[0]);
    },
    size: () => seen.size,
  };
}

/** A real bcrypt hash (cost 12, 60 characters) of a random string nobody knows: compared when the account does not exist, so both paths cost the same. */
export const DUMMY_PASSWORD_HASH = "$2a$12$OafuYhZhpvphlyNkF1Lz9urUq5c2m2AJhoQTUbu3LsJGayDzbZJWC";
