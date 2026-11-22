/**
 * R-04 — a person's safety stop (kill switch, «اوقف», a hand pause) goes through even on a level-0 account: it is checked BEFORE the account's level.
 * The database is a small in-memory double that behaves like the rows the change service touches.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  sets: new Map<string, Record<string, unknown>>(),
  attempts: [] as string[],
  failOn: new Set<string>(),
  n: 0,
  level: 1,
  campaigns: [] as Record<string, unknown>[],
  mode: "dry_run" as "dry_run" | "live",
}));

vi.mock("@/server/db", () => {
  const find = (id: string, include?: { items?: boolean }) => {
    const r = s.sets.get(id);
    if (!r) throw new Error("not found");
    return { ...r, ...(include?.items ? {} : { items: undefined }) };
  };
  return {
    db: {
      changeSet: {
        create: async ({ data }: { data: Record<string, unknown> & { items?: { create: Record<string, unknown>[] } } }) => {
          const id = `cs${++s.n}`;
          const { items, ...rest } = data;
          const row = { id, error: null, simulation: null, ...rest, items: (items?.create ?? []).map((i, k) => ({ id: `${id}-i${k}`, apiResponse: null, verifyResult: null, ...i })) };
          s.sets.set(id, row);
          return { ...row, items: undefined };
        },
        findUniqueOrThrow: async ({ where, include }: { where: { id: string }; include?: { items?: boolean } }) => find(where.id, include),
        updateMany: async ({ where, data }: { where: { id: string; state?: string }; data: Record<string, unknown> }) => {
          const r = s.sets.get(where.id);
          if (!r || (where.state !== undefined && r.state !== where.state)) return { count: 0 };
          Object.assign(r, data);
          return { count: 1 };
        },
      },
      changeItem: {
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          for (const r of s.sets.values()) for (const i of r.items as Record<string, unknown>[]) if (i.id === where.id) Object.assign(i, data);
          return {};
        },
        findMany: async () => [],
      },
      insightDaily: { aggregate: async () => ({ _sum: { spend: 0 } }) },
      adAccount: { findUnique: async () => ({ autonomyLevel: s.level, dailyCap: 100 }) },
      metaConnection: { findFirst: async () => null },
      ruleRun: { findFirst: async () => null },
      freeze: { create: async () => ({}) },
      experiment: { updateMany: async () => ({ count: 0 }), findFirst: async () => null },
      killSwitchEvent: { create: async () => ({}) },
      campaign: { findMany: async () => s.campaigns },
    },
  };
});
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));
vi.mock("@/jobs/account-safety", () => ({ accountRestricted: async () => false }));
vi.mock("@/jobs/meta-sync", () => ({ metaToken: async () => null }));
vi.mock("@/meta/write", () => ({
  writeMode: () => s.mode,
  applyItem: async (item: { objectId: string }) => {
    s.attempts.push(item.objectId);
    if (s.failOn.has(item.objectId)) throw new Error(`الحملة ${item.objectId} محذوفة على ميتا`);
    return { verified: true, response: { ok: true }, readBack: {} };
  },
}));

import { propose } from "@/server/changes";

const pause = (id: string) => ({ op: "pause" as const, objectType: "campaign" as const, objectId: id, before: { status: "ACTIVE" }, after: { status: "PAUSED" } });

beforeEach(() => {
  s.sets.clear();
  s.attempts.length = 0;
  s.failOn.clear();
  s.n = 0;
  s.level = 1;
  s.campaigns = [];
  s.mode = "dry_run";
});

describe("a person's safety stop goes through at any level (R-04)", () => {
  it("a level-0 account: the owner's pause is executed, not left as a suggestion", async () => {
    s.level = 0;
    const cs = await propose({ source: "user", reasonCode: "S11", sentence: "وقف يدوي", kind: "safety_pause", accountMetaId: "act_1", items: [pause("cmp-1")] }, { type: "user", id: "u-owner" });
    expect(cs.state).toBe("executed");
    expect(s.attempts).toEqual(["cmp-1"]);
  });

  it("the kill switch and Telegram too — but a rule's pause on a level-0 account is still only a suggestion", async () => {
    s.level = 0;
    const ks = await propose({ source: "kill_switch", reasonCode: "S11", sentence: "إيقاف كامل", kind: "safety_pause", items: [pause("cmp-2")] }, { type: "user", id: "u-owner" });
    const tg = await propose({ source: "telegram", reasonCode: "S11", sentence: "اوقف", kind: "safety_pause", items: [pause("cmp-3")] }, { type: "user", id: "u-owner" });
    expect([ks.state, tg.state]).toEqual(["executed", "executed"]);
    const rule = await propose({ source: "rule", reasonCode: "S01", sentence: "قاعدة", kind: "safety_pause", accountMetaId: "act_1", items: [pause("cmp-4")] }, { type: "rule", id: "loser" });
    expect(rule.state).toBe("simulated");
    expect(s.attempts).toEqual(["cmp-2", "cmp-3"]);
  });

  it("what raises spend still waits for approval, whatever the source", async () => {
    const cs = await propose({ source: "user", reasonCode: "S11", sentence: "شغّلها", kind: "resume", accountMetaId: "act_1", items: [{ op: "resume", objectType: "campaign", objectId: "cmp-5", before: { status: "PAUSED" }, after: { status: "ACTIVE", dailyBudget: 10 } }] }, { type: "user", id: "u-owner" });
    expect(cs.state).not.toBe("executed");
    expect(s.attempts).toEqual([]);
  });
});

