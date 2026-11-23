/**
 * The night round (v6 · P10): from the rows to the verdicts to the proposals. The database, the rules and the change service are doubles; what is proven
 * is what the round reads, which verdicts it takes, and what it proposes — and that it proposes nothing it should not (stale data, no signal, a foreign currency).
 * «Now» is 00:40 Amman on 2026-11-23, inside a 00:35 night round.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignRules } from "@/core/rules-v2";
import { DEFAULT_RULES } from "@/core/rules-v2";

const NOW = new Date("2026-11-22T21:40:00Z");
const s = vi.hoisted(() => ({
  rules: null as unknown as CampaignRules,
  fresh: true,
  accounts: [] as Record<string, unknown>[],
  insights: [] as Record<string, unknown>[],
  orders: [] as Record<string, unknown>[],
  history: [] as Record<string, unknown>[],
  counts: [] as Record<string, unknown>[],
  done: false,
  alerts: [] as Record<string, unknown>[],
  ruleRuns: [] as Record<string, unknown>[],
  recentRun: false,
  proposals: [] as Record<string, unknown>[],
  scaleCalls: 0,
  objects: { ad: {}, adset: {}, campaigns: [] } as { ad: Record<string, unknown>; adset: Record<string, unknown>; campaigns: Record<string, unknown>[] },
}));

vi.mock("@/server/db", () => ({
  db: {
    adAccount: { findMany: async () => s.accounts },
    insightDaily: { findMany: async () => s.insights },
    attributedOrder: { findMany: async () => s.orders, groupBy: async () => s.counts },
    changeItem: { findMany: async () => s.history },
    jobRun: { findFirst: async () => (s.done ? { id: "j" } : null) },
    alert: { findFirst: async () => (s.alerts.length ? s.alerts[0] : null), create: async ({ data }: { data: Record<string, unknown> }) => void s.alerts.push(data) },
    ruleRun: { findFirst: async () => (s.recentRun ? { id: "r" } : null), create: async ({ data }: { data: Record<string, unknown> }) => void s.ruleRuns.push(data) },
    ad: { findUnique: async () => s.objects.ad },
    adSet: { findUnique: async () => s.objects.adset },
    campaign: { findMany: async () => s.objects.campaigns },
  },
}));
vi.mock("@/server/settings", () => ({ getSetting: async () => 0.01 }));
vi.mock("@/server/rules", () => ({ getRules: async () => ({ rules: s.rules }) }));
vi.mock("@/server/changes", () => ({ propose: async (p: Record<string, unknown>) => (s.proposals.push(p), { id: `cs${s.proposals.length}`, state: "executed" }) }));
vi.mock("@/agents/monitor", () => ({ explainSafety: async () => undefined }));
vi.mock("@/jobs/runner", () => ({ lastSuccess: async () => (s.fresh ? new Date(NOW.getTime() - 35 * 60_000) : null) }));
vi.mock("@/jobs/scale-run", () => ({ runScale: async () => (s.scaleCalls++, { adsets: 0 }) }));

import { itemsFor, planNight, runNight } from "@/jobs/night-round";

const DAY = ["2026-11-20", "2026-11-21", "2026-11-22"];
const ad = (metaId: string, over: Record<string, unknown> = {}) => ({ metaId, name: `CR-${metaId}`, status: "ACTIVE", startTime: null, createdAt: new Date("2026-10-01T00:00:00Z"), ...over });
const adset = (ads: Record<string, unknown>[], over: Record<string, unknown> = {}) => ({ metaId: "AS1", name: "BROAD_1", status: "ACTIVE", dailyBudget: 30, startTime: new Date("2026-10-01T00:00:00Z"), createdAt: new Date("2026-10-01T00:00:00Z"), ads, ...over });
const account = (adsets: Record<string, unknown>[], over: Record<string, unknown> = {}) => ({ metaId: "act_1", currency: "USD", campaigns: [{ status: "ACTIVE", productCode: "TRF01", startTime: null, dailyBudget: null, adsets }], ...over });
const spend = (adId: string, amount: number, purchases = 0) => DAY.map((d) => ({ objectId: adId, date: new Date(`${d}T00:00:00Z`), spend: amount, purchases }));
/** an OMS order at 00:30 Amman of `day` (that is 21:30 UTC of the day before) */
const orderAtMidnight = (adId: string, day: string) => ({ adId, createdAtOms: new Date(new Date(`${day}T00:30:00+03:00`).getTime()) });

beforeEach(() => {
  Object.assign(s, { rules: { ...DEFAULT_RULES, breakeven: { TRF01: 5 } }, fresh: true, accounts: [], insights: [], orders: [], history: [], counts: [], done: false, alerts: [], ruleRuns: [], recentRun: false, proposals: [], scaleCalls: 0, objects: { ad: {}, adset: {}, campaigns: [] } });
});

