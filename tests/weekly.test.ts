import { describe, expect, it } from "vitest";
import { compareWeeks, decisionAccuracy, lessonsFrom, rankBy, weeklyText } from "@/core/weekly";
import { planWeek, type PlanProduct } from "@/core/plan";

describe("the weekly review (spec 12.2)", () => {
  const thisW = [{ code: "TRF01", name: "ماء الكمأة", spend: 300, orders: 90, matureOrders: 80, confirmed: 56, shipments: 50, delivered: 40, profit: 200 }];
  const lastW = [{ code: "TRF01", name: "ماء الكمأة", spend: 250, orders: 70, matureOrders: 60, confirmed: 40, shipments: 40, delivered: 30, profit: 120 }];
  it("compares the week with the last one: C, D, cost per confirmed and profit per delivered", () => {
    const [p] = compareWeeks(thisW, lastW);
    expect(p).toMatchObject({ C: 0.7, D: 0.8, costPerConfirmed: 5.36, profitPerDelivered: 5, last: { costPerConfirmed: 6.25, profitPerDelivered: 4 } });
  });
  it("ranks on cost per confirmed, small samples last and marked", () => {
    const r = rankBy([{ key: "HER", spend: 60, confirmed: 12 }, { key: "PRB", spend: 10, confirmed: 3 }, { key: "ING", spend: 80, confirmed: 10 }, { key: "HER", spend: 6, confirmed: 1 }]);
    expect(r.map((x) => [x.key, x.cost, x.smallSample])).toEqual([["HER", 5.08, false], ["ING", 8, false], ["PRB", 3.33, true]]);
  });
  it("a lesson needs enough sample and ≥ 15% under the median", () => {
    const angle = rankBy([{ key: "HER", spend: 50, confirmed: 10 }, { key: "ING", spend: 80, confirmed: 10 }, { key: "PRB", spend: 90, confirmed: 10 }]);
    expect(lessonsFrom({ angle }).map((l) => l.key)).toEqual(["angle:HER"]);
    expect(lessonsFrom({ angle: rankBy([{ key: "HER", spend: 75, confirmed: 10 }, { key: "ING", spend: 80, confirmed: 10 }]) })).toEqual([]);
    expect(lessonsFrom({ angle: rankBy([{ key: "HER", spend: 5, confirmed: 2 }, { key: "ING", spend: 80, confirmed: 10 }]) })).toEqual([]);
  });
  it("decision accuracy: rule decisions undone within 72 h count against the system", () => {
    const t = new Date("2026-10-01T00:00:00Z");
    const h = (n: number) => new Date(t.getTime() + n * 3_600_000);
    const a = decisionAccuracy([
      { source: "rule", kind: "safety_pause", state: "executed", executedAt: t, rolledBackAt: null },
      { source: "rule", kind: "safety_pause", state: "rolled_back", executedAt: t, rolledBackAt: h(10) },
      { source: "rule", kind: "safety_reduce", state: "rolled_back", executedAt: t, rolledBackAt: h(100) },
      { source: "user", kind: "safety_pause", state: "executed", executedAt: t, rolledBackAt: null },
    ]);
    expect(a).toEqual({ auto: 3, heldPct: 66.7, undone: 1 });
  });
  it("the text carries the code's figures and the arrows", () => {
    const text = weeklyText({ title: "التقرير الأسبوعي", products: compareWeeks(thisW, lastW), rankings: {}, reconciliation: { pixelPurchases: 95, omsWebOrders: 90, delivered: 40 }, changes: { auto: 4, approved: 2, rejected: 1, rolledBack: 1, pending: 0 }, tests: [], lessons: [], winners: [], fatigued: [], plan: [] });
    expect(text).toContain("تكلفة المؤكد 5.36$ (-14% ▲)");
    expect(text).toContain("Purchase بكسل 95 ↔ طلبات OMS من الموقع 90 ↔ مُسلَّم منها 40");
  });
});

describe("the weekly plan (M03 by code)", () => {
  const base: PlanProduct = { code: "TRF01", name: "ماء الكمأة", profitPerDelivered: 6, estimated: false, losing: false, stockDays: 18, tOrder: 4.05, spendNow: 120 };
  it("70% to scale by profit per delivered, tests at B_test per concept, 10% new — never above the cap", () => {
    const p = planWeek({ dailyCap: 300, split: { scale: 0.7, test: 0.2, new: 0.1 }, products: [base, { ...base, code: "SCR01", name: "كريم الندبات", profitPerDelivered: 3 }] });
    expect(p.daily_allocation.filter((a) => a.bucket === "scale").map((a) => [a.product_code, a.usd])).toEqual([["TRF01", 140], ["SCR01", 70]]);
    expect(p.daily_allocation.find((a) => a.bucket === "new")?.usd).toBe(30);
    expect(p.total_usd).toBeLessThanOrEqual(300);
  });
  it("low stock never gets more than it spends now; a losing product gets nothing", () => {
    const p = planWeek({ dailyCap: 300, split: { scale: 0.7, test: 0.2, new: 0.1 }, products: [{ ...base, stockDays: 4, spendNow: 50 }, { ...base, code: "NFG01", name: "كريم الفطريات", losing: true, profitPerDelivered: -1 }] });
    expect(p.daily_allocation.find((a) => a.product_code === "TRF01" && a.bucket === "scale")?.usd).toBe(50);
    expect(p.daily_allocation.some((a) => a.product_code === "NFG01")).toBe(false);
    expect(p.risks.join(" ")).toContain("خسران");
  });
  it("no winner yet: nothing to scale, said plainly", () => {
    const p = planWeek({ dailyCap: 100, split: { scale: 0.7, test: 0.2, new: 0.1 }, products: [{ ...base, profitPerDelivered: null }] });
    expect(p.daily_allocation.filter((a) => a.bucket === "scale")).toEqual([]);
    expect(p.risks[0]).toContain("ولا منتج ربحان");
  });
});
