/**
 * «اربط ← اسمح» — the media buyer as an OAuth 2.1 CLIENT of one of our other systems (OMS · replies · Workspace). The system that owns the data is the authorization
 * server and hands out the token after the owner presses «اسمح» there; nobody copies a token. Discovery (RFC 8414) → registration (RFC 7591, public client) → the owner is
 * sent to that system's /oauth/authorize with a PKCE challenge → it comes back to /oauth/callback with a code → the code and the verifier become a token, stored sealed
 * and put in the environment by the overlay, so the adapters read OMS_TOKEN etc. exactly as before. Renewal runs in the web process only. Nothing is logged.
 */
import { createHash, randomBytes } from "node:crypto";
import { EVENT_SECRET, EXPIRES_SUFFIX, REFRESH_SUFFIX, STATE_SUFFIX, rowOf, type ConnRow } from "@/core/connections";
import { audit } from "./audit";
import { HttpError } from "./auth";
import { db } from "./db";
import { reloadOverlay } from "./connections";
import { appOrigin } from "./env";
import { MASTER_KEY_MISSING, masterKeyConfigured, openSecret, sealSecret } from "./secrets";

const T = 15_000;
const PENDING_MIN = 10;
const RENEW_BEFORE_MS = 5 * 60_000;
const redirectUri = () => `${appOrigin()}/oauth/callback`;

interface AsMeta {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
}

const linkOf = (key: string): { row: ConnRow; spec: NonNullable<ConnRow["link"]>; urlName: string } => {
  const row = rowOf(key);
  if (!row?.link) throw new HttpError(404, "هالسطر ما بينربط بـ«اربط ← اسمح»");
  return { row, spec: row.link, urlName: row.fields[0]!.name };
};

const sameOrigin = (a: string, b: string): boolean => {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
};

/** What the other system says about its authorization server. A refusal says why in words and never prints the response. */
export async function discover(base: string, fetchImpl: typeof fetch = fetch): Promise<AsMeta> {
  let res: Response;
  try {
    res = await fetchImpl(`${base.replace(/\/+$/, "")}/.well-known/oauth-authorization-server`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(T) });
  } catch {
    throw new HttpError(502, "ما قدرت أوصل للنظام — اتأكد من العنوان");
  }
  if (res.status === 404) throw new HttpError(409, "هالنظام لسا ما عنده «اربط ← اسمح» (سيرفر التفويض). لما يجهّز، بتضغط من جديد");
  if (!res.ok) throw new HttpError(502, `النظام ردّ ${res.status} على سؤال التفويض`);
  const j = (await res.json().catch(() => null)) as Partial<AsMeta> & { code_challenge_methods_supported?: string[] } | null;
  if (!j || typeof j.issuer !== "string" || typeof j.authorization_endpoint !== "string" || typeof j.token_endpoint !== "string" || typeof j.registration_endpoint !== "string") throw new HttpError(502, "ردّ التفويض ناقص (بدنا issuer وauthorize وtoken وregistration)");
  if (j.code_challenge_methods_supported && !j.code_challenge_methods_supported.includes("S256")) throw new HttpError(409, "هالنظام ما بيدعم PKCE بطريقة S256");
  for (const e of [j.authorization_endpoint, j.token_endpoint, j.registration_endpoint]) if (!sameOrigin(e, j.issuer)) throw new HttpError(502, "عناوين التفويض لازم تكون على نفس موقع النظام");
  if (!sameOrigin(j.issuer, base)) throw new HttpError(502, "عنوان التفويض مش نفس عنوان النظام");
  return j as AsMeta;
}

