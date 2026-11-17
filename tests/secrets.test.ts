import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { FIELD_NAMES, ROWS, applyOverlay, checkValue, fieldOf, isSecretField, last4Of, newOverlay, rowOf, sourceOf, statusWords } from "@/core/connections";
import { MASTER_KEY_MISSING, openSecret, parseMasterKey, sealSecret } from "@/server/secrets";

const KEY = randomBytes(32);
const SECRET = "EAAB-example-not-a-real-token-1234567890";

describe("sealing a secret (AES-256-GCM, key from SECRETS_MASTER_KEY)", () => {
  it("round-trips, and the stored form holds neither the value nor a readable piece of it", () => {
    const blob = sealSecret("META_SYSTEM_USER_TOKEN", SECRET, KEY);
    expect(blob.startsWith("s1:")).toBe(true);
    expect(blob).not.toContain(SECRET);
    expect(blob).not.toContain(SECRET.slice(0, 8));
    expect(openSecret("META_SYSTEM_USER_TOKEN", blob, KEY)).toBe(SECRET);
  });
  it("each seal is different (fresh nonce), so equal secrets do not look equal in the table", () => {
    expect(sealSecret("A_B", SECRET, KEY)).not.toBe(sealSecret("A_B", SECRET, KEY));
  });
  it("a blob copied under another name does not open (the name is bound in), nor with another key, nor when tampered", () => {
    const blob = sealSecret("META_SYSTEM_USER_TOKEN", SECRET, KEY);
    expect(openSecret("OMS_TOKEN", blob, KEY)).toBeNull();
    expect(openSecret("META_SYSTEM_USER_TOKEN", blob, randomBytes(32))).toBeNull();
    const [v, iv, ct, tag] = blob.split(/[:.]/);
    const flipped = `${v}:${iv}.${Buffer.from(Buffer.from(ct!, "base64url").map((b, i) => (i === 0 ? b ^ 1 : b))).toString("base64url")}.${tag}`;
    expect(openSecret("META_SYSTEM_USER_TOKEN", flipped, KEY)).toBeNull();
    expect(openSecret("META_SYSTEM_USER_TOKEN", "garbage", KEY)).toBeNull();
    expect(openSecret("META_SYSTEM_USER_TOKEN", null, KEY)).toBeNull();
  });
  it("the master key: 32 bytes as base64 or 64 hex characters, nothing else", () => {
    expect(parseMasterKey(KEY.toString("base64"))?.length).toBe(32);
    expect(parseMasterKey(KEY.toString("hex"))?.length).toBe(32);
    expect(parseMasterKey("short")).toBeNull();
    expect(parseMasterKey(randomBytes(16).toString("base64"))).toBeNull();
    expect(parseMasterKey(undefined)).toBeNull();
    expect(parseMasterKey("")).toBeNull();
  });
  it("without a key nothing is sealed (no silent plaintext), and the sentence says what to do", () => {
    expect(() => sealSecret("A_B", SECRET, null)).toThrow();
    expect(MASTER_KEY_MISSING).toContain("SECRETS_MASTER_KEY");
    expect(MASTER_KEY_MISSING).not.toContain(SECRET);
  });
});

