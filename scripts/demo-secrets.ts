/**
 * «الإعدادات ← الربط» — secrets entered from the site (D62), end to end on the local database through the real route handlers:
 * a saved secret is in NO HTTP response, NO log line, NO audit row and NOT in the table in the clear; the environment is the fallback and comes back on «امسح»;
 * a second process picks a change up by reloading; «اختبر الربط» sends the key only in the header; the tokens of our own systems (OMS, Workspace) are pasted and sealed the same way. Who may call at all (403) is proven in tests/connections-routes.test.ts.
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
import { clearField, connectionsView, reloadOverlay, saveField, storedValues } from "../src/server/connections";
import { testRow } from "../src/server/connection-tests";
import { sealSecret } from "../src/server/secrets";
import { assertLocalDatabase } from "./_guard";
assertLocalDatabase();

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

const NAMES = ["META_SYSTEM_USER_TOKEN", "GOOGLE_SERVICE_ACCOUNT_JSON", "DRIVE_STUDIO_FOLDER_ID", "OMS_BASE_URL", "OMS_TOKEN", "OMS_EVENT_SECRET", "WORKSPACE_BASE_URL", "WORKSPACE_API_TOKEN"];
const g = globalThis as { __mbOverlay?: unknown };

async function clean() {
  await db.connectionSetting.deleteMany({ where: { name: { in: NAMES } } });
  await db.auditLog.deleteMany({ where: { OR: [{ action: { startsWith: "connection." } }] } });
}

/** everything an attacker could read: every response body so far, every log line, every audit row, every stored row */
const everything = async (responses: string[]) => JSON.stringify([responses, logged, await db.auditLog.findMany(), await db.connectionSetting.findMany()]);

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
  check(!t4.ok && /OMS|هون/.test(t4.message), "OMS not linked yet → says what is missing, makes no call", t4.message);
  const route = await keep(await testRoute(POST, KEY("telegram")));
  check(route.status === 200 && route.json?.ok === false, "a row with nothing to test answers honestly (not ✓)");
  check((await db.auditLog.count({ where: { action: "connection.test" } })) >= 4, "every test is audited (key and result only)");

  say("— the token of one of OUR systems: made there, pasted here, sealed like any key");
  const OMS_TOK = `omsT-${randomBytes(16).toString("hex")}-Zq9X`;
  const EV = `whsec-${randomBytes(12).toString("hex")}`;
  await keep(await putRoute(body("https://oms.example.test/"), NAME("OMS_BASE_URL")));
  const pt = await keep(await putRoute(body(OMS_TOK), NAME("OMS_TOKEN")));
  const pe = await keep(await putRoute(body(EV), NAME("OMS_EVENT_SECRET")));
  check(pt.status === 200 && pt.json?.last4 === "Zq9X" && !pt.text.includes(OMS_TOK) && pe.status === 200 && !pe.text.includes(EV), "OMS token and signing secret: saved, only the last four come back");
  check(process.env.OMS_TOKEN === OMS_TOK && process.env.OMS_EVENT_SECRET === EV, "the adapters read OMS_TOKEN exactly as before (the overlay is in the environment, no call site changed)");
  const omsRow = (await keep(await listRoute())).json.rows.find((r: any) => r.key === "oms");
  check(omsRow.linked === true && omsRow.fields.filter((f: any) => f.kind === "secret").every((f: any) => f.source === "app" && f.value === undefined), "the page says «مربوط» and carries no token value");
  const omsSeen: { url: string; auth: string | null; method: string }[] = [];
  const omsOk: typeof fetch = async (url, init) => (omsSeen.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), method: init?.method ?? "GET" }), new Response(JSON.stringify({ items: [{ code: "TRF01" }, { code: "TIN01" }] }), { status: 200 }));
  const to = await testRow("oms", "demo-owner", omsOk);
  check(to.ok && omsSeen.length === 1 && omsSeen[0]!.method === "GET" && omsSeen[0]!.auth === `Bearer ${OMS_TOK}` && !omsSeen[0]!.url.includes(OMS_TOK), "«اختبر الربط» on the OMS: one GET with the token in the header only", to.message);
  const to403 = await testRow("oms", "demo-owner", async () => new Response("{}", { status: 403 }));
  check(!to403.ok && /صلاحية/.test(to403.message) && !to403.message.includes(OMS_TOK), "403 → «قبل المفتاح بس ما إله صلاحية» (a token without the scope), no body echoed", to403.message);
  const to401 = await testRow("oms", "demo-owner", async () => new Response("{}", { status: 401 }));
  check(!to401.ok && /رفض/.test(to401.message), "401 (expired or revoked at the OMS) → says so in Arabic", to401.message);
  await keep(await putRoute(body("https://workspace.example.test"), NAME("WORKSPACE_BASE_URL")));
  await keep(await putRoute(body(`wsT-${randomBytes(12).toString("hex")}`), NAME("WORKSPACE_API_TOKEN")));
  const tw = await testRow("workspace", "demo-owner", async () => new Response(JSON.stringify([{ id: "b1" }]), { status: 200 }));
  check(tw.ok, "Workspace: the same, with its own token", tw.message);
  const del = await keep(await delRoute(DEL, NAME("OMS_TOKEN")));
  check(del.status === 200 && !process.env.OMS_TOKEN, "«امسح» on the OMS token: gone from the environment (no Coolify value to fall back to)");

  say("— the whole picture: where the secrets are NOT");
  const all = await everything(responses);
  for (const [what, v] of [["the Meta key", SECRET], ["the PEM", "BEGIN PRIVATE KEY"], ["the service account e-mail", "demo-project.iam"], ["the OMS token", "omsT-"], ["the OMS signing secret", "whsec-"], ["the Workspace token", "wsT-"]] as const) {
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