async function clientFor(key: string, meta: AsMeta, fetchImpl: typeof fetch): Promise<string> {
  const known = await db.oAuthLinkClient.findUnique({ where: { key } });
  if (known && known.issuer === meta.issuer) return known.clientId;
  let res: Response;
  try {
    res = await fetchImpl(meta.registration_endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ client_name: "الميديا باير", redirect_uris: [redirectUri()], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }),
      signal: AbortSignal.timeout(T),
    });
  } catch {
    throw new HttpError(502, "ما قدرت أسجّل عند النظام — جرّب كمان شوي");
  }
  if (!res.ok) throw new HttpError(502, `النظام رفض التسجيل (${res.status})`);
  const j = (await res.json().catch(() => null)) as { client_id?: unknown } | null;
  if (!j || typeof j.client_id !== "string" || !j.client_id) throw new HttpError(502, "ردّ التسجيل بلا client_id");
  await db.oAuthLinkClient.upsert({ where: { key }, create: { key, issuer: meta.issuer, tokenEndpoint: meta.token_endpoint, clientId: j.client_id }, update: { issuer: meta.issuer, tokenEndpoint: meta.token_endpoint, clientId: j.client_id, registeredAt: new Date() } });
  return j.client_id;
}

/** Step 1: where to send the owner. The PKCE verifier waits sealed in the database for ten minutes. */
export async function beginLink(key: string, userId: string, fetchImpl: typeof fetch = fetch): Promise<{ url: string }> {
  const { spec, urlName } = linkOf(key);
  if (!masterKeyConfigured()) throw new HttpError(409, MASTER_KEY_MISSING);
  const base = process.env[urlName]?.trim();
  if (!base) throw new HttpError(409, "اكتب عنوان النظام أول، وبعدين اضغط «اربط»");
  const meta = await discover(base, fetchImpl);
  const clientId = await clientFor(key, meta, fetchImpl);
  const verifier = randomBytes(48).toString("base64url");
  const state = randomBytes(24).toString("base64url");
  await db.oAuthLinkPending.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.oAuthLinkPending.create({ data: { state, key, userId, verifierEnc: sealSecret(`pending:${state}`, verifier), expiresAt: new Date(Date.now() + PENDING_MIN * 60_000) } });
  const u = new URL(meta.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", state);
  u.searchParams.set("scope", spec.scopes.join(" "));
  await audit({ type: "user", id: userId }, "oauth_link.begin", { type: "connection", id: key });
  return { url: u.toString() };
}

async function store(name: string, value: string, secret: boolean, userId: string | null): Promise<void> {
  const data = secret ? { secret: true, source: "oauth", valueEnc: sealSecret(name, value), valuePlain: null, last4: null, updatedBy: userId } : { secret: false, source: "oauth", valueEnc: null, valuePlain: value, last4: null, updatedBy: userId };
  await db.connectionSetting.upsert({ where: { name }, create: { name, ...data }, update: data });
}

interface TokenAnswer {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  event_signing_secret?: string;
}

async function tokenCall(endpoint: string, body: Record<string, string>, fetchImpl: typeof fetch): Promise<{ ok: true; t: TokenAnswer } | { ok: false; status: number }> {
  let res: Response;
  try {
    res = await fetchImpl(endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams(body).toString(), signal: AbortSignal.timeout(T) });
  } catch {
    return { ok: false, status: 0 };
  }
  if (!res.ok) return { ok: false, status: res.status };
  const j = (await res.json().catch(() => null)) as Partial<TokenAnswer> | null;
  if (!j || typeof j.access_token !== "string" || !j.access_token) return { ok: false, status: 502 };
  return { ok: true, t: { access_token: j.access_token, refresh_token: typeof j.refresh_token === "string" ? j.refresh_token : undefined, expires_in: typeof j.expires_in === "number" ? j.expires_in : undefined, event_signing_secret: typeof j.event_signing_secret === "string" ? j.event_signing_secret : undefined } };
}

async function keepTokens(key: string, t: TokenAnswer, userId: string | null): Promise<void> {
  const { spec } = linkOf(key);
  await store(spec.tokenName, t.access_token, true, userId);
  if (t.refresh_token) await store(`${spec.tokenName}${REFRESH_SUFFIX}`, t.refresh_token, true, userId);
  await store(`${spec.tokenName}${EXPIRES_SUFFIX}`, String(Date.now() + (t.expires_in ?? 3600) * 1000), false, userId);
  await store(`${spec.tokenName}${STATE_SUFFIX}`, "ok", false, userId);
  if (t.event_signing_secret) await store(EVENT_SECRET(spec.system), t.event_signing_secret, true, userId);
  await reloadOverlay();
}

