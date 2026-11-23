/**
 * The scale ladder inside the night round (v6 · P10): its numbers are the owner's rules and nothing else, its days are Amman days (R-14), a +20% step does not restart the
 * learning clock (R-18), stock blocks only when he said so, and his cap on the running products is the one that limits a raise. The database and the change service are doubles.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RULES, type CampaignRules } from "@/core/rules-v2";

const NOW = new Date("2026-11-22T21:40:00Z"); // 00:40 Amman, 23 Nov
const s = vi.hoisted(() => ({
  rules: null as unknown as CampaignRules,
  stockDays: 20 as number | null,
  adsets: [] as Record<string, unknown>[],
  campaigns: [] as Record<string, unknown>[],
  insights: [] as Record<string, unknown>[],
  orders: [] as Record<string, unknown>[],
  history: [] as Record<string, unknown>[],
  recent: false,
  proposals: [] as Record<string, unknown>[],
  ruleRuns: [] as Record<string, unknown>[],
}));

vi.mock("@/server/db", () => ({
  db: {
    adSet: { findMany: async () => s.adsets },
    campaign: { findMany: async () => s.campaigns },
    freeze: { findMany: async () => [] },
    insightDaily: { findMany: async () => s.insights },
    attributedOrder: { findMany: async () => s.orders },
    changeItem: { findMany: async () => s.history },
    productEconomics: { findUnique: async () => ({ stockDays: s.stockDays }) },
    ruleRun: { findFirst: async () => (s.recent ? { id: "r" } : null), create: async ({ data }: { data: Record<string, unknown> }) => void s.ruleRuns.push(data) },
  },
}));
vi.mock("@/server/settings", () => ({ getSetting: async () => 0.01 }));
vi.mock("@/server/rules", () => ({ getRules: async () => ({ rules: s.rules }) }));
vi.mock("@/server/changes", () => ({ propose: async (p: Record<string, unknown>) => (s.proposals.push(p), { id: "cs1", state: "pending_approval" }) }));

import { gatherScale, runScale } from "@/jobs/scale-run";

const DAYS = ["2026-11-20", "2026-11-21", "2026-11-22"];
const typed = (over: Partial<CampaignRules> = {}): CampaignRules => ({ ...DEFAULT_RULES, breakeven: { TRF01: 5 }, scale: { ...DEFAULT_RULES.scale, maxCost: 6.5, stepPct: 0.25, maxWeekPct: 0.6, everyHours: 48, days: 3, minConfirmed: 5 }, ...over });
const adset = (over: Record<string, unknown> = {}) => ({
  metaId: "AS1", name: "BROAD_1", status: "ACTIVE", dailyBudget: 40, lastSignificantEditAt: null, startTime: new Date("2026-10-01T00:00:00Z"), createdAt: new Date("2026-10-01T00:00:00Z"),
  ads: [{ metaId: "AD1" }], campaign: { status: "ACTIVE", stage: "SCALE", productCode: "TRF01", account: { metaId: "act_1" } }, ...over,
});
/** 5 confirmed orders a day at 00:30 Amman, mature long ago */
const orders = () => DAYS.flatMap((d) => Array.from({ length: 5 }, () => ({ createdAtOms: new Date(`${d}T00:30:00+03:00`), status: "confirmed", matureAt: new Date("2026-11-01T00:00:00Z") })));

beforeEach(() => {
  Object.assign(s, { rules: typed(), stockDays: 20, adsets: [adset()], campaigns: [], insights: DAYS.map((d) => ({ date: new Date(`${d}T00:00:00Z`), spend: 20 })), orders: orders(), history: [], recent: false, proposals: [], ruleRuns: [] });
});