describe("what the round refuses to decide on", () => {
  it("stale data (or an OMS that never really pulled): no verdict, and the sentence says why (R-06 · R-07)", async () => {
    s.fresh = false;
    s.accounts = [account([adset([ad("AD1"), ad("AD2")])])];
    const p = await planNight(NOW);
    expect(p.decisions).toEqual([]);
    expect(p.gate).toContain("متأخرة");
  });
  it("R-01: nobody tells us the sales of the ads (no OMS ad ids, no pixel purchases) → nothing is judged, nothing is «zero orders»", async () => {
    s.accounts = [account([adset([ad("AD1"), ad("AD2")])])];
    s.insights = [...spend("AD1", 20), ...spend("AD2", 20)];
    const p = await planNight(NOW);
    expect(p.decisions).toEqual([]);
    expect(p.held.some((h) => h.targetId === "AS1" && h.why.includes("ما بنحكم"))).toBe(true);
  });
  it("R-17: an account in another currency is held whole", async () => {
    s.accounts = [account([adset([ad("AD1")])], { currency: "JOD" })];
    s.insights = spend("AD1", 20);
    s.orders = DAY.map((d) => orderAtMidnight("AD1", d));
    const p = await planNight(NOW);
    expect(p.decisions).toEqual([]);
    expect(p.held[0]).toMatchObject({ targetId: "act_1", level: "account" });
  });
  it("R-10: a product whose break-even he did not type is not judged", async () => {
    s.rules = { ...DEFAULT_RULES };
    s.accounts = [account([adset([ad("AD1")])])];
    s.insights = spend("AD1", 20);
    s.orders = DAY.map((d) => orderAtMidnight("AD1", d));
    const p = await planNight(NOW);
    expect(p.decisions).toEqual([]);
    expect(p.held.some((h) => h.why.includes("TRF01"))).toBe(true);
  });
});

describe("what the round decides", () => {
  it("three days above the break-even on the OMS's orders: the ad set stops, its ads are not judged one by one", async () => {
    s.rules = { ...DEFAULT_RULES, breakeven: { TRF01: 5 }, ad: { ...DEFAULT_RULES.ad, spendZeroSales: 1 } };
    s.accounts = [account([adset([ad("AD1"), ad("AD2")])])];
    s.insights = [...spend("AD1", 10), ...spend("AD2", 10)];
    s.orders = DAY.map((d) => orderAtMidnight("AD1", d));
    const p = await planNight(NOW);
    expect(p.decisions.map((d) => [d.rule, d.targetId])).toEqual([["adset_above_breakeven", "AS1"]]);
  });
  it("R-14: an order at 00:30 Amman belongs to THAT Amman day, not the UTC day before", async () => {
    s.rules = { ...DEFAULT_RULES, breakeven: { TRF01: 5 }, adsetPauseDays: 1, judgeDays: 1 };
    s.accounts = [account([adset([ad("AD1")])])];
    s.insights = spend("AD1", 20);
    // 8 orders at 00:30 on each day: 2.5$ each, below 5$ — only if they land on their own Amman day (in UTC the last day would show no sale at all)
    s.orders = DAY.flatMap((d) => Array.from({ length: 8 }, () => orderAtMidnight("AD1", d)));
    expect((await planNight(NOW)).decisions).toEqual([]);
  });
  it("the ads of an ad set that stays: the worst spender goes first and the last active one is never stopped", async () => {
    s.rules = { ...DEFAULT_RULES, breakeven: { TRF01: 50 }, adsetPauseDays: 9, ad: { ...DEFAULT_RULES.ad, spendZeroSales: 5 } };
    // AD3 is paused but sold (so the OMS does name this account's ads); AD1 and AD2 are the two active ones and neither sold
    s.accounts = [account([adset([ad("AD1"), ad("AD2"), ad("AD3", { status: "PAUSED" })])])];
    s.insights = [...spend("AD1", 10), ...spend("AD2", 12)];
    s.orders = DAY.map((d) => orderAtMidnight("AD3", d));
    const p = await planNight(NOW);
    expect(p.decisions.map((d) => d.targetId)).toEqual(["AD2"]);
    expect(p.held.some((h) => h.targetId === "AD1" && h.why.includes("آخر إعلان"))).toBe(true);
  });
  it("the product's return stop comes from the shipments of all days", async () => {
    s.accounts = [account([adset([ad("AD1")])])];
    s.counts = [{ productCode: "TIN01", status: "delivered", _count: { _all: 13 } }, { productCode: "TIN01", status: "returned", _count: { _all: 7 } }];
    const p = await planNight(NOW);
    expect(p.decisions).toEqual([expect.objectContaining({ rule: "high_return", targetId: "TIN01" })]);
  });
});