/** Step 2, when the other system sends the owner back with a code. The code works once, for the owner who started it, within ten minutes. */
export async function completeLink(state: string, code: string, userId: string, fetchImpl: typeof fetch = fetch): Promise<{ key: string }> {
  const p = await db.oAuthLinkPending.findUnique({ where: { state } });
  if (p) await db.oAuthLinkPending.delete({ where: { id: p.id } }).catch(() => undefined); // single use, whatever happens next
  if (!p || p.userId !== userId || p.expiresAt <= new Date()) throw new HttpError(400, "الرابط انتهى أو مش إلك — اضغط «اربط» من جديد");
  const verifier = openSecret(`pending:${state}`, p.verifierEnc);
  const client = await db.oAuthLinkClient.findUnique({ where: { key: p.key } });
  if (!verifier || !client) throw new HttpError(400, "الربط ضاع — اضغط «اربط» من جديد");
  const r = await tokenCall(client.tokenEndpoint, { grant_type: "authorization_code", code, redirect_uri: redirectUri(), client_id: client.clientId, code_verifier: verifier }, fetchImpl);
  if (!r.ok) throw new HttpError(502, r.status === 0 ? "ما قدرت أوصل للنظام لأبدّل الرمز" : `النظام رفض الرمز (${r.status}) — اضغط «اربط» من جديد`);
  await keepTokens(p.key, r.t, userId);
  await audit({ type: "user", id: userId }, "oauth_link.complete", { type: "connection", id: p.key }, { after: { system: linkOf(p.key).spec.system } });
  return { key: p.key };
}

/** Renew every linked token that expires within five minutes (or already has). Called by the web process every half minute; a revoked grant marks the link «broken». */
export async function refreshDueLinks(fetchImpl: typeof fetch = fetch): Promise<number> {
  if (!masterKeyConfigured()) return 0;
  let n = 0;
  const rows = await db.connectionSetting.findMany({ where: { name: { endsWith: EXPIRES_SUFFIX } } });
  for (const exp of rows) {
    const tokenName = exp.name.slice(0, -EXPIRES_SUFFIX.length);
    const key = ["oms", "replies", "workspace"].find((k) => rowOf(k)?.link?.tokenName === tokenName);
    if (!key || Number(exp.valuePlain) - Date.now() > RENEW_BEFORE_MS) continue;
    const bad = await db.connectionSetting.findUnique({ where: { name: `${tokenName}${STATE_SUFFIX}` } });
    if (bad?.valuePlain === "broken") continue;
    const [rt, client] = await Promise.all([db.connectionSetting.findUnique({ where: { name: `${tokenName}${REFRESH_SUFFIX}` } }), db.oAuthLinkClient.findUnique({ where: { key } })]);
    const refresh = rt ? openSecret(rt.name, rt.valueEnc) : null;
    if (!refresh || !client) continue;
    const r = await tokenCall(client.tokenEndpoint, { grant_type: "refresh_token", refresh_token: refresh, client_id: client.clientId }, fetchImpl);
    if (r.ok) {
      await keepTokens(key, { ...r.t, refresh_token: r.t.refresh_token ?? refresh }, null);
      n++;
    } else if (r.status === 400 || r.status === 401) {
      await store(`${tokenName}${STATE_SUFFIX}`, "broken", false, null);
      await audit({ type: "system" }, "oauth_link.broken", { type: "connection", id: key });
    }
  }
  return n;
}

/** «افصل»: forget the token and its renewal. (The other system can still revoke its side from its own screen.) */
export async function unlink(key: string, userId: string): Promise<void> {
  const { spec } = linkOf(key);
  const names = [spec.tokenName, `${spec.tokenName}${REFRESH_SUFFIX}`, `${spec.tokenName}${EXPIRES_SUFFIX}`, `${spec.tokenName}${STATE_SUFFIX}`, EVENT_SECRET(spec.system)];
  await db.connectionSetting.deleteMany({ where: { name: { in: names } } });
  await reloadOverlay();
  await audit({ type: "user", id: userId }, "oauth_link.unlink", { type: "connection", id: key });
}
