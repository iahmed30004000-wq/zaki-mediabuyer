/**
 * «رجّع» follows the same owner-only rule as approve(), and an inverse that raises spend is a new decision (it waits for approval).
 * The database is a small in-memory double that behaves like the rows the change service touches.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & { id: string; state: string; items: Record<string, unknown>[] };
const s = vi.hoisted(() => ({ sets: new Map<string, Record<string, unknown>>(), applied: [] as string[], n: 0, accounts: [] as any[] }));

vi.mock("@/server/db", () => {
  const find = (id: string, include?: { items?: boolean }) => {
    const r = s.sets.get(id);
    if (!r) throw new Error("not found");
    return { ...r, ...(include?.items ? {} : { items: undefined }) };
  };
  const campaigns = () => s.accounts.flatMap((a) => a.campaigns.map((c: any) => ({ ...c, account: a })));
  const adsets = () => campaigns().flatMap((c: any) => c.adsets.map((x: any) => ({ ...x, campaign: c })));
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
        findMany: async () => [],
        findFirst: async ({ where }: { where: { sourceRef: string; state: { in: string[] } } }) => [...s.sets.values()].find((r) => r.sourceRef === where.sourceRef && where.state.in.includes(r.state as string)) ?? null,
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
      adAccount: { findUnique: async ({ where }: { where: { metaId: string } }) => s.accounts.find((a) => a.metaId === where.metaId) ?? { metaId: where.metaId, autonomyLevel: 1, dailyCap: 100, currency: "USD", campaigns: [] } },
      adSet: { findUnique: async ({ where }: { where: { metaId: string } }) => adsets().find((x: any) => x.metaId === where.metaId) ?? null },
      ad: { findUnique: async ({ where }: { where: { metaId: string } }) => adsets().flatMap((x: any) => x.ads.map((ad: any) => ({ ...ad, adSet: x }))).find((ad: any) => ad.metaId === where.metaId) ?? null },
      metaConnection: { findFirst: async () => null },
      ruleRun: { findFirst: async () => null },
      freeze: { create: async () => ({}) },
      experiment: { updateMany: async () => ({ count: 0 }), findFirst: async () => null },
      killSwitchEvent: { create: async () => ({}) },
      campaign: { findMany: async () => [], findUnique: async ({ where }: { where: { metaId: string } }) => campaigns().find((c: any) => c.metaId === where.metaId) ?? null },
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
  s.accounts = [];
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

/** Bringing anything back raises spend, whether or not the stored pause carried a budget (a campaign whose budgets sit on its ad sets, one ad). */
describe("«رجّع» of a stop is a raise: it waits for approval", () => {
  const set = (metaId: string, dailyBudget: number | null, status = "ACTIVE") => ({ metaId, dailyBudget, status, ads: [{ metaId: `${metaId}-ad` }] });
  const account = (metaId: string, adsets: ReturnType<typeof set>[], over: Record<string, unknown> = {}) => ({ metaId, autonomyLevel: 1, dailyCap: 100, currency: "USD", campaigns: [{ metaId: `${metaId}-c`, status: "PAUSED", dailyBudget: null, adsets }], ...over });
  const stop = (id: string, objectId: string, over: Record<string, unknown> = {}, objectType = "campaign") =>
    seed(id, { kind: "safety_pause", accountMetaId: "a1", items: [item("pause", objectId, { status: "ACTIVE" }, { status: "PAUSED" }, objectType)], ...over });

  it("a campaign with its budgets on the ad sets: proposed, with the money it brings back", async () => {
    // one ad set was paused on its own: it does not come back with the campaign, so its budget is not counted
    s.accounts = [account("a1", [set("s1", 30, "CAMPAIGN_PAUSED"), set("s2", 20), set("s3", 500, "PAUSED")])];
    stop("p", "a1-c");
    const out = await rollback("p", manager);
    expect(out).toMatchObject({ state: "pending_approval", kind: "resume" });
    expect(Number(out.spendDeltaDaily)).toBe(50);
    expect(s.applied).toEqual([]);
    await approve(out.id, manager);
    expect(s.applied).toEqual(["a1-c"]);
    expect(s.sets.get("p")!.state).toBe("rolled_back");
  });

  it("one ad, and a campaign the site does not know: no figure, still proposed", async () => {
    stop("ad", "some-ad", {}, "ad");
    stop("gone", "unknown-campaign");
    for (const id of ["ad", "gone"]) expect((await rollback(id, manager)).state).toBe("pending_approval");
    expect(s.applied).toEqual([]);
  });

  it("an account of another currency: proposed, and none of its figures is written as dollars", async () => {
    s.accounts = [account("a1", [set("s1", 30)], { currency: "JOD" })];
    stop("p", "a1-c");
    const out = await rollback("p", manager);
    expect(out.state).toBe("pending_approval");
    expect(Number(out.spendDeltaDaily)).toBe(0);
  });

  it("a restricted account (level 0) still gets a request that can be approved", async () => {
    s.accounts = [account("a1", [set("s1", 30)], { autonomyLevel: 0 })];
    stop("p", "a1-c");
    expect((await rollback("p", manager)).state).toBe("pending_approval");
  });

  it("a second press while one is waiting makes no second request", async () => {
    stop("p", "a1-c");
    await rollback("p", manager);
    await expect(rollback("p", manager)).rejects.toMatchObject({ status: 409 });
    expect(s.sets.size).toBe(2);
  });

  it("a trial stop left the budgets running in the site's copy: they are not counted twice against the cap", async () => {
    s.accounts = [account("a1", [set("s1", 80)])];
    s.accounts[0].campaigns[0].status = "ACTIVE";
    stop("p", "a1-c");
    const out = await rollback("p", manager);
    await approve(out.id, manager);
    expect(s.applied).toEqual(["a1-c"]);
  });

  it("over the cap it is refused", async () => {
    s.accounts = [account("a1", [set("s1", 150)])];
    stop("p", "a1-c");
    const out = await rollback("p", manager);
    await expect(approve(out.id, manager)).rejects.toMatchObject({ status: 409 });
    expect(s.applied).toEqual([]);
  });

  const everywhere = () => seed("all", { kind: "safety_pause", accountMetaId: null, items: [item("pause", "a1-c", { status: "ACTIVE" }, { status: "PAUSED" }), { ...item("pause", "a2-c", { status: "ACTIVE" }, { status: "PAUSED" }), seq: 1 }] });

  it("a full stop of every account can be brought back: each account against its own cap", async () => {
    s.accounts = [account("a1", [set("s1", 60)]), account("a2", [set("s2", 70)])];
    everywhere();
    const out = await rollback("all", manager);
    await approve(out.id, manager);
    expect(s.applied.sort()).toEqual(["a1-c", "a2-c"]);
  });

  it("…and refused when one of them would pass its cap", async () => {
    s.accounts = [account("a1", [set("s1", 60)]), account("a2", [set("s2", 170)])];
    everywhere();
    const out = await rollback("all", manager);
    await expect(approve(out.id, manager)).rejects.toMatchObject({ status: 409 });
    expect(s.applied).toEqual([]);
  });

  it("undoing a resume only lowers spend: it runs at once", async () => {
    seed("r", { kind: "resume", accountMetaId: "a1", items: [item("resume", "a1-c", { status: "PAUSED" }, { status: "ACTIVE" })] });
    expect((await rollback("r", manager)).state).toBe("executed");
  });
});
