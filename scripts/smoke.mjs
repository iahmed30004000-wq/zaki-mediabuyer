#!/usr/bin/env node
/**
 * Smoke test (v6 P0-3): sign in with the seeded owner account and open the main pages of a RUNNING site. It fails on any 5xx answer,
 * on the words «Application error» (Next's own crash page) or «صار خطأ بهالصفحة» (the site's error screen), and on a page that sends the
 * signed-in owner back to the sign-in door. CI runs it against the production image on a seeded database, so a build that starts
 * (`/api/health`) but breaks its screens does not go green.
 *
 *   SMOKE_EMAIL=… SMOKE_PASSWORD=… node scripts/smoke.mjs        (SMOKE_BASE_URL defaults to http://localhost:3140)
 *
 * It only talks to a local address unless SMOKE_ALLOW_REMOTE=1: it is not a tool to point at production with a real password.
 * It never prints the password, a cookie, or a page body — only the address and the problem.
 *
 * Every interface phase adds its own addresses to SMOKE_PAGES below.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The screens opened after sign-in. Add a phase's new addresses here (v6: `/tasks` · `/numbers` · `/ads` · `/settings` as each one ships). */
export const SMOKE_PAGES = ["/", "/work", "/inbox", "/ads", "/ops", "/settings"];

/** Text that means a screen crashed. */
export const BAD_TEXT = ["Application error", "صار خطأ بهالصفحة"];

const MAX_HOPS = 5;
const TIMEOUT_MS = 45_000;

/** Why a page answer is not acceptable, or null. `location` is the redirect target when the answer is a redirect. */
export function judgePage({ status, body = "", location = null }) {
  if (status >= 500) return `answered ${status}`;
  if (status >= 400) return `answered ${status}`;
  if (status >= 300) {
    if (!location) return `redirect ${status} with no address`;
    return null;
  }
  const bad = BAD_TEXT.find((t) => body.includes(t));
  return bad ? "the page shows its error screen" : null;
}

/** The `name=value` pairs of a list of Set-Cookie lines, joined for a Cookie header. */
export function cookieHeader(setCookies) {
  const jar = new Map();
  for (const line of setCookies) {
    const pair = line.split(";")[0] ?? "";
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

/** localhost, 127.0.0.1 and [::1] only. */
export function isLocalBase(url) {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
  } catch {
    return false;
  }
}

/**
 * Run the smoke test. `fetchImpl` is injectable for the tests. Returns `{ ok, results: [{ path, problem }] }`; a problem of null is a pass.
 */
export async function runSmoke({ base, email, password, pages = SMOKE_PAGES, fetchImpl = fetch, log = () => {} }) {
  const origin = new URL(base).origin;
  const results = [];
  const call = (url, init = {}) => fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), ...init });

  // 1. the door answers
  try {
    const h = await call(`${origin}/api/health`);
    const json = await h.json().catch(() => null);
    const problem = h.status !== 200 ? `answered ${h.status}` : typeof json?.version !== "string" ? "no version in the answer" : null;
    results.push({ path: "/api/health", problem });
  } catch (e) {
    results.push({ path: "/api/health", problem: `no answer (${e instanceof Error ? e.name : "error"})` });
  }

  // 2. sign in (the site only takes a change that says it comes from itself, so the Origin header goes along)
  let cookie = "";
  try {
    const res = await call(`${origin}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ email, password }) });
    const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    cookie = cookieHeader(cookies);
    results.push({ path: "sign-in", problem: res.status !== 200 ? `answered ${res.status}` : cookie ? null : "no session cookie came back" });
  } catch (e) {
    results.push({ path: "sign-in", problem: `no answer (${e instanceof Error ? e.name : "error"})` });
  }
  if (results.some((r) => r.problem)) return finish(results, log);

  // 3. the pages, as the owner (redirects are followed by hand so a bounce to the door is seen)
  for (const p of pages) {
    let url = `${origin}${p}`;
    let problem = null;
    try {
      for (let hop = 0; hop <= MAX_HOPS; hop++) {
        const res = await call(url, { headers: { cookie } });
        const location = res.headers.get("location");
        const body = res.status >= 300 && res.status < 400 ? "" : await res.text();
        problem = judgePage({ status: res.status, body, location });
        if (problem || res.status < 300 || res.status >= 400) break;
        const next = new URL(location, url);
        if (next.origin !== origin) {
          problem = "redirected to another site";
          break;
        }
        if (next.pathname.startsWith("/login")) {
          problem = "sent back to the sign-in page";
          break;
        }
        if (hop === MAX_HOPS) problem = "too many redirects";
        url = next.href;
      }
    } catch (e) {
      problem = `no answer (${e instanceof Error ? e.name : "error"})`;
    }
    results.push({ path: p, problem });
  }
  return finish(results, log);
}

function finish(results, log) {
  for (const r of results) log(`${r.problem ? "FAIL" : "ok  "} ${r.path}${r.problem ? ` — ${r.problem}` : ""}`);
  return { ok: results.every((r) => !r.problem), results };
}

async function main() {
  const base = process.env.SMOKE_BASE_URL || "http://localhost:3140";
  const email = process.env.SMOKE_EMAIL;
  const password = process.env.SMOKE_PASSWORD;
  if (!email || !password) {
    console.error("smoke: set SMOKE_EMAIL and SMOKE_PASSWORD (the seeded owner of the test database)");
    return 2;
  }
  if (!isLocalBase(base) && process.env.SMOKE_ALLOW_REMOTE !== "1") {
    console.error("smoke: refusing to sign in to a non-local address");
    return 2;
  }
  const { ok } = await runSmoke({ base, email, password, log: (l) => console.log(l) });
  console.log(ok ? "smoke: passed" : "smoke: FAILED");
  return ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then((c) => process.exit(c));
