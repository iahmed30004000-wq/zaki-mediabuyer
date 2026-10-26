import { describe, expect, it } from "vitest";
import { evaluateScale, type ScaleFacts } from "@/core/scale";
import { levelChange, modeFor } from "@/core/autonomy";

const winner: ScaleFacts = {
  adSetId: "AS1", productCode: "TRF01", dailyBudget: 40, dailyCostPerConfirmed: [5.1, 5.6, 5.9], confirmedMature: 22, cpa7: 3.4, tOrder: 4.05, ceiling: 6.23,
  confirmRate: 0.7, productConfirmRate: 0.66, hoursSinceSignificant: 120, budgetWeekAgo: 40, raisesToday: 0, hoursSinceLastRaise: Infinity,
  frozen: null, stockDays: 18, productDailyCap: null, productDailySpendPlanned: 90,
};

describe("the scale ladder (spec 6.5)", () => {
  it("a proven winner goes up one step of 20%, with the proof in the sentence", () => {
    const d = evaluateScale(winner);
    expect(d).toMatchObject({ raise: true, newBudget: 48 });
    expect(d.sentence).toContain("40.00$ ← 48.00$");
  });
  it("one day above the ceiling, too few confirmed, or a missing day: no raise", () => {
    expect(evaluateScale({ ...winner, dailyCostPerConfirmed: [5.1, 6.5, 5.9] }).raise).toBe(false);
    expect(evaluateScale({ ...winner, dailyCostPerConfirmed: [5.1, null, 5.9] }).raise).toBe(false);
    expect(evaluateScale({ ...winner, confirmedMature: 4 }).blockers).toEqual(["4 مؤكد ناضج بس — بدنا 5"]);
  });
  it("cost per order over T, or a confirm rate below the product's: no raise", () => {
    expect(evaluateScale({ ...winner, cpa7: 4.5 }).raise).toBe(false);
    expect(evaluateScale({ ...winner, confirmRate: 0.5 }).blockers[0]).toContain("نسبة التأكيد");
  });
  it("the learning guard, a raise today, and 48 h between steps", () => {
    expect(evaluateScale({ ...winner, hoursSinceSignificant: 50 }).blockers[0]).toContain("التعلّم");
    expect(evaluateScale({ ...winner, raisesToday: 1, hoursSinceLastRaise: 80 }).blockers).toEqual(["انرفعت اليوم خلص"]);
    expect(evaluateScale({ ...winner, hoursSinceLastRaise: 30 }).raise).toBe(false);
  });
  it("never more than +50% in a week: the step is cut to the week's limit, then stops", () => {
    expect(evaluateScale({ ...winner, dailyBudget: 57.6, budgetWeekAgo: 40, hoursSinceLastRaise: 50 })).toMatchObject({ raise: true, newBudget: 60 });
    expect(evaluateScale({ ...winner, dailyBudget: 60, budgetWeekAgo: 40, hoursSinceLastRaise: 50 }).raise).toBe(false);
  });
  it("a freeze or low stock stops it", () => {
    expect(evaluateScale({ ...winner, frozen: "المخزون بيكفي 4 أيام" }).raise).toBe(false);
    expect(evaluateScale({ ...winner, stockDays: 4 }).raise).toBe(false);
  });
  it("the product cap: cut to the room left, or — no room — scale horizontally", () => {
    expect(evaluateScale({ ...winner, productDailyCap: 95, productDailySpendPlanned: 90 })).toMatchObject({ raise: true, newBudget: 45 });
    expect(evaluateScale({ ...winner, productDailyCap: 90, productDailySpendPlanned: 90 })).toMatchObject({ raise: false, horizontal: true });
  });
  it("level 2 raises on its own, level 1 asks, level 0 suggests (spec 10.1)", () => {
    expect([0, 1, 2, 3].map((l) => modeFor("raise_step", l as 0 | 1 | 2 | 3))).toEqual(["suggest", "approval", "auto", "auto"]);
  });
});

describe("who may change the level (spec 10.1)", () => {
  it("2 only after two weeks of decisions, 3 is off, down always, never up on a restricted account", () => {
    expect(levelChange(1, 2, { daysOfDecisions: 9, restricted: false })).toMatchObject({ ok: false });
    expect(levelChange(1, 2, { daysOfDecisions: 14, restricted: false }).ok).toBe(true);
    expect(levelChange(2, 3, { daysOfDecisions: 90, restricted: false }).ok).toBe(false);
    expect(levelChange(2, 0, { daysOfDecisions: 0, restricted: true }).ok).toBe(true);
    expect(levelChange(0, 1, { daysOfDecisions: 30, restricted: true }).ok).toBe(false);
  });
});
