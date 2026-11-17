/**
 * «الإعدادات ← الربط» — secrets entered from the site (D62), end to end on the local database through the real route handlers:
 * a saved secret is in NO HTTP response, NO log line, NO audit row and NOT in the table in the clear; the environment is the fallback and comes back on «امسح»;
 * a second process picks a change up by reloading; «اختبر الربط» sends the key only in the header; «اربط ← اسمح» works against a fake authorization server
 * (discovery, registration, PKCE, code exchange, renewal, a revoked grant). Who may call at all (403) is proven in tests/connections-routes.test.ts.
 * `npx tsx --env-file=.env scripts/demo-secrets.ts`  (the database from `docker compose up -d`, migrated)
 */
process.env.MOCK_MODE = "0";
process.env.AUTH_REQUIRED = "0"; // the demo owner answers (the 403 for everybody else is in the unit tests)
process.env.APP_URL = "http://localhost:3140";
process.env.TELEGRAM_BOT_TOKEN = "";

import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { driveFromEnv } from "../src/adapters/drive";
import { db } from "../src/server/db";
import { GET as listRoute } from "../src/app/api/connections/route";
import { PUT as putRoute, DELETE as delRoute } from "../src/app/api/connections/field/[name]/route";
import { POST as testRoute } from "../src/app/api/connections/row/[key]/test/route";
import { POST as linkRoute, DELETE as unlinkRoute } from "../src/app/api/connections/row/[key]/link/route";
import { GET as callbackRoute } from "../src/app/oauth/callback/route";
import { clearField, connectionsView, reloadOverlay, saveField, storedValues } from "../src/server/connections";
import { refreshDueLinks } from "../src/server/oauth-client";
import { testRow } from "../src/server/connection-tests";
import { sealSecret } from "../src/server/secrets";

const out = console.log.bind(console);
const logged: string[] = [];
for (const m of ["log", "info", "warn", "error", "debug"] as const) console[m] = (...a: unknown[]) => void logged.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
const say = (s: string) => out(s);
const check = (ok: boolean, label: string, extra?: unknown) => {
  say(`${ok ? "✓" : "✗"} ${label}${!ok && extra !== undefined ? ` — ${typeof extra === "string" ? extra : JSON.stringify(extra)}` : ""}`);
  if (!ok) process.exitCode = 1;
};

const SECRET = `EAAB${randomBytes(18).toString("hex")}Z9y8`;
const LAST4 = SECRET.slice(-4);
const body = (value: string) => new Request("http://localhost/x", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value }) });
const NAME = (n: string) => ({ params: { name: n } });
const KEY = (k: string) => ({ params: { key: k } });
const DEL = new Request("http://localhost/x", { method: "DELETE" });
const POST = new Request("http://localhost/x", { method: "POST" });

const NAMES = ["META_SYSTEM_USER_TOKEN", "GOOGLE_SERVICE_ACCOUNT_JSON", "DRIVE_STUDIO_FOLDER_ID", "OMS_BASE_URL", "OMS_TOKEN", "OMS_TOKEN__REFRESH", "OMS_TOKEN__EXPIRES", "OMS_TOKEN__STATE", "OMS_EVENT_SECRET"];
const g = globalThis as { __mbOverlay?: unknown };

async function clean() {
  await db.connectionSetting.deleteMany({ where: { name: { in: NAMES } } });
  await db.oAuthLinkClient.deleteMany({ where: { key: "oms" } });
  await db.oAuthLinkPending.deleteMany({ where: { key: "oms" } });
  await db.auditLog.deleteMany({ where: { OR: [{ action: { startsWith: "connection." } }, { action: { startsWith: "oauth_link." } }] } });
}

/** everything an attacker could read: every response body so far, every log line, every audit row, every stored row */
const everything = async (responses: string[]) => JSON.stringify([responses, logged, await db.auditLog.findMany(), await db.connectionSetting.findMany(), await db.oAuthLinkPending.findMany(), await db.oAuthLinkClient.findMany()]);

