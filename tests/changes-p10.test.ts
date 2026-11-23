/**
 * v6 · P10 in the change service: the cap is the sum of the budgets and is checked AGAIN at approval (R-08), a +20% step does not restart the learning clock
 * (R-18), the kill switch also asks Meta what is running when writing is live, and what a live write verified is put in the site's copy at once.
 * The database and Meta's reads are small doubles.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  sets: new Map<string, Record<string, unknown>>(),
  n: 0,
  cap: 100 as number | null,
  accountCampaigns: [] as Record<string, unknown>[],
  waiting: [] as { spendDeltaDaily: number }[],
  waitingQueries: [] as unknown[],
  history: [] as Record<string, unknown>[],
  mirror: [] as Record<string, unknown>[],
  mode: "dry_run" as "dry_run" | "live",
  token: null as string | null,
  liveCampaigns: [] as Record<string, unknown>[],
  liveFails: false,
  liveReads: 0,
  updates: [] as { table: string; where: unknown; data: Record<string, unknown> }[],
}));

vi.mock("@/server/db", () => {
  const find = (id: string, include?: { items?: boolean }) => {
    const r = s.sets.get(id);
    if (!r) throw new Error("not found");
    return { ...r, ...(include?.items ? {} : { items: undefined }) };
  };
  const rec = (table: string) => ({ updateMany: async ({ where, data }: { where: unknown; data: Record<string, unknown> }) => (s.updates.push({ table, where, data }), { count: 1 }) });
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
        findMany: async (q: unknown) => (s.waitingQueries.push(q), s.waiting),
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
        findMany: async (q: { where?: { changeSet?: { state?: { in?: string[] } } } }) => (q.where?.changeSet?.state?.in?.includes("executed") ? s.history : []),
      },
      adAccount: { findUnique: async () => ({ autonomyLevel: 2, dailyCap: s.cap, campaigns: s.accountCampaigns }), findMany: async () => [{ metaId: "act_1" }] },
      metaConnection: { findFirst: async () => null },
      ruleRun: { findFirst: async () => null },
      freeze: { create: async () => ({}) },
      experiment: { updateMany: async () => ({ count: 0 }), findFirst: async () => null },
      killSwitchEvent: { create: async () => ({}) },
      campaign: { findMany: async () => s.mirror, ...rec("campaign") },
      adSet: rec("adSet"),
      ad: rec("ad"),
    },
  };
});
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));
vi.mock("@/jobs/account-safety", () => ({ accountRestricted: async () => false }));
vi.mock("@/jobs/meta-sync", () => ({ metaToken: async () => s.token }));
vi.mock("@/meta/read", () => ({
  readCampaigns: async () => {
    s.liveReads++;
    if (s.liveFails) throw new Error("Meta down");
    return s.liveCampaigns;
  },
}));
vi.mock("@/meta/write", async (orig) => ({
  ...(await orig<typeof import("@/meta/write")>()),
  writeMode: () => s.mode,
  applyItem: async () => ({ verified: true, response: { ok: true }, readBack: {} }),
}));

import { approve, killSwitch, plannedDailyOf, propose } from "@/server/changes";
import type { Caller } from "@/server/auth";
import type { ChangeItemDraft } from "@/core/changeset";

const owner: Caller = { id: "u-owner", role: "OWNER", demo: false };
const raise: ChangeItemDraft = { op: "set_budget", objectType: "adset", objectId: "S1", before: { dailyBudget: 40 }, after: { dailyBudget: 48 } };
const book = (...budgets: number[]) => [{ status: "ACTIVE", dailyBudget: null, adsets: budgets.map((b) => ({ status: "ACTIVE", dailyBudget: b })) }];
const prop = (kind: "raise_step" | "above_cap" = "raise_step") => ({ source: "user" as const, reasonCode: "S12", sentence: "تكبير", kind, accountMetaId: "act_1", items: [raise] });

beforeEach(() => {
  s.sets.clear();
  Object.assign(s, { n: 0, cap: 100, accountCampaigns: [], waiting: [], waitingQueries: [], history: [], mirror: [], mode: "dry_run", token: null, liveCampaigns: [], liveFails: false, liveReads: 0, updates: [] });
});

describe("the cap is the sum of the budgets the account plans", () => {
  it("planned = every active budget + the raises already waiting (never counting the change itself)", async () => {
    s.accountCampaigns = book(60, 30);
    s.waiting = [{ spendDeltaDaily: 8 }, { spendDeltaDaily: -5 }];
    expect(await plannedDailyOf("act_1", "cs9")).toBe(98); // 90 + 8 (a cut waiting frees nothing until it runs)
    expect(JSON.stringify(s.waitingQueries[0])).toContain('"not":"cs9"');
  });
  it("an account the site does not know is null, and a raise on it is not simulated as fine", async () => {
    expect(await plannedDailyOf(null)).toBeNull();
    const cs = await propose({ ...prop(), accountMetaId: null }, { type: "user", id: "u" });
    expect(cs.state).toBe("pending_approval");
    expect((cs.simulation as { ok: boolean }).ok).toBe(false);
  });
  it("a raise that fits is proposed with a passing cap; one that does not is simulated as failing", async () => {
    s.accountCampaigns = book(60, 30);
    expect(((await propose(prop(), { type: "user", id: "u" })).simulation as { ok: boolean }).ok).toBe(true);
    s.accountCampaigns = book(60, 35);
    const over = await propose(prop(), { type: "user", id: "u" });
    expect((over.simulation as { checks: { key: string; ok: boolean }[] }).checks.find((c) => c.key === "cap")!.ok).toBe(false);
  });
});

describe("approval reads the trial again (R-08)", () => {
  it("what fitted when it was proposed but no longer does is refused, with the check that failed", async () => {
    s.accountCampaigns = book(60, 30);
    const cs = await propose(prop(), { type: "user", id: "u" });
    expect((cs.simulation as { ok: boolean }).ok).toBe(true);
    s.accountCampaigns = book(60, 45); // other budgets grew in between
    await expect(approve(cs.id as string, owner)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("مجموع الميزانيات") });
    expect(s.sets.get(cs.id as string)!.state).toBe("pending_approval");
    expect((s.sets.get(cs.id as string)!.simulation as { ok: boolean }).ok).toBe(false); // the stored trial is the new one
  });
  it("still fitting: approved and executed (a trial here)", async () => {
    s.accountCampaigns = book(60, 30);
    const cs = await propose(prop(), { type: "user", id: "u" });
    expect((await approve(cs.id as string, owner)).state).toBe("executed");
  });
  it("what only the owner decides (above the cap) is not stopped by the cap check", async () => {
    s.accountCampaigns = book(60, 45);
    const cs = await propose(prop("above_cap"), { type: "user", id: "u" });
    expect((await approve(cs.id as string, owner)).state).toBe("executed");
  });
});

describe("the learning clock (R-18)", () => {
  const past = (before: number, after: number) => ({ objectId: "S1", op: "set_budget", before: { dailyBudget: before }, after: { dailyBudget: after }, createdAt: new Date(), changeSet: { executedAt: new Date(Date.now() - 3_600_000), state: "executed" } });
  const big: ChangeItemDraft = { ...raise, before: { dailyBudget: 40 }, after: { dailyBudget: 60 } };
  const learning = (cs: Record<string, unknown>) => (cs.simulation as { checks: { key: string; ok: boolean }[] }).checks.find((c) => c.key === "learning")!.ok;
  it("a +20% step an hour ago does not block the next significant edit", async () => {
    s.accountCampaigns = book(10);
    s.history = [past(40, 48)];
    expect(learning(await propose({ ...prop(), items: [big] }, { type: "user", id: "u" }))).toBe(true);
  });
  it("a significant edit an hour ago does", async () => {
    s.accountCampaigns = book(10);
    s.history = [past(40, 60)];
    expect(learning(await propose({ ...prop(), items: [big] }, { type: "user", id: "u" }))).toBe(false);
  });
});

describe("the kill switch asks Meta too, when writing is live", () => {
  const stopItems = (id: string) => (s.sets.get(id)!.items as { objectId: string }[]).map((i) => i.objectId).sort();
  const mirror = (id: string) => ({ metaId: id, status: "ACTIVE", dailyBudget: 10, account: { metaId: "act_1" } });

  it("a campaign the site's copy lists as paused, but Meta says is running, is stopped too", async () => {
    s.mode = "live";
    s.token = "t";
    s.mirror = [mirror("c1")];
    s.liveCampaigns = [{ id: "c1", effective_status: "ACTIVE" }, { id: "c2", effective_status: "ACTIVE" }, { id: "c3", effective_status: "PAUSED" }, { id: "c4", effective_status: "CAMPAIGN_PAUSED" }];
    const r = await killSwitch("all", owner);
    expect(stopItems(r.changeSetId!)).toEqual(["c1", "c2"]);
    expect(r.objects).toBe(2);
  });
  it("a trial never reads Meta", async () => {
    s.mirror = [mirror("c1")];
    await killSwitch("all", owner);
    expect(s.liveReads).toBe(0);
  });
  it("Meta being down never stops the stop: the site's own list is still paused", async () => {
    s.mode = "live";
    s.token = "t";
    s.mirror = [mirror("c1"), mirror("c5")];
    s.liveFails = true;
    const r = await killSwitch("all", owner);
    expect(stopItems(r.changeSetId!)).toEqual(["c1", "c5"]);
  });
});

describe("what a live write verified is written into the site's copy at once", () => {
  it("a budget and a pause land on the right tables; a trial changes nothing", async () => {
    s.accountCampaigns = book(10);
    s.mode = "live";
    s.token = "t";
    await propose({ ...prop(), items: [raise, { op: "pause", objectType: "ad", objectId: "A1", before: { status: "ACTIVE" }, after: { status: "PAUSED" } }] }, { type: "user", id: "u" }).then((cs) => approve(cs.id as string, owner));
    expect(s.updates.find((u) => u.table === "adSet")!.data).toMatchObject({ dailyBudget: 48 });
    expect(s.updates.find((u) => u.table === "ad")!.data).toMatchObject({ status: "PAUSED" });
    s.updates.length = 0;
    s.mode = "dry_run";
    await propose({ ...prop(), items: [raise] }, { type: "user", id: "u" }).then((cs) => approve(cs.id as string, owner));
    expect(s.updates).toEqual([]);
  });
});
