import { describe, expect, it } from "vitest";
import { evaluateAccount, evaluateAd, evaluateAdSet, evaluateProduct, isUntested, type AdFacts } from "@/core/rules";
import { effectiveLevel, modeFor, type ActionKind } from "@/core/autonomy";
import { canMove, flipFlopped, simulate, spendDeltaDaily, type ChangeItemDraft } from "@/core/changeset";

const ad = (x: Partial<AdFacts> = {}): AdFacts => ({
  adId: "a1", adSetId: "s1", productCode: "TRF01", hoursRunning: 60, spend: 6, adSetSpend: 40, orders: 0, matureOrders: 0, confirmedMature: 0, fakeOrders: 0, tOrder: 2.5, ceiling: 6.64, newBatch: false, ...x,
});

describe("rule.loser_no_orders (spend ≥ 2 × T, 0 orders, ≥ 48 h)", () => {
  it("below the threshold: nothing", () => expect(evaluateAd(ad({ spend: 4.99 }))).toEqual([]));
  it("at the threshold: pause, with the numbers in the sentence", () => {
    const [dec] = evaluateAd(ad({ spend: 5 }));
    expect(dec).toMatchObject({ rule: "loser_no_orders", action: "pause", reasonCode: "S01", alertOnly: false });
    expect(dec!.sentence).toContain("5.00$");
  });
  it("one order is enough to stay", () => expect(evaluateAd(ad({ spend: 9, orders: 1 }))).toEqual([]));
  it("before 48 h: no verdict", () => expect(evaluateAd(ad({ spend: 9, hoursRunning: 47 }))).toEqual([]));
  it("a new batch only alerts", () => expect(evaluateAd(ad({ spend: 9, newBatch: true }))[0]!.alertOnly).toBe(true));
});

describe("rule.loser_no_confirmed (1.5 × ceiling, ≥ 3 mature, 0 confirmed)", () => {
  it("fires on mature orders only", () => {
    expect(evaluateAd(ad({ spend: 10, orders: 3, matureOrders: 3, confirmedMature: 0 }))[0]).toMatchObject({ rule: "loser_no_confirmed", reasonCode: "S02" });
    expect(evaluateAd(ad({ spend: 10, orders: 3, matureOrders: 2, confirmedMature: 0 }))).toEqual([]);
    expect(evaluateAd(ad({ spend: 10, orders: 3, matureOrders: 3, confirmedMature: 1 }))).toEqual([]);
  });
});

describe("«لم يُختبر» is never a loser", () => {
  it("< 10% of the ad set after 72 h and < T", () => {
    const a = ad({ hoursRunning: 80, spend: 2, adSetSpend: 40 });
    expect(isUntested(a)).toBe(true);
    expect(evaluateAd(a)).toEqual([]);
  });
});

describe("other rules", () => {
  it("high_cpa waits for the first 100$, then reduces 30%", () => {
    expect(evaluateAdSet({ adSetId: "s1", productCode: "TRF01", costPerConfirmed: 8, ceiling: 6.64, productSpend: 99, newBatch: false })).toEqual([]);
    expect(evaluateAdSet({ adSetId: "s1", productCode: "TRF01", costPerConfirmed: 8, ceiling: 6.64, productSpend: 120, newBatch: false })[0]).toMatchObject({ action: "reduce", pct: 0.3 });
    expect(evaluateAdSet({ adSetId: "s1", productCode: "TRF01", costPerConfirmed: 6.6, ceiling: 6.64, productSpend: 120, newBatch: false })).toEqual([]);
    expect(evaluateAdSet({ adSetId: "s1", productCode: "TRF01", costPerConfirmed: 6.234, ceiling: 6.23, productSpend: 120, newBatch: false })).toEqual([]);
  });
  it("stock: < 2 days pauses (even a new batch), < 5 freezes scaling", () => {
    expect(evaluateProduct({ productCode: "TIN01", shipments: 0, returned: 0, shipmentsToDate: 0, stockDays: 1 })[0]).toMatchObject({ rule: "stock_out", action: "pause", alertOnly: false });
    expect(evaluateProduct({ productCode: "TIN01", shipments: 0, returned: 0, shipmentsToDate: 0, stockDays: 4 })[0]).toMatchObject({ rule: "stock_low", action: "freeze_scale" });
  });
  it("returns > 32% in the first 50 shipments stop the test", () => {
    expect(evaluateProduct({ productCode: "X", shipments: 20, returned: 7, shipmentsToDate: 20, stockDays: 30 })[0]).toMatchObject({ rule: "high_return" });
    expect(evaluateProduct({ productCode: "X", shipments: 20, returned: 6, shipmentsToDate: 20, stockDays: 30 })).toEqual([]);
    expect(evaluateProduct({ productCode: "X", shipments: 20, returned: 9, shipmentsToDate: 80, stockDays: 30 })).toEqual([]);
  });
  it("daily cap, spikes and stale data", () => {
    const base = { accountId: "act_1", spendToday: 100, dailyCap: 260, hourSpend: 5, avgHourSpend7d: 4, dailyBudgetsSum: 200, dataAgeHours: 0.5 };
    expect(evaluateAccount(base)).toEqual([]);
    expect(evaluateAccount({ ...base, spendToday: 260 }).map((x) => x.rule)).toEqual(["daily_cap"]);
    expect(evaluateAccount({ ...base, hourSpend: 13 }).map((x) => x.rule)).toEqual(["spend_spike"]);
    expect(evaluateAccount({ ...base, dataAgeHours: 3 }).map((x) => x.rule)).toEqual(["stale_data"]);
  });
});

