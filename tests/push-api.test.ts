/**
 * The push routes through their real handlers (docs/rebuild-v6/05-notify.md §6): a phone is registered for the person who is signed in and nobody else, the token never comes back,
 * another person's device is «مش موجود», the choices are the person's own and only for the known kinds, the config says what is missing without a value, and the test says the truth.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ user: "u1" as string | null }));
const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-db").makeFakeDb> }));

vi.mock("next/headers", () => ({ cookies: () => ({ get: () => (state.user ? { value: "session" } : undefined) }) }));
vi.mock("@/lib/session-token", async (orig) => ({ ...(await orig<typeof import("@/lib/session-token")>()), authRequired: () => true, readSession: async (v?: string) => (v && state.user ? { sub: state.user, ver: 1 } : null) }));
vi.mock("@/server/db", async () => {
  const { makeFakeDb, addUsers } = await import("./helpers/fake-db");
  h.db = addUsers(makeFakeDb());
  return { db: h.db };
});
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));

import { GET as config } from "@/app/api/push/config/route";
import { DELETE as delByToken, GET as listDevices, POST as register } from "@/app/api/push/devices/route";
import { DELETE as delById } from "@/app/api/push/devices/[id]/route";
import { GET as getPrefs, PUT as putPrefs } from "@/app/api/push/prefs/route";
import { POST as testPush } from "@/app/api/push/test/route";

type Rows = Record<string, any>[];
const rows = (n: string): Rows => (h.db as unknown as Record<string, { rows: Rows }>)[n]!.rows;
const send = (method: string, body?: unknown) => new Request("http://localhost/api/push/x", { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const TOKEN_A = "installation-id-of-phone-A-0001";
const TOKEN_B = "installation-id-of-phone-B-0002";
const ENV_KEYS = ["MOCK_MODE", "FIREBASE_API_KEY", "FIREBASE_PROJECT_ID", "FIREBASE_MESSAGING_SENDER_ID", "FIREBASE_APP_ID", "FIREBASE_VAPID_KEY", "FIREBASE_SERVICE_ACCOUNT_JSON"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  state.user = "u1";
  for (const t of Object.values(h.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
  rows("user").push({ id: "u1", email: "o@x.test", role: "OWNER", active: true, sessionVer: 1 });
  rows("user").push({ id: "u2", email: "m@x.test", role: "MANAGER", active: true, sessionVer: 1 });
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("nobody signed in", () => {
  it("401 on every route, and nothing is written", async () => {
    state.user = null;
    const calls: [string, () => Promise<Response>][] = [
      ["config", () => config()],
      ["list", () => listDevices()],
      ["register", () => register(send("POST", { token: TOKEN_A }))],
      ["forget", () => delByToken(send("DELETE", { token: TOKEN_A }))],
      ["delete", () => delById(send("DELETE"), { params: Promise.resolve({ id: "abcdefgh1234" }) })],
      ["get prefs", () => getPrefs()],
      ["put prefs", () => putPrefs(send("PUT", { "run.stuck": "site" }))],
      ["test", () => testPush(send("POST", {}))],
    ];
    for (const [name, run] of calls) expect((await run()).status, name).toBe(401);
    expect(rows("pushDevice")).toHaveLength(0);
    expect(rows("setting")).toHaveLength(0);
  });
});

describe("registering a phone", () => {
  it("is for the signed-in person only; the token is stored but never comes back, not even in the list", async () => {
    const r = await register(send("POST", { token: TOKEN_A, platform: "android", label: "أندرويد · Chrome" }));
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain(TOKEN_A);
    const body = JSON.parse(text) as { ok: boolean; created: boolean; device: { id: string; label: string; platform: string } };
    expect(body).toMatchObject({ ok: true, created: true, device: { label: "أندرويد · Chrome", platform: "android" } });
    expect(rows("pushDevice")[0]).toMatchObject({ userId: "u1", token: TOKEN_A, kind: "fcm_fid", platform: "android" });
    const list = await (await listDevices()).text();
    expect(list).not.toContain(TOKEN_A);
    expect(JSON.parse(list).devices).toHaveLength(1);
  });

  it("there is no way to register a phone for somebody else: a body that names a user is refused", async () => {
    expect((await register(send("POST", { token: TOKEN_A, userId: "u2" }))).status).toBe(400);
    expect(rows("pushDevice")).toHaveLength(0);
  });

  it("the same token again from the button is a registration (one row, `lastSeenAt` moves, a revoked one comes back), not a second device", async () => {
    await register(send("POST", { token: TOKEN_A }));
    rows("pushDevice")[0]!.revokedAt = new Date();
    rows("pushDevice")[0]!.failedAt = new Date();
    const r = await register(send("POST", { token: TOKEN_A, label: "هاتفي" }));
    expect(JSON.parse(await r.text())).toMatchObject({ created: false });
    expect(rows("pushDevice")).toHaveLength(1);
    expect(rows("pushDevice")[0]).toMatchObject({ revokedAt: null, failedAt: null, label: "هاتفي" });
    expect(rows("pushDevice")[0]!.lastSeenAt).toBeInstanceOf(Date);
  });

  it("the automatic renewal moves `lastSeenAt` of an active row, but never brings back a removed one (and never takes another person's)", async () => {
    const id = JSON.parse(await (await register(send("POST", { token: TOKEN_A }))).text()).device.id as string;
    const row = rows("pushDevice")[0]!;
    row.lastSeenAt = new Date(0);
    const ok = await register(send("POST", { token: TOKEN_A, refreshOf: id }));
    expect(ok.status).toBe(200);
    expect(JSON.parse(await ok.text())).toMatchObject({ created: false });
    expect(row.lastSeenAt!.getTime()).toBeGreaterThan(0);
    // a rotated Installation ID follows the same row
    expect((await register(send("POST", { token: TOKEN_B, refreshOf: id }))).status).toBe(200);
    expect(rows("pushDevice")).toHaveLength(1);
    expect(row.token).toBe(TOKEN_B);
    // «شيله»: the device is revoked, and the renewal that every open sends does not revive it
    row.revokedAt = new Date();
    const gone = await register(send("POST", { token: TOKEN_B, refreshOf: id }));
    expect(gone.status).toBe(404);
    expect(row.revokedAt).toBeInstanceOf(Date);
    expect(JSON.parse(await (await listDevices()).text()).devices).toHaveLength(0);
    // another person cannot renew this row, and a made-up id is «مش موجود»
    state.user = "u2";
    expect((await register(send("POST", { token: TOKEN_B, refreshOf: id }))).status).toBe(404);
    expect((await register(send("POST", { token: TOKEN_B, refreshOf: "nope" }))).status).toBe(404);
    expect(row.revokedAt).toBeInstanceOf(Date);
    // only the button (a plain registration) brings it back
    state.user = "u1";
    expect((await register(send("POST", { token: TOKEN_B }))).status).toBe(200);
    expect(row.revokedAt).toBeNull();
  });

  it("a bad token or platform is refused with a sentence", async () => {
    for (const bad of [{ token: "short" }, { token: "has spaces in it 12345" }, { token: TOKEN_A, platform: "toaster" }, { token: TOKEN_A, kind: "apns" }, {}, null]) {
      const r = await register(send("POST", bad));
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(JSON.parse(await r.text()).error).toBeTruthy();
    }
  });

  it("the demo site registers nothing", async () => {
    process.env.MOCK_MODE = "1";
    expect((await register(send("POST", { token: TOKEN_A }))).status).toBe(409);
    expect(rows("pushDevice")).toHaveLength(0);
  });
});

describe("«شيله» and «جرّب»", () => {
  it("the person removes their own device (it is revoked, not deleted); another person's id is «مش موجود» and stays", async () => {
    await register(send("POST", { token: TOKEN_A }));
    state.user = "u2";
    await register(send("POST", { token: TOKEN_B }));
    const mine = rows("pushDevice").find((d) => d.userId === "u2")!;
    const theirs = rows("pushDevice").find((d) => d.userId === "u1")!;
    const no = await delById(send("DELETE"), { params: Promise.resolve({ id: theirs.id }) });
    expect(no.status).toBe(404);
    expect(theirs.revokedAt).toBeNull();
    const yes = await delById(send("DELETE"), { params: Promise.resolve({ id: mine.id }) });
    expect(yes.status).toBe(200);
    expect(mine.revokedAt).toBeInstanceOf(Date);
    expect(rows("pushDevice")).toHaveLength(2);
    expect(JSON.parse(await (await listDevices()).text()).devices).toHaveLength(0);
    // a made-up id is just as «مش موجود»
    expect((await delById(send("DELETE"), { params: Promise.resolve({ id: "../etc/passwd" }) })).status).toBe(404);
  });

  it("a browser that stops its own pushes (by its token) removes only its own", async () => {
    await register(send("POST", { token: TOKEN_A }));
    state.user = "u2";
    expect(JSON.parse(await (await delByToken(send("DELETE", { token: TOKEN_A }))).text())).toEqual({ ok: true, removed: 0 });
    expect(rows("pushDevice")[0]!.revokedAt).toBeNull();
    state.user = "u1";
    expect(JSON.parse(await (await delByToken(send("DELETE", { token: TOKEN_A }))).text())).toEqual({ ok: true, removed: 1 });
    expect(rows("pushDevice")[0]!.revokedAt).toBeInstanceOf(Date);
  });

  it("the test says the truth: not set up → «setup_needed»; and one test at a time", async () => {
    const first = await testPush(send("POST", {}));
    expect(JSON.parse(await first.text())).toEqual({ ok: false, sent: 0, failed: 0, reason: "setup_needed" });
    const again = await testPush(send("POST", {}));
    expect(again.status).toBe(429);
    expect(rows("notification")).toHaveLength(0);
  });
});

describe("the person's choices", () => {
  it("are saved for the known kinds only, merged with what was there, and are the person's own", async () => {
    expect(JSON.parse(await (await getPrefs()).text())).toEqual({ prefs: {} });
    const a = await putPrefs(send("PUT", { "run.stuck": "site", "run.done": "silent" }));
    expect(JSON.parse(await a.text()).prefs).toEqual({ "run.stuck": "site", "run.done": "silent" });
    const b = await putPrefs(send("PUT", { "run.stuck": "ring", "no.such.kind": "ring" }));
    expect(JSON.parse(await b.text()).prefs).toEqual({ "run.stuck": "ring", "run.done": "silent" });
    expect(rows("setting").map((r) => r.key)).toEqual(["notify.prefs:u1"]);
    state.user = "u2";
    expect(JSON.parse(await (await getPrefs()).text())).toEqual({ prefs: {} });
  });

  it("a choice that is not ring · silent · site is refused", async () => {
    for (const bad of [{ "run.stuck": "loud" }, { "run.stuck": 3 }, [], "x", null]) expect((await putPrefs(send("PUT", bad))).status, JSON.stringify(bad)).toBe(400);
    expect(rows("setting")).toHaveLength(0);
  });
});

describe("the config", () => {
  it("nothing set → not configured, and the NAMES of what is missing (never a value)", async () => {
    const j = JSON.parse(await (await config()).text());
    expect(j.configured).toBe(false);
    expect(j.web).toBeNull();
    expect(j.missing).toHaveLength(6);
  });

  it("everything set → the five public values for the browser; the service account's file is never in the answer", async () => {
    process.env.FIREBASE_API_KEY = "api-key-public";
    process.env.FIREBASE_PROJECT_ID = "my-project";
    process.env.FIREBASE_MESSAGING_SENDER_ID = "123456";
    process.env.FIREBASE_APP_ID = "1:123456:web:abc";
    process.env.FIREBASE_VAPID_KEY = "vapid-public-key";
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "svc@p.iam.gserviceaccount.com", private_key: "THE-SECRET-KEY-MATERIAL" });
    const text = await (await config()).text();
    expect(text).not.toContain("THE-SECRET-KEY-MATERIAL");
    expect(text).not.toContain("svc@p");
    expect(JSON.parse(text)).toEqual({ configured: true, missing: [], web: { apiKey: "api-key-public", projectId: "my-project", messagingSenderId: "123456", appId: "1:123456:web:abc", vapidKey: "vapid-public-key" } });
  });

  it("the demo site says so", async () => {
    process.env.MOCK_MODE = "1";
    expect(JSON.parse(await (await config()).text())).toMatchObject({ configured: false, demo: true });
  });
});