describe("the ladder reads only the owner's rules", () => {
  it("silent while the cost he scales at is not typed", async () => {
    s.rules = typed({ scale: { ...DEFAULT_RULES.scale, maxCost: null } });
    expect(await gatherScale(NOW)).toEqual([]);
    expect((await runScale(NOW)).adsets).toBe(0);
    expect(s.proposals).toEqual([]);
  });
  it("a proven winner goes up by HIS step (25%), with his proof days and cost in the facts", async () => {
    const [row] = await gatherScale(NOW);
    expect(row!.facts).toMatchObject({ ceiling: 6.5, tOrder: 5, confirmedMature: 15, runningCap: null });
    expect(row!.facts.dailyCostPerConfirmed).toEqual([4.04, 4.04, 4.04]); // R-14: the 00:30 orders sit on their Amman day
    expect(row!.decision).toMatchObject({ raise: true, newBudget: 50 });
  });
  it("the 7-day cost must not pass the product's break-even; an untyped break-even leaves that check silent", async () => {
    s.rules = typed({ breakeven: { TRF01: 3 } });
    expect((await gatherScale(NOW))[0]!.decision.blockers.join(" ")).toContain("فوق التعادل");
    s.rules = typed({ breakeven: {} });
    expect((await gatherScale(NOW))[0]!.decision.raise).toBe(true);
  });
  it("stock does not block unless he switched it on (and then only under his red days)", async () => {
    s.stockDays = 1;
    expect((await gatherScale(NOW))[0]!.decision.raise).toBe(true);
    s.rules = typed({ scale: { ...typed().scale, stockBlocks: true } });
    expect((await gatherScale(NOW))[0]!.decision.blockers.join(" ")).toContain("المخزون");
  });
  it("his cap on the running products limits the raise; a test campaign is outside it", async () => {
    s.rules = typed({ scale: { ...typed().scale, capRunning: 100 } });
    s.campaigns = [{ status: "ACTIVE", stage: "SCALE", dailyBudget: null, adsets: [{ status: "ACTIVE", dailyBudget: 40 }, { status: "ACTIVE", dailyBudget: 55 }] }, { status: "ACTIVE", stage: "TEST", dailyBudget: null, adsets: [{ status: "ACTIVE", dailyBudget: 500 }] }];
    const [row] = await gatherScale(NOW);
    expect(row!.facts.runningDailyPlanned).toBe(95); // the 500$ test is not counted
    expect(row!.decision).toMatchObject({ raise: true, newBudget: 45 }); // room 5$
  });
  it("R-18: a step of under 20% 50 hours ago is not a «significant» edit: the next step waits his 48 hours, not 72", async () => {
    const at = new Date(NOW.getTime() - 50 * 3_600_000);
    s.history = [{ objectId: "AS1", op: "set_budget", before: { dailyBudget: 34 }, after: { dailyBudget: 40 }, createdAt: at, changeSet: { executedAt: at, kind: "raise_step", state: "executed" } }];
    const [row] = await gatherScale(NOW);
    expect(row!.facts.hoursSinceLastRaise).toBeCloseTo(50, 0);
    expect(row!.facts.hoursSinceSignificant).toBeGreaterThan(72);
    expect(row!.decision.raise).toBe(true);
  });
  it("a big edit 50 hours ago IS significant: the learning guard (his new-ad-set hours) still holds", async () => {
    const at = new Date(NOW.getTime() - 50 * 3_600_000);
    s.history = [{ objectId: "AS1", op: "set_budget", before: { dailyBudget: 20 }, after: { dailyBudget: 40 }, createdAt: at, changeSet: { executedAt: at, kind: "raise_step", state: "executed" } }];
    expect((await gatherScale(NOW))[0]!.decision.blockers.join(" ")).toContain("التعلّم");
  });
});

describe("proposing the raise", () => {
  it("one change set (raise_step) per ad set per day, with the owner's numbers in the sentence", async () => {
    const r = await runScale(NOW);
    expect(r).toMatchObject({ adsets: 1, waiting: 1 });
    expect(s.proposals[0]).toMatchObject({ source: "rule", sourceRef: "scale", kind: "raise_step", accountMetaId: "act_1", cooldownHours: 48 });
    expect((s.proposals[0]!.items as { after: { dailyBudget: number } }[])[0]!.after.dailyBudget).toBe(50);
    expect(s.ruleRuns[0]).toMatchObject({ rule: "scale", targetId: "AS1", action: "raise", changeSetId: "cs1" });
  });
  it("not again inside the day", async () => {
    s.recent = true;
    expect(await runScale(NOW)).toMatchObject({ skipped: 1 });
    expect(s.proposals).toEqual([]);
  });
});
