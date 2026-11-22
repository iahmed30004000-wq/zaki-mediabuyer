/**
 * Two small things around the sender: every notice carries its kind (so the owner's choice for the kind can apply), and Firebase is a row of «الربط» whose six values go in from the site,
 * are checked by shape, never echoed, and tested by asking Google for the access token (nothing is sent to any phone).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exportPKCS8, generateKeyPair } from "jose";
import { ROWS, FIELD_NAMES, checkValue, fieldOf, isSecretField, rowOf } from "@/core/connections";
import { INTEGRATIONS, isLinked, missingGroups, integrationOf } from "@/core/readiness";

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-db").makeFakeDb>, audited: [] as unknown[] }));
vi.mock("@/server/db", async () => {
  const { makeFakeDb } = await import("./helpers/fake-db");
  h.db = makeFakeDb();
  return { db: h.db };
});
vi.mock("@/server/audit", () => ({ audit: async (...a: unknown[]) => void h.audited.push(a) }));

import { inferKind } from "@/server/notify";
import { emit } from "@/server/events";
import { testRow, testableRows } from "@/server/connection-tests";
import { resetFcmTokenCache } from "@/adapters/fcm";

const NAMES = ["FIREBASE_API_KEY", "FIREBASE_PROJECT_ID", "FIREBASE_MESSAGING_SENDER_ID", "FIREBASE_APP_ID", "FIREBASE_VAPID_KEY", "FIREBASE_SERVICE_ACCOUNT_JSON"] as const;
const saved: Record<string, string | undefined> = {};
let privateKey = "";
beforeAll(async () => {
  privateKey = await exportPKCS8((await generateKeyPair("RS256", { extractable: true })).privateKey);
});
beforeEach(() => {
  for (const n of NAMES) {
    saved[n] = process.env[n];
    delete process.env[n];
  }
  resetFcmTokenCache();
  h.audited.length = 0;
});
afterEach(() => {
  for (const n of NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
});

describe("every notice has a kind", () => {
  it("an explicit kind wins; stock notices are known by their source or their key; the rest have none and are told by colour", () => {
    expect(inferKind({ kind: "run.missed", urgency: "orange" })).toBe("run.missed");
    expect(inferKind({ source: "stock", urgency: "red" })).toBe("stock.red");
    expect(inferKind({ source: "stock", urgency: "orange" })).toBe("stock.orange");
    expect(inferKind({ source: "recipe", key: "stock:TIN01:red:2026-11-14", urgency: "red" })).toBe("stock.red");
    expect(inferKind({ source: "mcp", urgency: "red" })).toBeNull();
    expect(inferKind({ kind: "x".repeat(80), urgency: "red" })!.length).toBe(40);
  });

  it("the events of the engine are written with their kind (so «مهمة فاتت» follows the owner's choice for «مهمة فاتت»)", async () => {
    for (const kind of ["run.missed", "run.lost", "run.stuck", "run.failed", "run.done"] as const) {
      await emit({ kind, runId: `r-${kind}`, jobKey: "night", jobName: "جولة الليل", minutes: 40, who: "Claude الرئيسي", detail: "x" }, ["missed", "stuck", "failed", "done"]);
    }
    const rows = (h.db.notification as unknown as { rows: Record<string, any>[] }).rows;
    expect(rows.map((r) => r.kind).sort()).toEqual(["run.done", "run.failed", "run.lost", "run.missed", "run.stuck"]);
    expect(rows.every((r) => r.sentAt === null)).toBe(true); // the sender sends; the event only writes
  });
});

describe("Firebase on the «الربط» page", () => {
  it("is one row of six values, written from the site: five public, one secret file", () => {
    const row = rowOf("firebase")!;
    expect(row.title).toBe("إشعارات الجوال (Firebase)");
    expect(row.fields.map((f) => f.name)).toEqual([...NAMES]);
    expect(row.testable).toBe(true);
    expect(row.fields.filter((f) => isSecretField(f)).map((f) => f.name)).toEqual(["FIREBASE_SERVICE_ACCOUNT_JSON"]);
    for (const n of NAMES) expect(FIELD_NAMES).toContain(n);
  });

  it("each value is checked by its shape, and a refusal never repeats what was typed", () => {
    const ok: Record<string, string> = { FIREBASE_API_KEY: "AIzaSy-example_123", FIREBASE_PROJECT_ID: "my-project-12345", FIREBASE_MESSAGING_SENDER_ID: "123456789012", FIREBASE_APP_ID: "1:123456789012:web:abc123", FIREBASE_VAPID_KEY: "BNexample-vapid_key0123456789" };
    for (const [n, v] of Object.entries(ok)) expect(checkValue(fieldOf(n)!, v).ok, n).toBe(true);
    for (const n of Object.keys(ok)) {
      const r = checkValue(fieldOf(n)!, "has spaces; and {braces}");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).not.toContain("braces");
    }
    const file = JSON.stringify({ type: "service_account", client_email: "svc@p.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n" }); // scan-secrets:ignore
    expect(checkValue(fieldOf("FIREBASE_SERVICE_ACCOUNT_JSON")!, file).ok).toBe(true);
    expect(checkValue(fieldOf("FIREBASE_SERVICE_ACCOUNT_JSON")!, "{}").ok).toBe(false);
  });

  it("the readiness list needs all six, and says which are missing; it is no longer «بعدين»", () => {
    const i = integrationOf("firebase");
    expect(i.later).toBeUndefined();
    expect(missingGroups(i, {})).toHaveLength(6);
    expect(isLinked("firebase", { FIREBASE_API_KEY: "a" })).toBe(false);
    expect(isLinked("firebase", Object.fromEntries(NAMES.map((n) => [n, "x"])))).toBe(true);
    expect(INTEGRATIONS.filter((x) => x.later)).toHaveLength(0);
  });

  it("«اختبر الربط»: not set up → the names that are missing, and no call is made", async () => {
    expect(testableRows).toContain("firebase");
    const fetchImpl = vi.fn();
    const r = await testRow("firebase", "u1", fetchImpl as never);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("FIREBASE_API_KEY");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("set up and Google accepts the key → ok, only the token is asked for (no phone is touched), and the answer carries no value", async () => {
    for (const n of NAMES) process.env[n] = "value";
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ type: "service_account", client_email: "svc@p.iam.gserviceaccount.com", private_key: privateKey });
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ access_token: "ya29.x", expires_in: 3600 }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await testRow("firebase", "u1", fetchImpl);
    expect(r).toMatchObject({ ok: true });
    expect(urls).toEqual(["https://oauth2.googleapis.com/token"]);
    expect(JSON.stringify(r)).not.toContain("svc@p");
    expect(h.audited.some((a) => (a as unknown[])[1] === "connection.test")).toBe(true);
  });

  it("Google refuses the key → a sentence for the owner (and it is not hammered); a broken key → another", async () => {
    for (const n of NAMES) process.env[n] = "value";
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ type: "service_account", client_email: "svc@p.iam.gserviceaccount.com", private_key: privateKey });
    const refused = (async () => new Response("{}", { status: 400 })) as unknown as typeof fetch;
    expect((await testRow("firebase", "u1", refused)).message).toContain("رفضت");
    resetFcmTokenCache();
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ type: "service_account", client_email: "svc@p.iam.gserviceaccount.com", private_key: "not a key" });
    expect((await testRow("firebase", "u1", refused)).message).toContain("المفتاح الخاص");
  });
});

describe("the rows still agree with each other", () => {
  it("every row with a test has a test, and Firebase is among them", () => {
    for (const r of ROWS.filter((x) => x.testable)) expect(testableRows, r.key).toContain(r.key);
  });
});
