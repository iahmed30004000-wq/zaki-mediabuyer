/**
 * A download from an address the studio sends («creative.ready» carries a video URL). The same outbound rules as the site's step runner
 * (src/core/step-exec.ts · src/server/step-exec.ts): https only, no login in the address, the usual port, never an internal name, every address the name
 * points to must be public, and (when the owner wrote a list in STUDIO_URL_ALLOW) the host must be on it. A redirect is followed by hand, at most three
 * times, and each hop goes through the same checks again. The body is counted while it streams: it stops the moment it passes the limit, whatever the
 * Content-Length said. (v6 P0-1.)
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Transform } from "node:stream";
import { hostAllowed, isPrivateIp } from "@/core/step-exec";

export class OutboundRefused extends Error {
  constructor(message: string, public status = 422, public code = "download_refused") {
    super(message);
  }
}

export interface OutboundDeps {
  fetch: typeof fetch;
  resolve: (host: string) => Promise<string[]>;
}

export const realOutbound = (): OutboundDeps => ({ fetch, resolve: async (host) => (await lookup(host, { all: true })).map((a) => a.address) });

export const allowListFrom = (v: string | undefined): string[] => (v ?? "").split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Throws OutboundRefused unless this address may be fetched. Returns the parsed URL. */
export async function checkOutbound(raw: string, allow: string[], d: Pick<OutboundDeps, "resolve">): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new OutboundRefused("الرابط مش صحيح");
  }
  if (u.protocol !== "https:") throw new OutboundRefused("الرابط لازم https");
  if (u.username || u.password) throw new OutboundRefused("ممنوع اسم مستخدم أو كلمة سر بالرابط");
  if (u.port && u.port !== "443") throw new OutboundRefused("بس المنفذ العادي 443");
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) throw new OutboundRefused("عنوان داخلي ممنوع");
  if (isIP(host) && isPrivateIp(host)) throw new OutboundRefused("عنوان داخلي ممنوع");
  if (allow.length && !hostAllowed(host, allow)) throw new OutboundRefused(`الموقع «${host}» مش بقائمة المسموح (STUDIO_URL_ALLOW)`);
  if (!isIP(host)) {
    const addrs = await d.resolve(host).catch(() => []);
    if (!addrs.length || addrs.some(isPrivateIp)) throw new OutboundRefused("الاسم بيدلّ على عنوان داخلي أو ما انحلّ — ممنوع");
  }
  return u;
}

/** GET with the checks on every hop. The caller reads (and limits) the body; see `byteLimit`. */
export async function safeGet(url: string, opts: { allow: string[]; timeoutMs: number; maxRedirects?: number }, d: OutboundDeps = realOutbound()): Promise<Response> {
  let next = url;
  for (let hop = 0; hop <= (opts.maxRedirects ?? 3); hop++) {
    const u = await checkOutbound(next, opts.allow, d);
    const res = await d.fetch(u.href, { redirect: "manual", signal: AbortSignal.timeout(opts.timeoutMs) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      next = new URL(res.headers.get("location")!, u).href;
      await res.body?.cancel().catch(() => undefined);
      continue;
    }
    return res;
  }
  throw new OutboundRefused("تحويلات كتيرة بالرابط");
}

/** A stream stage that fails the moment more than `max` bytes went through (the header may lie, or be missing). */
export function byteLimit(max: number, onExceed: () => Error): Transform {
  let n = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      n += chunk.length;
      if (n > max) cb(onExceed());
      else cb(null, chunk);
    },
  });
}
