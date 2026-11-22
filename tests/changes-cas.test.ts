/**
 * A state move is a compare-and-set, so two approvals at the same moment execute once.
 * The database is a small in-memory double that behaves like the rows the change service touches.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & { id: string; state: string; items: Record<string, unknown>[] };
const s = vi.hoisted(() => ({ sets: new Map<string, Record<string, unknown>>(), applied: [] as string[], n: 0 }));

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
          const row = { id, error: null, simulation: null, ...rest, items: (items?.create ?? []).map((i, k) => ({ id: `${id}-i${k}`, apiResponse: null, ...i })) };
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
      changeItem: { update: async () => ({}), findMany: async () => [] },
      insightDaily: { aggregate: async () => ({ _sum: { spend: 0 } }) },
      adAccount: { findUnique: async () => ({ autonomyLevel: 1, dailyCap: 100 }) },
      metaConnection: { findFirst: async () => null },
      ruleRun: { findFirst: async () => null },
      freeze: { create: async () => ({}) },
      experiment: { updateMany: async () => ({ count: 0 }), findFirst: async () => null },
      killSwitchEvent: { create: async () => ({}) },
      campaign: { findMany: async () => [] },
    },
  };
});
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));
vi.mock("@/jobs/account-safety", () => ({ accountRestricted: async () => false }));
vi.mock("@/jobs/meta-sync", () => ({ metaToken: async () => null }));
vi.mock("@/meta/write", () => ({
  writeMode: () => "dry_run",
  applyItem: async (item: { objectId: string }) => {
    s.applied.push(item.objectId);
    return { verified: true, response: { ok: true }, readBack: {} };
  },
}));

import { approve } from "@/server/changes";
import type { Caller } from "@/server/auth";

const owner: Caller = { id: "u-owner", role: "OWNER", demo: false };
const manager: Caller = { id: "u-mgr", role: "MANAGER", demo: false };

const seed = (id: string, over: Record<string, unknown>) => {
  const row = { id, state: "executed", source: "rule", kind: "safety_pause", reasonCode: "S11", sentence: "تجربة", accountMetaId: null, spendDeltaDaily: 0, error: null, simulation: null, writeMode: "dry_run", sourceRef: null, items: [] as Record<string, unknown>[], ...over };
  s.sets.set(id, row);
  return row;
};
const item = (op: string, objectId: string, before: Record<string, unknown>, after: Record<string, unknown>, objectType = "campaign") => ({ id: `${objectId}-it`, seq: 0, op, objectType, objectId, before, after, apiResponse: null });

beforeEach(() => {
  s.sets.clear();
  s.applied.length = 0;
  s.n = 0;
});

describe("two approvals at the same moment", () => {
  it("only one of them moves the change and executes it", async () => {
    seed("c1", { state: "pending_approval", kind: "resume", source: "user", items: [item("resume", "cmp-1", { status: "PAUSED" }, { status: "ACTIVE", dailyBudget: 10 })] });
    const [a, b] = await Promise.allSettled([approve("c1", owner), approve("c1", manager)]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
    const lost = (a.status === "rejected" ? a : b) as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ status: 409 });
    expect(s.applied).toEqual(["cmp-1"]); // sent once
    expect(s.sets.get("c1")!.state).toBe("executed");
  });

  it("a change that already moved cannot be approved again", async () => {
    seed("c2", { state: "executed", kind: "resume", items: [item("resume", "cmp-2", { status: "PAUSED" }, { status: "ACTIVE" })] });
    await expect(approve("c2", owner)).rejects.toMatchObject({ status: 409 });
    expect(s.applied).toEqual([]);
  });
});
