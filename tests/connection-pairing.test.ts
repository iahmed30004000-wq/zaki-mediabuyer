/**
 * A key is only meant for the host it was made for. Changing an address to another host deletes the keys saved from the site for that row;
 * a key that lives in Coolify cannot be dropped from here, so the change is refused. The same host (a path, a trailing slash) changes nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { originOf, pairedSecrets } from "@/core/connections";

const s = vi.hoisted(() => ({ rows: new Map<string, { name: string; secret: boolean; valuePlain: string | null; valueEnc: string | null }>(), audits: [] as string[], settings: [] as [string, unknown][] }));

vi.mock("@/server/db", () => ({
  db: {
    connectionSetting: {
      findMany: async (q?: { where?: { name?: { in: string[] } } }) => [...s.rows.values()].filter((r) => !q?.where?.name || q.where.name.in.includes(r.name)),
      upsert: async ({ where, create }: { where: { name: string }; create: { name: string; secret: boolean; valuePlain: string | null; valueEnc: string | null } }) => void s.rows.set(where.name, create),
      deleteMany: async ({ where }: { where: { name: string | { in: string[] } } }) => {
        const names = typeof where.name === "string" ? [where.name] : where.name.in;
        for (const n of names) s.rows.delete(n);
      },
    },
  },
}));
vi.mock("@/server/settings", () => ({ setSetting: async (k: string, v: unknown) => void s.settings.push([k, v]) }));
vi.mock("@/server/audit", () => ({ audit: async (_a: unknown, action: string) => void s.audits.push(action) }));
vi.mock("@/server/auth", () => ({
  HttpError: class extends Error {
    constructor(public status: number, m: string) {
      super(m);
    }
  },
}));
vi.mock("@/server/secrets", () => ({ MASTER_KEY_MISSING: "no key", masterKeyConfigured: () => true, sealSecret: (_n: string, v: string) => `sealed:${v}`, openSecret: (_n: string, v: string | null) => (v ? v.replace("sealed:", "") : null) }));

import { reloadOverlay, saveField } from "@/server/connections";

const ENV_KEYS = ["OMS_BASE_URL", "OMS_TOKEN", "OMS_EVENT_SECRET", "REPLIES_BASE_URL", "REPLIES_TOKEN"];
beforeEach(async () => {
  s.rows.clear();
  s.audits.length = 0;
  s.settings.length = 0;
  for (const k of ENV_KEYS) delete process.env[k];
  await reloadOverlay();
});

describe("which keys belong to an address", () => {
  it("the secrets of the same row", () => {
    expect(pairedSecrets("OMS_BASE_URL")).toEqual(["OMS_TOKEN", "OMS_EVENT_SECRET"]);
    expect(pairedSecrets("REPLIES_BASE_URL")).toEqual(["REPLIES_TOKEN"]);
    expect(pairedSecrets("META_SYSTEM_USER_TOKEN")).toEqual([]);
  });
  it("origin ignores path and trailing slash but not host or port", () => {
    expect(originOf("https://crm.zakiai.io/a/b")).toBe(originOf("https://crm.zakiai.io/"));
    expect(originOf("https://crm.zakiai.io")).not.toBe(originOf("https://evil.example.com"));
    expect(originOf("https://crm.zakiai.io")).not.toBe(originOf("https://crm.zakiai.io:8443"));
    expect(originOf("nonsense")).toBeNull();
  });
});

describe("saving an address", () => {
  it("to another host deletes the keys saved from the site for that row (and says so in the log)", async () => {
    await saveField("OMS_BASE_URL", "https://crm.zakiai.io", "u1");
    await saveField("OMS_TOKEN", "tok-aaaaaaaaaaaaaaaaaaaa", "u1");
    expect(s.rows.has("OMS_TOKEN")).toBe(true);
    await saveField("OMS_BASE_URL", "https://other.example.com", "u1");
    expect(s.rows.has("OMS_TOKEN")).toBe(false);
    expect(s.rows.get("OMS_BASE_URL")?.valuePlain).toBe("https://other.example.com");
    expect(s.audits).toContain("connection.unpair");
    expect(process.env.OMS_TOKEN).toBeUndefined();
  });

  it("to the same host (another path) keeps the key", async () => {
    await saveField("OMS_BASE_URL", "https://crm.zakiai.io", "u1");
    await saveField("OMS_TOKEN", "tok-aaaaaaaaaaaaaaaaaaaa", "u1");
    await saveField("OMS_BASE_URL", "https://crm.zakiai.io/api", "u1");
    expect(s.rows.has("OMS_TOKEN")).toBe(true);
  });

  it("a row's change does not touch another row's key", async () => {
    await saveField("OMS_BASE_URL", "https://crm.zakiai.io", "u1");
    await saveField("REPLIES_BASE_URL", "https://replies.example.com", "u1");
    await saveField("REPLIES_TOKEN", "tok-bbbbbbbbbbbbbbbbbbbb", "u1");
    await saveField("OMS_BASE_URL", "https://other.example.com", "u1");
    expect(s.rows.has("REPLIES_TOKEN")).toBe(true);
  });

  it("with the key in Coolify (the environment) and the host changing: refused, and nothing is saved", async () => {
    process.env.OMS_BASE_URL = "https://crm.zakiai.io";
    process.env.OMS_TOKEN = "env-token-aaaaaaaaaaaaaaaa";
    await reloadOverlay();
    await expect(saveField("OMS_BASE_URL", "https://other.example.com", "u1")).rejects.toMatchObject({ status: 409 });
    expect(s.rows.has("OMS_BASE_URL")).toBe(false);
    // the same host is fine
    await expect(saveField("OMS_BASE_URL", "https://crm.zakiai.io/v2", "u1")).resolves.toBeDefined();
  });

  it("a first address (nothing to protect yet) is saved as before", async () => {
    await expect(saveField("OMS_BASE_URL", "https://crm.zakiai.io", "u1")).resolves.toBeDefined();
    expect(s.audits).not.toContain("connection.unpair");
  });

  it("saving the OMS address or token marks the link time (R-26); another field does not", async () => {
    await saveField("OMS_BASE_URL", "https://crm.zakiai.io", "u1");
    await saveField("OMS_TOKEN", "tok-123456789", "u1");
    await saveField("OMS_EVENT_SECRET", "sec-123456789", "u1");
    expect(s.settings.map(([k]) => k)).toEqual(["oms.linkedAt", "oms.linkedAt"]);
    expect(Number.isNaN(Date.parse(String(s.settings[0]![1])))).toBe(false);
  });
});
