import { describe, expect, it } from "vitest";
import { lastNight, DEFAULT_MODE, type OwnerMode } from "@/core/mode";
import { DEFAULT_RULES, type CampaignRules } from "@/core/rules-v2";
import { averageDays, buildAlerts, change, costPerOrder, isTestStage, testShare } from "@/core/today";

const rules = (x: Partial<CampaignRules> = {}): CampaignRules => ({ ...DEFAULT_RULES, ...x });
const base = { testShare: null, testLimit: 0.2, products: [], zeroOrders: [], stock: [], rules: rules() };

describe("the four numbers of اليوم (v3 · B)", () => {
  it("costs a real order as spend over orders, and says nothing when there are none", () => {
    expect(costPerOrder(30, 10)).toBe(3);
    expect(costPerOrder(31.5, 4)).toBe(7.88);
    expect(costPerOrder(30, 0)).toBeNull();
  });

  it("measures how far a number moved from its base, calling ±2% flat", () => {
    expect(change(6.05, 3.3)).toEqual({ pct: 83.33, dir: "up" });
    expect(change(90, 100)).toEqual({ pct: -10, dir: "down" });
    expect(change(101, 100).dir).toBe("flat");
    expect(change(5, 0)).toEqual({ pct: null, dir: "flat" });
    expect(change(null, 5).pct).toBeNull();
  });

  it("averages whole days — cost per order is total spend over total orders, never a mean of ratios", () => {
    const avg = averageDays([
      { spend: 100, orders: 10, costPerOrder: 10, profit: 20 },
      { spend: 100, orders: 40, costPerOrder: 2.5, profit: 60 },
      { spend: null, orders: null, costPerOrder: null, profit: null },
    ]);
    expect(avg).toEqual({ spend: 100, orders: 25, costPerOrder: 4, profit: 40 });
    expect(averageDays([])).toEqual({ spend: null, orders: null, costPerOrder: null, profit: null });
  });

  it("keeps the profit empty when no day could estimate one", () => {
    expect(averageDays([{ spend: 50, orders: 5, costPerOrder: 10, profit: null }]).profit).toBeNull();
  });

  it("computes the share of tests, and knows which stages are tests", () => {
    expect(testShare(70, 100)).toBe(0.7);
    expect(testShare(0, 0)).toBeNull();
    for (const s of ["TEST", "CRT", "AUD", "OFR"]) expect(isTestStage(s), s).toBe(true);
    for (const s of ["SCALE", null, undefined, ""]) expect(isTestStage(s), String(s)).toBe(false);
  });
});

describe("the alert strip (v3 · B)", () => {
  it("fires when the tests passed the limit — the incident of 14/11 (about 70% of the spend) is impossible to miss", () => {
    const [a] = buildAlerts({ ...base, testShare: 0.7 });
    expect(a).toMatchObject({ key: "test-share", tone: "danger" });
    expect(a!.text).toContain("70%");
    expect(a!.text).toContain("20%");
  });
  it("is a warning just over the limit, and silent at or under it", () => {
    expect(buildAlerts({ ...base, testShare: 0.25 })[0]).toMatchObject({ tone: "warn" });
    expect(buildAlerts({ ...base, testShare: 0.2 })).toEqual([]);
    expect(buildAlerts({ ...base, testShare: null })).toEqual([]);
  });

  it("names a product above its break-even — and says nothing for a product whose break-even is not typed", () => {
    const r = rules({ breakeven: { TIN01: 5.7 } });
    const list = buildAlerts({ ...base, rules: r, products: [{ code: "TIN01", name: "الطنين", cost: 6.05, orders: 12 }, { code: "KAM01", cost: 9, orders: 4 }, { code: "TIN01", cost: 5, orders: 9 }] });
    expect(list).toHaveLength(1);
    expect(list[0]!.text).toContain("6.05$");
    expect(list[0]!.text).toContain("5.7$");
    expect(list[0]!.text).toContain("الطنين");
  });
  it("does not fire from a product with no orders", () => {
    expect(buildAlerts({ ...base, rules: rules({ breakeven: { TIN01: 5 } }), products: [{ code: "TIN01", cost: null, orders: 0 }] })).toEqual([]);
  });

  it("lists a campaign that spends with no real order", () => {
    const [a] = buildAlerts({ ...base, zeroOrders: [{ name: "SY_TRF01_C03", spend: 14.5 }] });
    expect(a).toMatchObject({ key: "zero:SY_TRF01_C03", tone: "warn" });
    expect(a!.text).toContain("14.5$");
  });

  it("raises low stock at its three levels", () => {
    const list = buildAlerts({ ...base, stock: [{ code: "A", days: 3 }, { code: "B", days: 8 }, { code: "C", days: 12 }, { code: "D", days: 40 }] });
    expect(list.map((x) => [x.key, x.tone])).toEqual([["stock:A", "danger"], ["stock:B", "warn"], ["stock:C", "info"]]);
  });

  it("puts the dangerous first", () => {
    const list = buildAlerts({ ...base, testShare: 0.25, stock: [{ code: "C", days: 12 }, { code: "A", days: 3 }] });
    expect(list.map((x) => x.tone)).toEqual(["danger", "warn", "info"]);
  });
});

describe("last night (the morning card)", () => {
  const manual: OwnerMode = { ...DEFAULT_MODE, mode: "awake", since: "2026-11-15T07:00:00.000Z", asleepAt: "2026-11-14T23:00:00.000Z" };
  it("is the night the switch remembered", () => {
    const n = lastNight(manual, new Date("2026-11-15T08:00:00Z"));
    expect(n?.from.toISOString()).toBe("2026-11-14T23:00:00.000Z");
    expect(n?.to.toISOString()).toBe("2026-11-15T07:00:00.000Z");
  });
  it("is nothing while he still sleeps, or when he never slept", () => {
    expect(lastNight({ ...manual, mode: "asleep" }, new Date("2026-11-15T01:00:00Z"))).toBeNull();
    expect(lastNight({ ...DEFAULT_MODE }, new Date("2026-11-15T08:00:00Z"))).toBeNull();
  });
  it("is read from the clock when there is a schedule (awake 10:00, asleep 02:00 Amman)", () => {
    const sched: OwnerMode = { mode: "awake", since: null, schedule: { enabled: true, awake: "10:00", asleep: "02:00" } };
    const n = lastNight(sched, new Date("2026-11-15T09:30:00Z")); // 12:30 in Amman
    expect(n?.to.toISOString()).toBe("2026-11-15T07:00:00.000Z"); // 10:00 Amman
    expect(n?.from.toISOString()).toBe("2026-11-14T23:00:00.000Z"); // 02:00 Amman
    expect(lastNight(sched, new Date("2026-11-14T23:30:00Z"))).toBeNull(); // 02:30 Amman: asleep
  });
});
