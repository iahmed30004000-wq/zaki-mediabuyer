/**
 * THE SAFE META CLIENT (spec 9.1) — read-only in Phase 1.
 *
 *   • Version from the environment (META_API_VERSION, v24.0 at build time — checked against the official SDK).
 *   • Usage headers (x-business-use-case-usage / x-app-usage / x-ad-account-usage) are read on every answer:
 *     slow down at 75%, stop at 90% (spec 9.1). The numbers go to `onUsage` for the dashboard counter.
 *   • Transient errors (rate limits, 5xx, timeouts) are retried with growing waits; permission and input errors
 *     never are.
 *   • The token goes in the Authorization header, never in a URL, a log line or an error message.
 *   • Pages are followed through `paging.next` (its host is checked to be graph.facebook.com).
 */
export interface MetaError {
  code?: number;
  error_subcode?: number;
  message?: string;
  type?: string;
}

export class MetaApiError extends Error {
  constructor(public status: number, public meta: MetaError, public transient: boolean) {
    super(`Meta ${status} ${meta.code ?? ""}/${meta.error_subcode ?? ""}: ${(meta.message ?? "").replace(/access_token=[^&\s]+/g, "access_token=[redacted]")}`);
  }
}

/** Codes Meta documents as temporary or throttling (retry later), as opposed to permission / bad input. */
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014]);

export function isTransient(status: number, err: MetaError): boolean {
  if (status >= 500) return true;
  if (err.code !== undefined && TRANSIENT_CODES.has(err.code)) return true;
  return false;
}

/** The highest percentage found in Meta's usage headers (0–100). */
export function usagePercent(headers: Headers): number {
  let max = 0;
  const scan = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(scan);
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (typeof x === "number" && /call_count|total_cputime|total_time|acc_id_util_pct/.test(k)) max = Math.max(max, x);
        else scan(x);
      }
    }
  };
  for (const h of ["x-business-use-case-usage", "x-app-usage", "x-ad-account-usage"]) {
    const raw = headers.get(h);
    if (!raw) continue;
    try {
      scan(JSON.parse(raw));
    } catch {
      /* a header we cannot read does not stop the call */
    }
  }
  return max;
}

export interface ClientOptions {
  token: string;
  version?: string;
  fetch?: typeof fetch;
  /** waits are injectable so tests do not sleep */
  sleep?: (ms: number) => Promise<void>;
  onUsage?: (pct: number) => void;
  maxRetries?: number;
}

export class UsageTooHigh extends Error {}

export class MetaClient {
  private readonly base: string;
  private readonly f: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private lastUsage = 0;

  constructor(private readonly o: ClientOptions) {
    this.base = `https://graph.facebook.com/${o.version ?? process.env.META_API_VERSION ?? "v24.0"}`;
    this.f = o.fetch ?? fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get usage(): number {
    return this.lastUsage;
  }

  private async request<T>(url: string): Promise<T> {
    if (this.lastUsage >= 90) throw new UsageTooHigh(`Meta usage at ${this.lastUsage}% — stopped until it drops`);
    if (this.lastUsage >= 75) await this.sleep(5_000);
    const max = this.o.maxRetries ?? 4;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.f(url, { headers: { authorization: `Bearer ${this.o.token}` }, signal: AbortSignal.timeout(60_000) });
      } catch (e) {
        if (attempt >= max) throw e;
        await this.sleep(2 ** attempt * 1_000);
        continue;
      }
      this.lastUsage = usagePercent(res.headers);
      this.o.onUsage?.(this.lastUsage);
      const body = (await res.json().catch(() => ({}))) as T & { error?: MetaError };
      if (res.ok && !body.error) return body;
      const err = body.error ?? {};
      const transient = isTransient(res.status, err);
      if (!transient || attempt >= max) throw new MetaApiError(res.status, err, transient);
      await this.sleep(2 ** attempt * 1_000);
    }
  }

  /** GET one object or one page. `params` values that are arrays/objects are JSON-encoded (Graph API style). */
  get<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, typeof v === "string" ? v : JSON.stringify(v));
    return this.request<T>(`${this.base}/${path.replace(/^\//, "")}${q.size ? `?${q}` : ""}`);
  }

  /** Every item of a list, following `paging.next`. */
  async all<T>(path: string, params: Record<string, unknown> = {}): Promise<T[]> {
    const out: T[] = [];
    let page = await this.get<{ data: T[]; paging?: { next?: string } }>(path, { limit: 200, ...params });
    for (;;) {
      out.push(...(page.data ?? []));
      const next = page.paging?.next;
      if (!next) return out;
      const u = new URL(next);
      if (u.hostname !== "graph.facebook.com") throw new Error("refusing a paging link outside graph.facebook.com");
      u.searchParams.delete("access_token");
      page = await this.request(u.toString());
    }
  }
}
