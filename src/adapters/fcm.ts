/**
 * FIREBASE CLOUD MESSAGING (docs/rebuild-v6/05-notify.md §6) — the HTTP v1 API without a Google library. Written against the current official pages
 * (FCM «HTTP v1» reference: the Message object, the error codes; «Send a message»), checked on 22/11/2026. Where the plan's wording from memory differs, the docs win:
 *
 *   • the access token: a JWT signed RS256 with the service account's key (`jose`, as the Drive adapter does), `scope = https://www.googleapis.com/auth/firebase.messaging`,
 *     exchanged at https://oauth2.googleapis.com/token, kept in memory for 50 minutes;
 *   • the send: `POST https://fcm.googleapis.com/v1/projects/<projectId>/messages:send` with `{ message: {...} }`;
 *   • the target is `fid` (a Firebase Installation ID — the current way; `token` is marked deprecated in the Message reference) or `token` for a registration token an
 *     older client made; the field names are snake_case (`fcm_options`), `data` values are all strings, and `android.priority` is the enum `HIGH` / `NORMAL`;
 *   • the errors: 404 `UNREGISTERED` and 403 `SENDER_ID_MISMATCH` end the device, a 400 `INVALID_ARGUMENT` that names the token ends it too (any other 400 is our payload:
 *     retrying it unchanged is pointless), 429 and 5xx are tried again later, 401/403 on the access token are the owner's key.
 *
 * The service account's key is read from the process environment (the site's «الربط» row puts it there); it is never logged, never returned, and an error says only a status
 * and a word. The message carries the notice's own text — the dispatcher has already refused anything with customer data in it.
 */
import { SignJWT, importPKCS8 } from "jose";

