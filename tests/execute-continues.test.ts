/**
 * R-05 — a stop keeps going past the campaign that fails (and says how many were stopped and why).
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
        findMany: async () => [],
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
      adAccount: { findUnique: async () => ({ autonomyLevel: s.level, dailyCap: 100, campaigns: [] }) },
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

import { approve, killSwitch, propose } from "@/server/changes";
import { stopSentence } from "@/core/stop-result";
import type { Caller } from "@/server/auth";

const owner: Caller = { id: "u-owner", role: "OWNER", demo: false };
const pause = (id: string) => ({ op: "pause" as const, objectType: "campaign" as const, objectId: id, before: { status: "ACTIVE" }, after: { status: "PAUSED" } });
const campaign = (id: string) => ({ metaId: id, status: "ACTIVE", dailyBudget: 10, account: { metaId: "act_1" } });

beforeEach(() => {
  s.sets.clear();
  s.attempts.length = 0;
  s.failOn.clear();
  s.n = 0;
  s.level = 1;
  s.campaigns = [];
  s.mode = "dry_run";
});

describe("a stop keeps going past the campaign that fails (R-05)", () => {
  it("one fails on Meta: the others are still paused, and the answer says how many and why", async () => {
    s.campaigns = ["c1", "c2", "c3"].map(campaign);
    s.failOn.add("c2");
    const r = await killSwitch("all", owner);
    expect(s.attempts).toEqual(["c1", "c2", "c3"]);
    expect(r).toMatchObject({ state: "partial", done: 2, failed: 1 });
    expect(stopSentence(r)).toBe("انوقف 2 وفشل 1: الحملة c2 محذوفة على ميتا");
  });

  it("all fine, as a trial: the answer is the trial sentence", async () => {
    s.campaigns = ["c1", "c2"].map(campaign);
    const r = await killSwitch("all", owner);
    expect(r.state).toBe("trial");
    expect(stopSentence(r)).toBe("تجربة: ما انبعت لميتا");
  });

  it("no running campaign: «ما في حملات شغّالة», nothing proposed", async () => {
    const r = await killSwitch("all", owner);
    expect(stopSentence(r)).toBe("ما في حملات شغّالة");
    expect(s.sets.size).toBe(0);
  });

  it("a level-0 account's campaigns are stopped by the kill switch (the bug)", async () => {
    s.level = 0;
    s.campaigns = [campaign("c1")];
    const r = await killSwitch("act_1", owner);
    expect(r.state).toBe("trial");
    expect(s.attempts).toEqual(["c1"]);
  });

  it("what is NOT a stop or a cut (a resume) still stops at the first failure", async () => {
    s.failOn.add("r1");
    s.sets.set("c9", {
      id: "c9", state: "pending_approval", source: "user", kind: "resume", reasonCode: "S11", sentence: "x", accountMetaId: null, spendDeltaDaily: 0, error: null, simulation: null, writeMode: "dry_run", sourceRef: null,
      items: [
        { id: "c9-a", seq: 0, op: "resume", objectType: "campaign", objectId: "r1", before: { status: "PAUSED" }, after: { status: "ACTIVE" }, apiResponse: null },
        { id: "c9-b", seq: 1, op: "resume", objectType: "campaign", objectId: "r2", before: { status: "PAUSED" }, after: { status: "ACTIVE" }, apiResponse: null },
      ],
    });
    const done = await approve("c9", owner);
    expect(done.state).toBe("failed");
    expect(s.attempts).toEqual(["r1"]);
  });
});