describe("the items a decision becomes", () => {
  it("an ad / an ad set pause carry the status they had; a revert is a budget change; a product pauses its running campaigns", async () => {
    s.objects = { ad: { status: "ACTIVE" }, adset: { status: "ACTIVE", dailyBudget: 36 }, campaigns: [{ metaId: "C1", status: "ACTIVE", dailyBudget: 10 }, { metaId: "C2", status: "CAMPAIGN_PAUSED", dailyBudget: null }] };
    const base = { accountMetaId: "act_1", reasonCode: "S01", sentence: "x" };
    expect(await itemsFor({ ...base, rule: "ad_spend_no_sale", level: "ad", targetId: "AD1", action: "pause" })).toEqual([{ op: "pause", objectType: "ad", objectId: "AD1", before: { status: "ACTIVE" }, after: { status: "PAUSED" } }]);
    expect(await itemsFor({ ...base, rule: "adset_above_breakeven", level: "adset", targetId: "AS1", action: "pause" })).toEqual([{ op: "pause", objectType: "adset", objectId: "AS1", before: { status: "ACTIVE", dailyBudget: 36 }, after: { status: "PAUSED" } }]);
    expect(await itemsFor({ ...base, rule: "adset_revert", level: "adset", targetId: "AS1", action: "reduce", newBudget: 30 })).toEqual([{ op: "set_budget", objectType: "adset", objectId: "AS1", before: { dailyBudget: 36 }, after: { dailyBudget: 30 } }]);
    expect((await itemsFor({ ...base, rule: "high_return", level: "product", targetId: "TIN01", action: "pause" })).map((i) => i.objectId)).toEqual(["C1"]);
  });
  it("an object that is gone gives nothing to propose", async () => {
    s.objects = { ad: null as never, adset: null as never, campaigns: [] };
    const base = { accountMetaId: "act_1", reasonCode: "S01", sentence: "x", rule: "ad_spend_no_sale" as const, action: "pause" as const };
    expect(await itemsFor({ ...base, level: "ad", targetId: "AD1" })).toEqual([]);
    expect(await itemsFor({ ...base, level: "adset", targetId: "AS1" })).toEqual([]);
  });
});

describe("running the round", () => {
  const winnerless = () => {
    s.rules = { ...DEFAULT_RULES, breakeven: { TRF01: 5 } };
    s.accounts = [account([adset([ad("AD1")])])];
    s.insights = spend("AD1", 20);
    s.orders = DAY.map((d) => orderAtMidnight("AD1", d));
    s.objects = { ad: { status: "ACTIVE" }, adset: { status: "ACTIVE", dailyBudget: 30 }, campaigns: [] };
  };
  it("outside the owner's window nothing is read or proposed (no change at noon)", async () => {
    winnerless();
    const r = await runNight(new Date("2026-11-23T09:00:00Z"));
    expect(r).toMatchObject({ acted: false });
    expect(s.proposals).toEqual([]);
    expect(s.scaleCalls).toBe(0);
  });
  it("once a day: a second look after it acted does nothing", async () => {
    winnerless();
    s.done = true;
    expect(await runNight(NOW)).toMatchObject({ acted: false, skipped: "already ran tonight" });
    expect(s.proposals).toEqual([]);
  });
  it("stale data: it waits, tells the owner once, proposes nothing and does not run the ladder", async () => {
    winnerless();
    s.fresh = false;
    expect(await runNight(NOW)).toMatchObject({ acted: false });
    expect(await runNight(NOW)).toMatchObject({ acted: false });
    expect(s.alerts).toHaveLength(1);
    expect(s.alerts[0]).toMatchObject({ kind: "night.waiting" });
    expect(s.proposals).toEqual([]);
    expect(s.scaleCalls).toBe(0);
  });
  it("acting: every decision is a safety change set from the rule, logged, and then the ladder runs", async () => {
    winnerless();
    const r = await runNight(NOW);
    expect(r).toMatchObject({ acted: true, decisions: 1, changes: 1 });
    expect(s.proposals).toHaveLength(1);
    expect(s.proposals[0]).toMatchObject({ source: "rule", sourceRef: "adset_above_breakeven", kind: "safety_pause", accountMetaId: "act_1", cooldownHours: 24 });
    expect(s.ruleRuns[0]).toMatchObject({ rule: "adset_above_breakeven", targetId: "AS1", action: "pause", changeSetId: "cs1" });
    expect(s.scaleCalls).toBe(1);
  });
  it("a decision inside its 24-hour cooldown is not proposed again", async () => {
    winnerless();
    s.recentRun = true;
    expect(await runNight(NOW)).toMatchObject({ acted: true, changes: 0, skipped: 1 });
    expect(s.proposals).toEqual([]);
  });
});
