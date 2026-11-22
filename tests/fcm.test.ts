/**
 * The Firebase adapter (src/adapters/fcm.ts) against a pretend server: the shape of the request, the access token (made once, kept), the tokens FCM refuses for good, the answers that are tried
 * again, and that no key or token is ever in a log or an answer. The key pair is made here, at run time — nothing secret is written in this file.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exportPKCS8, generateKeyPair, jwtVerify, exportSPKI, importSPKI } from "jose";
import { FCM_SCOPE, buildMessage, checkFcmAccess, fcmFromEnv, firebaseMissing, resetFcmTokenCache, sendFcm, webConfigFromEnv, type FcmConfig, type PushMessage } from "@/adapters/fcm";

let privateKey = "";
let publicKey = "";
beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = await exportPKCS8(pair.privateKey);
  publicKey = await exportSPKI(pair.publicKey);
});

const MSG: PushMessage = { title: "بدّها قرارك: تكبير «حرير 3»", body: "من 50$ لـ 60$. اضغط تفتح القرار.", href: "/inbox/approval%3Aa1", id: "n1", kind: "approval.new", ring: true, origin: "https://mb.example.test" };
const DEVICE = { kind: "fcm_fid", token: "device-installation-id-0001" };

interface Call {
  url: string;
  init: RequestInit;
}
function server(answers: { token?: () => Response; send?: () => Response } = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url === "https://oauth2.googleapis.com/token") return answers.token?.() ?? new Response(JSON.stringify({ access_token: "test-access-token-XYZ", expires_in: 3600 }), { status: 200 });
    return answers.send?.() ?? new Response(JSON.stringify({ name: "projects/p/messages/1" }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const cfg = (fetchImpl: typeof fetch, now?: () => number): FcmConfig => ({ projectId: "my-project", account: { client_email: "svc@my-project.iam.gserviceaccount.com", private_key: privateKey }, fetch: fetchImpl, now });
const errorBody = (status: number, word: string, text = "x", details?: unknown) => () => new Response(JSON.stringify({ error: { code: status, status: word, message: text, ...(details ? { details } : {}) } }), { status });

beforeEach(() => resetFcmTokenCache());
afterEach(() => vi.restoreAllMocks());

describe("the message (HTTP v1)", () => {
  it("a Firebase Installation ID goes in `fid`; an older registration token in `token`; every `data` value is a string", () => {
    const m = buildMessage(DEVICE, MSG).message as Record<string, any>;
    expect(m.fid).toBe(DEVICE.token);
    expect(m.token).toBeUndefined();
    expect(m.notification).toEqual({ title: MSG.title, body: MSG.body });
    expect(m.data).toEqual({ href: MSG.href, id: "n1", kind: "approval.new" });
    for (const v of Object.values(m.data)) expect(typeof v).toBe("string");
    const old = buildMessage({ kind: "fcm", token: "registration-token-0002" }, MSG).message as Record<string, any>;
    expect(old.token).toBe("registration-token-0002");
    expect(old.fid).toBeUndefined();
  });

  it("a ringing one: Urgency high, it stays on the screen, with a sound; `android.priority` is the enum HIGH; the fields are snake_case", () => {
    const m = buildMessage(DEVICE, MSG).message as Record<string, any>;
    expect(m.webpush.headers).toEqual({ Urgency: "high", TTL: "86400" });
    expect(m.webpush.notification).toMatchObject({ tag: "approval.new:n1", requireInteraction: true, silent: false, dir: "rtl", lang: "ar", icon: "https://mb.example.test/icons/icon-192.png" });
    expect(m.webpush.fcm_options).toEqual({ link: "https://mb.example.test/inbox/approval%3Aa1" });
    expect(m.android).toEqual({ priority: "HIGH" });
    expect(m.webpush.fcmOptions).toBeUndefined();
  });

  it("a quiet one: normal urgency, no sound, not kept on the screen", () => {
    const m = buildMessage(DEVICE, { ...MSG, ring: false }).message as Record<string, any>;
    expect(m.webpush.headers.Urgency).toBe("normal");
    expect(m.webpush.notification).toMatchObject({ requireInteraction: false, silent: true });
    expect(m.android.priority).toBe("NORMAL");
  });

  it("over plain http (a local site) there is no `fcm_options.link` (FCM wants https); the service worker opens `data.href` itself", () => {
    const m = buildMessage(DEVICE, { ...MSG, origin: "http://localhost:3140" }).message as Record<string, any>;
    expect(m.webpush.fcm_options).toBeUndefined();
    expect(m.data.href).toBe(MSG.href);
  });
});

describe("sending", () => {
  it("makes an access token (a JWT signed RS256 with the service account's key, scope firebase.messaging) and posts the message to the project's address", async () => {
    const s = server();
    const r = await sendFcm(cfg(s.fetchImpl), DEVICE, MSG);
    expect(r).toEqual({ ok: true });
    const [auth, send] = s.calls;
    expect(auth!.url).toBe("https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(String(auth!.init.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const { payload, protectedHeader } = await jwtVerify(form.get("assertion")!, await importSPKI(publicKey, "RS256"), { issuer: "svc@my-project.iam.gserviceaccount.com", audience: "https://oauth2.googleapis.com/token" });
    expect(protectedHeader.alg).toBe("RS256");
    expect(payload.scope).toBe(FCM_SCOPE);
    expect(FCM_SCOPE).toBe("https://www.googleapis.com/auth/firebase.messaging");
    expect(send!.url).toBe("https://fcm.googleapis.com/v1/projects/my-project/messages:send");
    expect(send!.init.method).toBe("POST");
    expect((send!.init.headers as Record<string, string>).authorization).toBe("Bearer test-access-token-XYZ");
    expect(JSON.parse(String(send!.init.body)).message.fid).toBe(DEVICE.token);
  });

  it("keeps the access token for 50 minutes (one exchange for many sends), then asks again", async () => {
    const s = server();
    let t = 1_000_000;
    const c = cfg(s.fetchImpl, () => t);
    await sendFcm(c, DEVICE, MSG);
    await sendFcm(c, DEVICE, MSG);
    t += 40 * 60_000;
    await sendFcm(c, DEVICE, MSG);
    expect(s.calls.filter((x) => x.url.includes("oauth2")).length).toBe(1);
    t += 15 * 60_000; // 55 minutes in
    await sendFcm(c, DEVICE, MSG);
    expect(s.calls.filter((x) => x.url.includes("oauth2")).length).toBe(2);
  });

  it("404 UNREGISTERED: the device is gone — never tried again", async () => {
    const r = await sendFcm(cfg(server({ send: errorBody(404, "NOT_FOUND", "Requested entity was not found.", [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }]) }).fetchImpl), DEVICE, MSG);
    expect(r).toEqual({ ok: false, invalid: true, retry: false, status: 404, reason: "unregistered" });
  });

  it("403 SENDER_ID_MISMATCH: a device from another project is dropped", async () => {
    const r = await sendFcm(cfg(server({ send: errorBody(403, "PERMISSION_DENIED", "SenderId mismatch", [{ errorCode: "SENDER_ID_MISMATCH" }]) }).fetchImpl), DEVICE, MSG);
    expect(r).toMatchObject({ ok: false, invalid: true, retry: false, reason: "sender_mismatch" });
  });

  it("400 about the token ends the device; any other 400 is OUR message, not the device's fault", async () => {
    const bad = await sendFcm(cfg(server({ send: errorBody(400, "INVALID_ARGUMENT", "The registration token is not a valid FCM registration token") }).fetchImpl), DEVICE, MSG);
    expect(bad).toMatchObject({ invalid: true, retry: false, reason: "bad_token" });
    const ours = await sendFcm(cfg(server({ send: errorBody(400, "INVALID_ARGUMENT", "Invalid JSON payload received. Unknown name") }).fetchImpl), DEVICE, MSG);
    expect(ours).toMatchObject({ invalid: false, retry: false, reason: "bad_request" });
  });

  it("503 and 500 are tried again later; 429 (quota) too", async () => {
    for (const [status, word, reason] of [[503, "UNAVAILABLE", "unavailable"], [500, "INTERNAL", "unavailable"], [429, "RESOURCE_EXHAUSTED", "quota"]] as const) {
      resetFcmTokenCache();
      const r = await sendFcm(cfg(server({ send: errorBody(status, word) }).fetchImpl), DEVICE, MSG);
      expect(r, String(status)).toEqual({ ok: false, invalid: false, retry: true, status, reason });
    }
  });

  it("401 on the send forgets the access token (the next try makes a new one) and is tried again", async () => {
    const s = server({ send: errorBody(401, "UNAUTHENTICATED") });
    const c = cfg(s.fetchImpl);
    expect(await sendFcm(c, DEVICE, MSG)).toMatchObject({ retry: true, reason: "auth_expired" });
    await sendFcm(c, DEVICE, MSG);
    expect(s.calls.filter((x) => x.url.includes("oauth2")).length).toBe(2);
  });

  it("the network down: tried again; Google refusing the key: a word for the owner, not hammered", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await sendFcm(cfg(down), DEVICE, MSG)).toMatchObject({ ok: false, retry: true, reason: "unreachable" });
    resetFcmTokenCache();
    const refused = await sendFcm(cfg(server({ token: () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }) }).fetchImpl), DEVICE, MSG);
    expect(refused).toMatchObject({ ok: false, invalid: false, retry: true, reason: "key_refused" });
    resetFcmTokenCache();
    const broken = await sendFcm({ ...cfg(server().fetchImpl), account: { client_email: "a@b", private_key: "not a key" } }, DEVICE, MSG);
    expect(broken).toMatchObject({ ok: false, retry: false, reason: "bad_key" });
  });

  it("no key and no token is ever in a log or in an answer", async () => {
    const logs: string[] = [];
    for (const m of ["log", "error", "warn", "info"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
    const answers = [
      await sendFcm(cfg(server({ send: errorBody(404, "NOT_FOUND", `token ${DEVICE.token} is gone`) }).fetchImpl), DEVICE, MSG),
      await sendFcm(cfg(server({ send: errorBody(503, "UNAVAILABLE") }).fetchImpl), DEVICE, MSG),
      await sendFcm({ ...cfg(server().fetchImpl), account: { client_email: "a@b", private_key: "not a key" } }, DEVICE, MSG),
      await sendFcm(cfg(server({ token: () => new Response("{}", { status: 400 }) }).fetchImpl), DEVICE, MSG),
    ];
    const text = JSON.stringify(answers) + logs.join("\n");
    expect(text).not.toContain(DEVICE.token);
    expect(text).not.toContain("PRIVATE KEY");
    expect(text).not.toContain("test-access-token");
    expect(text).not.toContain(privateKey.slice(40, 80));
  });
});

describe("«اختبر الربط»: asks for the access token and sends nothing", () => {
  it("good key → ok, and no message was posted", async () => {
    const s = server();
    expect(await checkFcmAccess(cfg(s.fetchImpl))).toEqual({ ok: true });
    expect(s.calls.map((c) => c.url)).toEqual(["https://oauth2.googleapis.com/token"]);
  });
  it("refused key → a word and the status", async () => {
    const s = server({ token: () => new Response("{}", { status: 401 }) });
    expect(await checkFcmAccess(cfg(s.fetchImpl))).toEqual({ ok: false, reason: "key_refused", status: 401 });
  });
});

describe("the connection as the environment holds it", () => {
  const file = () => JSON.stringify({ type: "service_account", client_email: "svc@p.iam.gserviceaccount.com", private_key: privateKey, project_id: "from-the-file" });
  it("none → null (the page says «لازم تربط Firebase»); a file alone is enough to send, its own project id is used when FIREBASE_PROJECT_ID is not there", () => {
    expect(fcmFromEnv({})).toBeNull();
    expect(fcmFromEnv({ FIREBASE_SERVICE_ACCOUNT_JSON: "{not json" })).toBeNull();
    expect(fcmFromEnv({ FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "a@b" }) })).toBeNull();
    expect(fcmFromEnv({ FIREBASE_SERVICE_ACCOUNT_JSON: file() })?.projectId).toBe("from-the-file");
    expect(fcmFromEnv({ FIREBASE_SERVICE_ACCOUNT_JSON: file(), FIREBASE_PROJECT_ID: "mine" })?.projectId).toBe("mine");
    expect(fcmFromEnv({ FIREBASE_SERVICE_ACCOUNT_JSON: Buffer.from(file()).toString("base64") })?.account.client_email).toBe("svc@p.iam.gserviceaccount.com");
  });
  it("the browser's values come only when all five are there, and what is missing is named (names, never values)", () => {
    const all = { FIREBASE_API_KEY: "k", FIREBASE_PROJECT_ID: "p", FIREBASE_MESSAGING_SENDER_ID: "1", FIREBASE_APP_ID: "a", FIREBASE_VAPID_KEY: "v", FIREBASE_SERVICE_ACCOUNT_JSON: "{}" };
    expect(webConfigFromEnv(all)).toEqual({ apiKey: "k", projectId: "p", messagingSenderId: "1", appId: "a", vapidKey: "v" });
    expect(webConfigFromEnv({ ...all, FIREBASE_APP_ID: " " })).toBeNull();
    expect(firebaseMissing(all)).toEqual([]);
    expect(firebaseMissing({ FIREBASE_API_KEY: "k" })).toEqual(["FIREBASE_PROJECT_ID", "FIREBASE_MESSAGING_SENDER_ID", "FIREBASE_APP_ID", "FIREBASE_VAPID_KEY", "FIREBASE_SERVICE_ACCOUNT_JSON"]);
    expect(firebaseMissing({})).toHaveLength(6);
  });
});