(async () => {
  await clean();
  delete g.__mbOverlay;
  const responses: string[] = [];
  const keep = async (r: Response) => {
    const t = await r.text();
    responses.push(t);
    return { status: r.status, text: t, json: (() => { try { return JSON.parse(t); } catch { return null; } })() as any, headers: r.headers };
  };

  say("— no master key: a secret is refused with the sentence; a plain value still saves");
  delete process.env.SECRETS_MASTER_KEY;
  const r0 = await keep(await putRoute(body(SECRET), NAME("META_SYSTEM_USER_TOKEN")));
  check(r0.status === 409 && /SECRETS_MASTER_KEY/.test(r0.json?.error ?? ""), "saving a key without SECRETS_MASTER_KEY → 409 that says what to set", r0);
  check((await db.connectionSetting.count({ where: { name: "META_SYSTEM_USER_TOKEN" } })) === 0, "…and nothing was stored (never a silent plaintext)");
  const r0b = await keep(await putRoute(body("https://oms.example.test/"), NAME("OMS_BASE_URL")));
  check(r0b.status === 200 && process.env.OMS_BASE_URL === "https://oms.example.test", "an address saves without the master key and applies at once (no redeploy)", r0b);
  const v0 = await connectionsView();
  check(v0.masterKey === false && v0.rows.find((r) => r.key === "meta")!.fields[0]!.source === "none", "the view says: master key missing, Meta key «ناقص» (empty row)");

  say("— with the master key: save, view, and where the secret is NOT");
  process.env.SECRETS_MASTER_KEY = randomBytes(32).toString("base64");
  process.env.META_SYSTEM_USER_TOKEN = "coolify-meta-value-0000"; // what Coolify holds today
  await reloadOverlay();
  const before = await keep(await listRoute());
  const metaBefore = before.json.rows.find((r: any) => r.key === "meta").fields[0];
  check(metaBefore.source === "env" && !JSON.stringify(before.json).includes("coolify-meta-value-0000"), "before saving: «من Coolify ✓» (source env) and the env value is not shown");
  const put = await keep(await putRoute(body(SECRET), NAME("META_SYSTEM_USER_TOKEN")));
  check(put.status === 200 && put.json?.last4 === LAST4 && !put.text.includes(SECRET), "PUT → 200 with only the last four; the response does not contain the key", put.text);
  check(put.headers.get("cache-control") === "no-store", "…and is not cacheable");
  const list = await keep(await listRoute());
  const meta = list.json.rows.find((r: any) => r.key === "meta").fields[0];
  check(meta.source === "app" && meta.last4 === LAST4 && !!meta.updatedAt && meta.value === undefined && !list.text.includes(SECRET), "GET → «محفوظ ✓» with date, last 4, and NO value field; the key is not in the body", meta);
  check(process.env.META_SYSTEM_USER_TOKEN === SECRET, "hot reload: the running app uses the new value immediately, without a redeploy");
  const row = await db.connectionSetting.findUnique({ where: { name: "META_SYSTEM_USER_TOKEN" } });
  check(!!row && row.secret && row.valuePlain === null && !!row.valueEnc?.startsWith("s1:") && !JSON.stringify(row).includes(SECRET) && !JSON.stringify(row).includes(SECRET.slice(0, 10)), "the table holds an AES-256-GCM blob — no plaintext, no readable piece");
  const audits = await db.auditLog.findMany({ where: { action: "connection.save" } });
  check(audits.length >= 1 && audits.every((a) => !JSON.stringify(a).includes(SECRET)), "the audit row names the field and who, never the value", audits.map((a) => a.after));
  check(!logged.join("\n").includes(SECRET), "no log line contains the key");

  // the negative control: the checks above would catch a careless serializer
  const leaky = JSON.stringify({ rows: await db.connectionSetting.findMany(), stored: await storedValues() });
  check(leaky.includes(SECRET), "negative control: a serializer that also returns the decrypted values WOULD be caught by this check");

  say("— a second process (the worker) sees a change by reloading");
  const other = `EAAB${randomBytes(12).toString("hex")}Q1w2`;
  await db.connectionSetting.update({ where: { name: "META_SYSTEM_USER_TOKEN" }, data: { valueEnc: sealSecret("META_SYSTEM_USER_TOKEN", other) } });
  check(process.env.META_SYSTEM_USER_TOKEN === SECRET, "before its reload tick the other process still has the old value");
  await reloadOverlay();
  check(process.env.META_SYSTEM_USER_TOKEN === other, "after the reload tick (every 30 s) it has the new one");
  await saveField("META_SYSTEM_USER_TOKEN", SECRET, "demo-owner");

  say("— «امسح»: the site's value goes and Coolify's comes back");
  const d = await keep(await delRoute(DEL, NAME("META_SYSTEM_USER_TOKEN")));
  check(d.status === 200 && process.env.META_SYSTEM_USER_TOKEN === "coolify-meta-value-0000", "after delete the environment's value is the one in use again (current setups keep working)");
  check((await db.connectionSetting.count({ where: { name: "META_SYSTEM_USER_TOKEN" } })) === 0, "…and the row is gone");
  check((await db.auditLog.count({ where: { action: "connection.delete" } })) >= 1, "delete is audited");
  await saveField("META_SYSTEM_USER_TOKEN", SECRET, "demo-owner");

  say("— env fallback for a plain value, and in-app wins over it");
  process.env.DRIVE_STUDIO_FOLDER_ID = "coolifyFolder111";
  await reloadOverlay();
  let f = (await connectionsView()).rows.find((r) => r.key === "drive")!.fields.find((x) => x.name === "DRIVE_STUDIO_FOLDER_ID")!;
  check(f.source === "env" && f.value === "coolifyFolder111", "nothing saved → the environment's folder id is used and shown (not a secret)");
  await keep(await putRoute(body("siteFolder222"), NAME("DRIVE_STUDIO_FOLDER_ID")));
  check(process.env.DRIVE_STUDIO_FOLDER_ID === "siteFolder222", "saved on the site → wins");
  await keep(await delRoute(DEL, NAME("DRIVE_STUDIO_FOLDER_ID")));
  check(process.env.DRIVE_STUDIO_FOLDER_ID === "coolifyFolder111", "deleted → Coolify's again");
  const bad = await keep(await putRoute(body("not a folder id; drop"), NAME("DRIVE_STUDIO_FOLDER_ID")));
  check(bad.status === 400 && !bad.text.includes("drop"), "a malformed value is refused and the answer does not repeat it");
  const unknown = await keep(await putRoute(body("whatever-value-123"), NAME("META_WRITE_MODE")));
  check(unknown.status === 400, "a name that is not on the page (the Meta write lock) cannot be written from the site");

  say("— the Google service-account file");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const file = JSON.stringify({ type: "service_account", client_email: "mb@demo-project.iam.gserviceaccount.com", private_key: pem, token_uri: "https://oauth2.googleapis.com/token" });
  const fr = await keep(await putRoute(body(file), NAME("GOOGLE_SERVICE_ACCOUNT_JSON")));
  const view = await keep(await listRoute());
  check(fr.status === 200 && !fr.text.includes("PRIVATE KEY") && !view.text.includes("PRIVATE KEY") && !view.text.includes("demo-project.iam"), "uploaded: not a trace of the file's content in either answer");
  check(driveFromEnv() !== null, "the Drive adapter reads it from the environment as it always did");
  const notSa = await keep(await putRoute(body(JSON.stringify({ hello: "world" })), NAME("GOOGLE_SERVICE_ACCOUNT_JSON")));
  check(notSa.status === 400, "a JSON that is not a service-account file is refused");

  say("— «اختبر الربط»: one read-only call, the key only in the header");
  const seen: { url: string; auth: string | null; method: string }[] = [];
  const meta200: typeof fetch = async (url, init) => (seen.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), method: init?.method ?? "GET" }), new Response(JSON.stringify({ id: "1", name: "كيوان 3" }), { status: 200 }));
  const t1 = await testRow("meta", "demo-owner", meta200);
  check(t1.ok && seen.length === 1 && seen[0]!.method === "GET" && seen[0]!.auth === `Bearer ${SECRET}` && !seen[0]!.url.includes(SECRET), "meta: one GET /me with the key in the Authorization header only (not in the URL)");
  check(t1.ok && !t1.message.includes(SECRET), "…and the ✓ message does not repeat it", t1.message);
  const t2 = await testRow("meta", "demo-owner", async () => new Response("{}", { status: 401 }));
  check(!t2.ok && /رفض/.test(t2.message) && !t2.message.includes(SECRET), "401 → the exact Arabic reason", t2.message);
  const t3 = await testRow("meta", "demo-owner", async () => { throw new Error(`boom ${SECRET}`); });
  check(!t3.ok && /ما قدرت أوصل/.test(t3.message) && !t3.message.includes(SECRET), "network failure → «ما قدرت أوصل», without the error text", t3.message);
  const t4 = await testRow("oms", "demo-owner", async () => new Response("{}", { status: 200 }));
  check(!t4.ok && /الـOMS|اربط/.test(t4.message), "OMS not linked yet → says what is missing, makes no call", t4.message);
  const route = await keep(await testRoute(POST, KEY("telegram")));
  check(route.status === 200 && route.json?.ok === false, "a row with nothing to test answers honestly (not ✓)");
  check((await db.auditLog.count({ where: { action: "connection.test" } })) >= 4, "every test is audited (key and result only)");

  say("— «اربط ← اسمح» against a fake authorization server (OMS)");
  const AS = "https://oms.example.test";
  let challenge = "";
  let issued = 0;
  let revoked = false;
  const registered: unknown[] = [];
  const fakeAs: typeof fetch = async (url, init) => {
    const u = new URL(String(url));
    const form = init?.body ? new URLSearchParams(String(init.body)) : null;
    if (u.pathname === "/.well-known/oauth-authorization-server") return new Response(JSON.stringify({ issuer: AS, authorization_endpoint: `${AS}/oauth/authorize`, token_endpoint: `${AS}/oauth/token`, registration_endpoint: `${AS}/oauth/register`, code_challenge_methods_supported: ["S256"] }), { status: 200 });
    if (u.pathname === "/oauth/register") {
      registered.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ client_id: "client-abc" }), { status: 201 });
    }
    if (u.pathname === "/oauth/token" && form?.get("grant_type") === "authorization_code") {
      const ok = form.get("code") === "code-1" && createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url") === challenge && form.get("redirect_uri") === "http://localhost:3140/oauth/callback";
      if (!ok) return new Response("{}", { status: 400 });
      issued++;
      return new Response(JSON.stringify({ access_token: `at-${issued}-${randomBytes(6).toString("hex")}`, refresh_token: `rt-${issued}-${randomBytes(6).toString("hex")}`, expires_in: 3600, event_signing_secret: `ess-${randomBytes(8).toString("hex")}` }), { status: 200 });
    }
    if (u.pathname === "/oauth/token" && form?.get("grant_type") === "refresh_token") {
      if (revoked) return new Response("{}", { status: 400 });
      issued++;
      return new Response(JSON.stringify({ access_token: `at-${issued}-${randomBytes(6).toString("hex")}`, refresh_token: `rt-${issued}-${randomBytes(6).toString("hex")}`, expires_in: 3600 }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
  // the route calls the real fetch; to keep this offline the begin/complete steps use the services directly (the routes are the same one-liners)
  const svc = await import("../src/server/oauth-client");
  const begun = await svc.beginLink("oms", "demo-owner", fakeAs);
  const au = new URL(begun.url);
  challenge = au.searchParams.get("code_challenge") ?? "";
  const state = au.searchParams.get("state") ?? "";
  check(au.origin === AS && au.pathname === "/oauth/authorize" && au.searchParams.get("code_challenge_method") === "S256" && au.searchParams.get("client_id") === "client-abc" && au.searchParams.get("redirect_uri") === "http://localhost:3140/oauth/callback", "«اربط»: the owner is sent to the OTHER system's consent screen with PKCE S256 and our callback", begun.url);
  check(!begun.url.includes("verifier") && JSON.stringify(registered).includes("localhost:3140/oauth/callback") && JSON.stringify(registered).includes('"none"'), "registered as a public client with our redirect address (no secret anywhere)");
  const pend = await db.oAuthLinkPending.findUnique({ where: { state } });
  check(!!pend && pend.verifierEnc.startsWith("s1:"), "the PKCE verifier waits sealed in the table, not in the clear");
  const wrong = await svc.completeLink("not-the-state", "code-1", "demo-owner", fakeAs).then(() => "ok", (e) => (e as Error).message);
  check(wrong !== "ok", "a callback with a state we did not make completes nothing", wrong);
  const other2 = await svc.completeLink(state, "code-1", "someone-else", fakeAs).then(() => "ok", (e) => (e as Error).message);
  check(other2 !== "ok", "a state started by the owner cannot be completed by another person");
  const begun2 = await svc.beginLink("oms", "demo-owner", fakeAs);
  const au2 = new URL(begun2.url);
  challenge = au2.searchParams.get("code_challenge") ?? "";
  const done = await svc.completeLink(au2.searchParams.get("state")!, "code-1", "demo-owner", fakeAs);
  check(done.key === "oms" && !!process.env.OMS_TOKEN?.startsWith("at-1-") && !!process.env.OMS_EVENT_SECRET?.startsWith("ess-"), "«اسمح»: the code is exchanged server-side; the token and the event-signing secret are stored and live in the environment (adapters read OMS_TOKEN as before)");
  const reuse = await svc.completeLink(au2.searchParams.get("state")!, "code-1", "demo-owner", fakeAs).then(() => "ok", (e) => (e as Error).message);
  check(reuse !== "ok", "the same state cannot be used twice");
  const tokRow = await db.connectionSetting.findUnique({ where: { name: "OMS_TOKEN" } });
  check(!!tokRow && tokRow.source === "oauth" && tokRow.secret && !!tokRow.valueEnc?.startsWith("s1:"), "the token is sealed in the table and marked as obtained by «اربط»");
  const linkView = (await keep(await listRoute())).json.rows.find((r: any) => r.key === "oms");
  check(linkView.link.state === "linked" && !JSON.stringify(linkView).includes("at-1-") && !JSON.stringify(linkView).includes("ess-"), "the page shows «مربوط ✓» without the token or the signing secret");
  const cb = await callbackRoute(new Request("http://localhost:3140/oauth/callback?code=zzz&state=unknown"));
  check(cb.status === 303 && !(cb.headers.get("location") ?? "").includes("zzz") && /link_error/.test(cb.headers.get("location") ?? ""), "the callback route sends an unknown state back with a word, never the code");

  say("— renewal, and a revoked grant");
  const tok1 = process.env.OMS_TOKEN;
  check((await refreshDueLinks(fakeAs)) === 0 && process.env.OMS_TOKEN === tok1, "a fresh token is not renewed (no needless rotation)");
  await db.connectionSetting.update({ where: { name: "OMS_TOKEN__EXPIRES" }, data: { valuePlain: String(Date.now() + 60_000) } });
  check((await refreshDueLinks(fakeAs)) === 1 && process.env.OMS_TOKEN !== tok1 && !!process.env.OMS_TOKEN?.startsWith("at-"), "a token about to expire is renewed and the new one is live at once");
  revoked = true;
  await db.connectionSetting.update({ where: { name: "OMS_TOKEN__EXPIRES" }, data: { valuePlain: String(Date.now() + 1000) } });
  await refreshDueLinks(fakeAs);
  const broken = (await connectionsView()).rows.find((r) => r.key === "oms")!.link!;
  check(broken.state === "broken", "the other system revoked the grant → the row says «انقطع» (it asks to link again, it does not pretend)");
  const unl = await keep(await unlinkRoute(DEL, KEY("oms")));
  check(unl.status === 200 && !process.env.OMS_TOKEN && (await db.connectionSetting.count({ where: { name: { startsWith: "OMS_TOKEN" } } })) === 0, "«افصل»: the token, its renewal and the state are gone");

  say("— the whole picture: where the secrets are NOT");
  const all = await everything(responses);
  for (const [what, v] of [["the Meta key", SECRET], ["the PEM", "BEGIN PRIVATE KEY"], ["the service account e-mail", "demo-project.iam"], ["an access token", "at-1-"], ["a refresh token", "rt-1-"], ["the signing secret", "ess-"]] as const) {
    check(!all.includes(v), `${what} appears in no response, log line, audit row or table cell`);
  }
  check(logged.length === 0 || !logged.some((l) => /EAAB|rt-|at-\d|ess-/.test(l)), "the console stayed clean of anything key-shaped");

  await clean();
  delete process.env.OMS_BASE_URL;
  await db.$disconnect();
  say(process.exitCode ? "\nFAILED" : "\nall checks passed");
})().catch(async (e) => {
  out(e);
  process.exitCode = 1;
  await clean().catch(() => undefined);
  await db.$disconnect();
});
