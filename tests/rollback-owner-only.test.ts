/**
 * «رجّع» follows the same owner-only rule as approve(), and an inverse that raises spend is a new decision (it waits for approval).
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

import { approve, rollback } from "@/server/changes";
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

describe("«رجّع»", () => {
  it("what only the owner may decide, only the owner may undo", async () => {
    seed("sn", { kind: "safety_net", items: [item("set_account_cap", "act-1", { spendCap: 500 }, { spendCap: 0, reset: false }, "account")] });
    await expect(rollback("sn", manager)).rejects.toMatchObject({ status: 403 });
    expect(s.applied).toEqual([]);
    expect(s.sets.get("sn")!.state).toBe("executed");
    const done = await rollback("sn", owner);
    expect(done.state).toBe("executed");
    expect(s.applied).toEqual(["act-1"]);
    expect(s.sets.get("sn")!.state).toBe("rolled_back");
  });

  it("an inverse that raises spend is proposed, not run: it waits for approval and the original stays", async () => {
    seed("sp", { kind: "safety_pause", accountMetaId: "act-1", items: [item("pause", "cmp-9", { status: "ACTIVE", dailyBudget: 20 }, { status: "PAUSED" })] });
    const out = await rollback("sp", manager);
    expect(out.state).toBe("pending_approval");
    expect(out.kind).toBe("resume");
    expect(s.applied).toEqual([]); // nothing reached Meta
    expect(s.sets.get("sp")!.state).toBe("executed");
    // once a person approves the inverse and it runs, the original is marked rolled back
    await approve(out.id, manager);
    expect(s.applied).toEqual(["cmp-9"]);
    expect(s.sets.get("sp")!.state).toBe("rolled_back");
  });

  it("an inverse that only lowers spend (undoing a launch) still runs at once", async () => {
    seed("ln", { kind: "new_ad", items: [item("create", "cmp-new", {}, { status: "ACTIVE", dailyBudget: 15 })] });
    const out = await rollback("ln", manager);
    expect(out.state).toBe("executed");
    expect(s.applied).toEqual(["cmp-new"]);
  });
});