describe("autonomy (spec 10.1), cell by cell", () => {
  const T: Record<ActionKind, string[]> = {
    safety_pause: ["suggest", "auto", "auto", "auto"],
    safety_reduce: ["suggest", "auto", "auto", "auto"],
    resume: ["suggest", "approval", "approval", "auto"],
    raise_step: ["suggest", "approval", "auto", "auto"],
    new_ad: ["suggest", "approval", "approval", "auto"],
    test_campaign: ["suggest", "approval", "approval", "auto"],
    customer_audience: ["suggest", "approval", "approval", "approval"],
    above_cap: ["suggest", "owner", "owner", "owner"],
    connect_asset: ["owner", "owner", "owner", "owner"],
  };
  for (const [kind, row] of Object.entries(T) as [ActionKind, string[]][]) {
    it(kind, () => expect([0, 1, 2, 3].map((l) => modeFor(kind, l as 0 | 1 | 2 | 3))).toEqual(row));
  }
  it("a raise at level 1 waits for approval", () => expect(modeFor("raise_step", 1)).toBe("approval"));
  it("any alarm drops the account to level 0", () => {
    expect(effectiveLevel(2, { sourceDown: true, bigGap: false, accountHealthAlert: false, tokenExpired: false })).toEqual({ level: 0, why: "مصدر بيانات واقف" });
    expect(effectiveLevel(2, { sourceDown: false, bigGap: false, accountHealthAlert: false, tokenExpired: false })).toEqual({ level: 2, why: null });
  });
});

describe("change sets (spec 10.2)", () => {
  it("only the allowed moves", () => {
    expect(canMove("pending_approval", "approved")).toBe(true);
    expect(canMove("draft", "executed")).toBe(false);
    expect(canMove("executed", "rolled_back")).toBe(true);
    expect(canMove("rolled_back", "executed")).toBe(false);
  });

  const raise: ChangeItemDraft = { op: "set_budget", objectType: "adset", objectId: "s1", before: { dailyBudget: 40 }, after: { dailyBudget: 48 } };
  const ctx = { plannedSpendToday: 189.6, dailyCap: 350, hoursSinceSignificant: { s1: 100 }, busyObjects: new Set<string>(), safety: false };

  it("the money a change moves", () => {
    expect(spendDeltaDaily([raise])).toBe(8);
    expect(spendDeltaDaily([{ op: "pause", objectType: "adset", objectId: "s1", before: { dailyBudget: 25 }, after: {} }])).toBe(-25);
  });
  it("simulating changes nothing and reports every check", () => {
    const sim = simulate([raise], ctx);
    expect(sim).toMatchObject({ ok: true, spendDeltaDaily: 8 });
    expect(sim.checks.map((c) => c.key)).toEqual(["cap", "learning", "conflict"]);
  });
  it("no raise without a known cap, none over the cap", () => {
    expect(simulate([raise], { ...ctx, dailyCap: null }).ok).toBe(false);
    expect(simulate([raise], { ...ctx, plannedSpendToday: 345 }).ok).toBe(false);
  });
  it("the learning guard blocks a significant edit within 72 h, but not safety", () => {
    const big: ChangeItemDraft = { ...raise, after: { dailyBudget: 60 } };
    expect(simulate([big], { ...ctx, hoursSinceSignificant: { s1: 20 } }).ok).toBe(false);
    expect(simulate([big], { ...ctx, hoursSinceSignificant: { s1: 20 }, safety: true, plannedSpendToday: 0 }).checks.find((c) => c.key === "learning")!.ok).toBe(true);
  });
  it("the loop guard: two flips in 48 h freeze", () => {
    const now = new Date("2026-10-26T12:00:00Z");
    const h = (hoursAgo: number, direction: "up" | "down") => ({ at: new Date(now.getTime() - hoursAgo * 3_600_000), direction });
    expect(flipFlopped([h(40, "down"), h(20, "up"), h(2, "down")], now)).toBe(true);
    expect(flipFlopped([h(40, "down"), h(20, "up")], now)).toBe(false);
    expect(flipFlopped([h(60, "down"), h(20, "up"), h(2, "down")], now)).toBe(false);
  });
});