describe("what may be written from the site", () => {
  it("only the names of the rows; the Meta write locks, MOCK_MODE and the master key itself are not among them", () => {
    for (const bad of ["META_WRITE_MODE", "MOCK_MODE", "SECRETS_MASTER_KEY", "DATABASE_URL", "AUTH_SECRET", "TELEGRAM_BOT_TOKEN", "PRIVACY_MODE", "ANTHROPIC_API_KEY"]) {
      expect(FIELD_NAMES, bad).not.toContain(bad);
      expect(fieldOf(bad)).toBeUndefined();
    }
    expect(FIELD_NAMES).toContain("META_SYSTEM_USER_TOKEN");
    expect(FIELD_NAMES).toContain("GOOGLE_SERVICE_ACCOUNT_JSON");
  });
  it("the rule of 17/11 (17:30): a system's token is made by the system that owns the data (scopes + expiry) and pasted here — write-only; no bot token, no Hermes token", () => {
    const secrets = (k: string) => rowOf(k)!.fields.filter((f) => f.kind === "secret").map((f) => f.name);
    expect(secrets("oms")).toEqual(["OMS_TOKEN", "OMS_EVENT_SECRET"]);
    expect(secrets("replies")).toEqual(["REPLIES_TOKEN"]);
    expect(secrets("workspace")).toEqual(["WORKSPACE_API_TOKEN"]);
    expect(secrets("meta")).toEqual(["META_SYSTEM_USER_TOKEN"]);
    expect(ROWS.flatMap((r) => r.fields).some((f) => /TELEGRAM|HERMES/.test(f.name))).toBe(false);
    expect(rowOf("telegram")?.note).toContain("الـOMS");
    expect(rowOf("telegram")?.fields).toEqual([]);
    // each token field says where it is made and which scopes it needs
    for (const n of ["OMS_TOKEN", "REPLIES_TOKEN", "WORKSPACE_API_TOKEN"]) expect(fieldOf(n)!.hint, n).toMatch(/توكنات الأنظمة/);
    expect(fieldOf("OMS_TOKEN")!.hint).toMatch(/products.read.*products.costs.read.*orders.attribution.read.*ads.spend.read.*notify.send/);
  });
  it("secrets and files are secret; addresses and ids are not", () => {
    expect(isSecretField(fieldOf("META_SYSTEM_USER_TOKEN")!)).toBe(true);
    expect(isSecretField(fieldOf("GOOGLE_SERVICE_ACCOUNT_JSON")!)).toBe(true);
    expect(isSecretField(fieldOf("OMS_BASE_URL")!)).toBe(false);
    expect(isSecretField(fieldOf("DRIVE_STUDIO_FOLDER_ID")!)).toBe(false);
  });
  it("a key keeps only its last four characters; a file keeps none", () => {
    expect(last4Of(fieldOf("META_SYSTEM_USER_TOKEN")!, SECRET)).toBe("7890");
    expect(last4Of(fieldOf("GOOGLE_SERVICE_ACCOUNT_JSON")!, "{}")).toBeNull();
  });
  it("shapes: a key has no spaces, an address is https (or the local machine) without credentials, an id is plain, a service-account file is the real thing", () => {
    const f = (n: string) => fieldOf(n)!;
    expect(checkValue(f("META_SYSTEM_USER_TOKEN"), "  " + SECRET + " ")).toEqual({ ok: true, value: SECRET });
    expect(checkValue(f("META_SYSTEM_USER_TOKEN"), "two words here").ok).toBe(false);
    expect(checkValue(f("META_SYSTEM_USER_TOKEN"), "short").ok).toBe(false);
    expect(checkValue(f("META_SYSTEM_USER_TOKEN"), 42).ok).toBe(false);
    expect(checkValue(f("OMS_BASE_URL"), "https://crm.example.com/")).toEqual({ ok: true, value: "https://crm.example.com" });
    expect(checkValue(f("OMS_BASE_URL"), "http://localhost:4000").ok).toBe(true);
    expect(checkValue(f("OMS_BASE_URL"), "http://crm.example.com").ok).toBe(false);
    expect(checkValue(f("OMS_BASE_URL"), "https://u:p@crm.example.com").ok).toBe(false);
    expect(checkValue(f("OMS_BASE_URL"), "https://crm.example.com/?key=abc").ok).toBe(false);
    expect(checkValue(f("DRIVE_STUDIO_FOLDER_ID"), "1AbCdEf_-123").ok).toBe(true);
    expect(checkValue(f("DRIVE_STUDIO_FOLDER_ID"), "a b; rm -rf").ok).toBe(false);
    const sa = JSON.stringify({ type: "service_account", client_email: "x@y.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n" }); // scan-secrets:ignore
    expect(checkValue(f("GOOGLE_SERVICE_ACCOUNT_JSON"), sa).ok).toBe(true);
    expect(checkValue(f("GOOGLE_SERVICE_ACCOUNT_JSON"), "{}").ok).toBe(false);
    expect(checkValue(f("GOOGLE_SERVICE_ACCOUNT_JSON"), "not json").ok).toBe(false);
  });
  it("a refusal never repeats what was typed", () => {
    for (const f of ROWS.flatMap((r) => r.fields)) {
      const r = checkValue(f, SECRET + " with spaces {");
      if (!r.ok) expect(r.error).not.toContain(SECRET);
    }
  });
});