export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND = (projectId: string) => `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;
const TOKEN_TTL_MS = 50 * 60_000;
const TIMEOUT_MS = 15_000;

export interface FcmAccount {
  client_email: string;
  private_key: string;
  project_id?: string;
}

export interface FcmConfig {
  projectId: string;
  account: FcmAccount;
  fetch?: typeof fetch;
  now?: () => number;
}

/** What a device is, for the message: a Firebase Installation ID, a registration token (older), or (not sent through FCM) a bare browser subscription. */
export interface FcmDevice {
  kind: string;
  token: string;
}

export interface PushMessage {
  title: string;
  body: string;
  /** an address inside the site */
  href: string;
  /** the notice's id */
  id: string;
  kind: string;
  /** a sound and a notification that stays on the screen */
  ring: boolean;
  /** the site's origin (https://…): the icon and, over https, the link FCM opens */
  origin: string;
}

export type FcmResult =
  | { ok: true }
  | {
      ok: false;
      /** the device is gone or was never valid: stop using it */
      invalid: boolean;
      /** a later try may work */
      retry: boolean;
      status: number;
      /** one word, never the answer's text */
      reason: string;
    };

/** The Firebase connection as the environment holds it, or null while any part is missing (the site then says «لازم تربط Firebase»). */
export function fcmFromEnv(env: Record<string, string | undefined> = process.env): FcmConfig | null {
  const raw = env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const account = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")) as FcmAccount;
    if (!account.client_email || !account.private_key) return null;
    const projectId = env.FIREBASE_PROJECT_ID?.trim() || account.project_id;
    return projectId ? { projectId, account } : null;
  } catch {
    return null;
  }
}

/** The four public values and the VAPID key the browser needs. None of them is secret (05-notify.md §5), but the page only gets them when all are there. */
export interface FirebaseWebConfig {
  apiKey: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
  vapidKey: string;
}

export function webConfigFromEnv(env: Record<string, string | undefined> = process.env): FirebaseWebConfig | null {
  const pick = (n: string) => env[n]?.trim() ?? "";
  const c = { apiKey: pick("FIREBASE_API_KEY"), projectId: pick("FIREBASE_PROJECT_ID"), messagingSenderId: pick("FIREBASE_MESSAGING_SENDER_ID"), appId: pick("FIREBASE_APP_ID"), vapidKey: pick("FIREBASE_VAPID_KEY") };
  return Object.values(c).every(Boolean) ? c : null;
}

/** What is still missing for pushes to work, by the names the owner pastes on the «الربط» page. Empty = set up. */
export function firebaseMissing(env: Record<string, string | undefined> = process.env): string[] {
  const names = ["FIREBASE_API_KEY", "FIREBASE_PROJECT_ID", "FIREBASE_MESSAGING_SENDER_ID", "FIREBASE_APP_ID", "FIREBASE_VAPID_KEY", "FIREBASE_SERVICE_ACCOUNT_JSON"];
  return names.filter((n) => !env[n]?.trim());
}

type Cache = { token: string; until: number; email: string };
let cached: Cache | null = null;
/** For tests: forget the access token. */
export function resetFcmTokenCache(): void {
  cached = null;
}

class AccessError extends Error {
  constructor(
    public status: number,
    public reason: string,
  ) {
    super(reason);
  }
}

async function accessToken(c: FcmConfig): Promise<string> {
  const nowMs = (c.now ?? Date.now)();
  if (cached && cached.email === c.account.client_email && cached.until > nowMs + 60_000) return cached.token;
  let assertion: string;
  try {
    const key = await importPKCS8(c.account.private_key, "RS256");
    const iat = Math.floor(nowMs / 1000);
    assertion = await new SignJWT({ scope: FCM_SCOPE }).setProtectedHeader({ alg: "RS256", typ: "JWT" }).setIssuer(c.account.client_email).setAudience(TOKEN_URL).setIssuedAt(iat).setExpirationTime(iat + 3600).sign(key);
  } catch {
    throw new AccessError(0, "bad_key");
  }
  let res: Response;
  try {
    res = await (c.fetch ?? fetch)(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new AccessError(0, "unreachable");
  }
  if (!res.ok) throw new AccessError(res.status, res.status === 400 || res.status === 401 ? "key_refused" : "auth_unavailable");
  const j = (await res.json().catch(() => null)) as { access_token?: string } | null;
  if (!j?.access_token) throw new AccessError(res.status, "auth_unavailable");
  cached = { token: j.access_token, until: nowMs + TOKEN_TTL_MS, email: c.account.client_email };
  return j.access_token;
}

/** «اختبر الربط»: only asks Google for the access token — nothing is sent to any phone. The answer is a word, never the key's content. */
export async function checkFcmAccess(c: FcmConfig): Promise<{ ok: true } | { ok: false; reason: string; status: number }> {
  try {
    cached = null;
    await accessToken(c);
    return { ok: true };
  } catch (e) {
    const a = e instanceof AccessError ? e : new AccessError(0, "auth_unavailable");
    return { ok: false, reason: a.reason, status: a.status };
  }
}

/** The body of `messages:send` for one device. Pure, so a test holds its shape. */
export function buildMessage(device: FcmDevice, m: PushMessage): { message: Record<string, unknown> } {
  const https = m.origin.startsWith("https://");
  const target = device.kind === "fcm_fid" ? { fid: device.token } : { token: device.token };
  const absolute = `${m.origin.replace(/\/+$/, "")}${m.href}`;
  return {
    message: {
      ...target,
      notification: { title: m.title, body: m.body },
      // every value is a string (the API refuses anything else)
      data: { href: m.href, id: m.id, kind: m.kind },
      webpush: {
        headers: { Urgency: m.ring ? "high" : "normal", TTL: "86400" },
        notification: {
          tag: `${m.kind}:${m.id}`,
          requireInteraction: m.ring,
          silent: !m.ring,
          dir: "rtl",
          lang: "ar",
          icon: `${m.origin.replace(/\/+$/, "")}/icons/icon-192.png`,
        },
        // the link must be https: on a plain-http (local) site the tap opens through the service worker's own handler
        ...(https ? { fcm_options: { link: absolute } } : {}),
      },
      android: { priority: m.ring ? "HIGH" : "NORMAL" },
    },
  };
}

/** The word FCM gives an error: `error.details[].errorCode` first, else `error.status`. Never the message text. */
function errorWord(body: unknown): { word: string; text: string } {
  const e = (body as { error?: { status?: unknown; message?: unknown; details?: unknown } } | null)?.error;
  const details = Array.isArray(e?.details) ? (e!.details as { errorCode?: unknown }[]) : [];
  const code = details.find((d) => typeof d?.errorCode === "string")?.errorCode;
  return { word: typeof code === "string" ? code : typeof e?.status === "string" ? e.status : "", text: typeof e?.message === "string" ? e.message.toLowerCase() : "" };
}

/** Sends one push. Never throws: what happened is the answer. */
export async function sendFcm(c: FcmConfig, device: FcmDevice, m: PushMessage): Promise<FcmResult> {
  let access: string;
  try {
    access = await accessToken(c);
  } catch (e) {
    const a = e instanceof AccessError ? e : new AccessError(0, "auth_unavailable");
    // a refused key is the owner's to fix (no point in hammering); a network hiccup is tried again
    return { ok: false, invalid: false, retry: a.reason !== "bad_key", status: a.status, reason: a.reason };
  }
  let res: Response;
  try {
    res = await (c.fetch ?? fetch)(SEND(c.projectId), { method: "POST", headers: { authorization: `Bearer ${access}`, "content-type": "application/json" }, body: JSON.stringify(buildMessage(device, m)), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return { ok: false, invalid: false, retry: true, status: 0, reason: "unreachable" };
  }
  if (res.ok) return { ok: true };
  const { word, text } = errorWord(await res.json().catch(() => null));
  const s = res.status;
  if (s === 404 || word === "UNREGISTERED") return { ok: false, invalid: true, retry: false, status: s, reason: "unregistered" };
  if (s === 403 && (word === "SENDER_ID_MISMATCH" || text.includes("sender id"))) return { ok: false, invalid: true, retry: false, status: s, reason: "sender_mismatch" };
  if (s === 400) {
    // a malformed or foreign token ends the device; any other 400 is our own message — not the device's fault
    const aboutDevice = /registration token|installation id|\bfid\b|\btoken\b/.test(text);
    return { ok: false, invalid: aboutDevice, retry: false, status: s, reason: aboutDevice ? "bad_token" : "bad_request" };
  }
  if (s === 401) {
    cached = null;
    return { ok: false, invalid: false, retry: true, status: s, reason: "auth_expired" };
  }
  if (s === 429) return { ok: false, invalid: false, retry: true, status: s, reason: "quota" };
  if (s >= 500) return { ok: false, invalid: false, retry: true, status: s, reason: "unavailable" };
  return { ok: false, invalid: false, retry: false, status: s, reason: word ? word.toLowerCase() : "refused" };
}