describe("resolution: the site's value, else the environment — and the environment comes back when the site's is deleted", () => {
  it("overlay wins over the environment", () => {
    const env: Record<string, string | undefined> = { META_SYSTEM_USER_TOKEN: "from-coolify-0000", OTHER: "x" };
    const st = newOverlay();
    applyOverlay(env, st, { META_SYSTEM_USER_TOKEN: "from-the-site-1111" });
    expect(env.META_SYSTEM_USER_TOKEN).toBe("from-the-site-1111");
    expect(env.OTHER).toBe("x");
  });
  it("env fallback: nothing saved leaves the environment untouched", () => {
    const env: Record<string, string | undefined> = { OMS_BASE_URL: "https://coolify.example" };
    const st = newOverlay();
    expect(applyOverlay(env, st, {})).toEqual({ set: [], restored: [] });
    expect(env.OMS_BASE_URL).toBe("https://coolify.example");
    expect(sourceOf("OMS_BASE_URL", new Set(), env, st)).toBe("env");
    expect(sourceOf("REPLIES_BASE_URL", new Set(), env, st)).toBe("none");
  });
  it("delete restores the original; a name that was never in the environment is removed again; hot reload — a second save replaces the first at once", () => {
    const env: Record<string, string | undefined> = { A_ONE: "orig" };
    const st = newOverlay();
    applyOverlay(env, st, { A_ONE: "site-1", B_TWO: "site-b" });
    expect(sourceOf("A_ONE", new Set(["A_ONE"]), env, st)).toBe("app");
    applyOverlay(env, st, { A_ONE: "site-2", B_TWO: "site-b" });
    expect(env.A_ONE).toBe("site-2");
    const r = applyOverlay(env, st, {});
    expect(r.restored.sort()).toEqual(["A_ONE", "B_TWO"]);
    expect(env.A_ONE).toBe("orig");
    expect("B_TWO" in env).toBe(false);
    expect(sourceOf("A_ONE", new Set(), env, st)).toBe("env");
  });
  it("source is reported as the environment's even while the site's value is laid over it", () => {
    const env: Record<string, string | undefined> = { A_ONE: "orig" };
    const st = newOverlay();
    applyOverlay(env, st, { A_ONE: "site" });
    expect(sourceOf("A_ONE", new Set(), env, st)).toBe("env"); // not saved on the site (a row left behind), the original is what counts
  });
});

describe("a test result says why in words, from the status alone", () => {
  it("401 / 403 / 404 / 429 / 5xx each have their own sentence and none carries a body", () => {
    const all = [401, 403, 404, 429, 500, 418].map((s) => statusWords(s, "الـOMS"));
    expect(new Set(all).size).toBe(all.length);
    for (const w of all) expect(w).toContain("الـOMS");
  });
});

/** The connections door is the owner's alone: every route under /api/connections names `owner_only` . */
describe("static: who may call the connections routes", () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n === "route.ts" ? [join(d, n)] : []));
  const files = walk(join(process.cwd(), "src", "app", "api", "connections"));
  it("found them", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });
  for (const f of files) {
    it(relative(process.cwd(), f).replace(/\\/g, "/"), () => {
      const src = readFileSync(f, "utf8");
      const handlers = [...src.matchAll(/export async function (GET|POST|PUT|DELETE)\b/g)].length;
      const guards = [...src.matchAll(/requireCapability\("owner_only"\)/g)].length;
      expect(guards).toBeGreaterThanOrEqual(handlers);
      expect(src).not.toMatch(/requireSignedIn|requireToken/);
    });
  }
});

/** The serializer of the page: nothing a secret holds leaves the server. */
describe("static: no code path hands a secret value to a browser or a log", () => {
  const srcOf = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("the view type has no field that could carry a secret's value (only `value` for plain ones, and `last4`)", () => {
    const view = srcOf("src/server/connections.ts");
    const fieldView = /export interface FieldView \{[\s\S]*?\n\}/.exec(view)![0];
    expect(fieldView).toContain("last4");
    expect(fieldView).not.toMatch(/\b(secret|token|valueEnc|plain)\b\??:/i);
    // `value` is only ever set inside the `if (!secret)` branch
    expect(view).toMatch(/if \(!secret\) \{[\s\S]*?view\.value = v/);
  });
  it("the client component imports nothing at run time from the server (types only), so no key code can reach the browser bundle", () => {
    const panel = srcOf("src/components/settings/connections-panel.tsx");
    const imports = [...panel.matchAll(/^import (type )?.*from "@\/server\/[^"]+";$/gm)];
    expect(imports.length).toBeGreaterThan(0);
    for (const m of imports) expect(m[1], m[0]).toBe("type ");
    expect(panel).not.toMatch(/node:crypto|process\.env/);
  });
  it("the connection code never logs", () => {
    for (const p of ["src/server/connections.ts", "src/server/secrets.ts", "src/server/connection-tests.ts", "src/core/connections.ts"]) {
      expect(srcOf(p), p).not.toMatch(/console\.(log|info|warn|error|debug)/);
    }
  });
  it("the audit entries carry names and kinds, never a value", () => {
    for (const p of ["src/server/connections.ts", "src/server/connection-tests.ts"]) {
      for (const m of srcOf(p).matchAll(/audit\(([^;]*)\);/g)) expect(m[1], `${p}: ${m[1]}`).not.toMatch(/checked\.value|raw|\bvalue\b/);
    }
  });
});
