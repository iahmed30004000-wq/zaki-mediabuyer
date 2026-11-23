import { describe, expect, it } from "vitest";
import { evaluateScale, SCALE_DEFAULTS, scaleParamsFrom, type ScaleFacts } from "@/core/scale";
import { DEFAULT_RULES } from "@/core/rules-v2";
import { levelChange, modeFor } from "@/core/autonomy";

const winner: ScaleFacts = {
  adSetId: "AS1", productCode: "TRF01", dailyBudget: 40, dailyCostPerConfirmed: [5.1, 5.6, 5.9], confirmedMature: 22, cpa7: 3.4, tOrder: 4.05, ceiling: 6.23,
  confirmRate: 0.7, productConfirmRate: 0.66, hoursSinceSignificant: 120, budgetWeekAgo: 40, raisesToday: 0, hoursSinceLastRaise: Infinity,
  frozen: null, stockDays: 18, runningCap: null, runningDailyPlanned: 90, isTest: false,
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
  it("a freeze stops it", () => {
    expect(evaluateScale({ ...winner, frozen: "المخزون بيكفي 4 أيام" }).raise).toBe(false);
  });
  it("stock does NOT block the raise unless the owner switched that on (the old engine did the opposite)", () => {
    expect(evaluateScale({ ...winner, stockDays: 1 }).raise).toBe(true);
    expect(evaluateScale({ ...winner, stockDays: 4 }, { ...SCALE_DEFAULTS, stockBlocks: true, stockBlockDays: 7 }).blockers[0]).toContain("المخزون");
    expect(evaluateScale({ ...winner, stockDays: 9 }, { ...SCALE_DEFAULTS, stockBlocks: true, stockBlockDays: 7 }).raise).toBe(true);
  });
  it("the running cap: cut to the room left, or — no room — scale horizontally; a test campaign is outside it", () => {
    expect(evaluateScale({ ...winner, runningCap: 95, runningDailyPlanned: 90 })).toMatchObject({ raise: true, newBudget: 45 });
    expect(evaluateScale({ ...winner, runningCap: 90, runningDailyPlanned: 90 })).toMatchObject({ raise: false, horizontal: true });
    expect(evaluateScale({ ...winner, runningCap: 90, runningDailyPlanned: 90, isTest: true }).raise).toBe(true);
  });
  it("a break-even the owner has not typed leaves the 7-day check silent (never a zero)", () => {
    expect(evaluateScale({ ...winner, tOrder: null, cpa7: 99 }).raise).toBe(true);
    expect(evaluateScale({ ...winner, tOrder: 4.05, cpa7: null }).raise).toBe(false);
  });
  it("the ladder's numbers are the owner's rules: silent while the cost he scales at is not typed", () => {
    expect(scaleParamsFrom(DEFAULT_RULES)).toBeNull();
    const typed = { ...DEFAULT_RULES, scale: { ...DEFAULT_RULES.scale, maxCost: 6.5, stepPct: 0.25, everyHours: 24, maxWeekPct: 0.4, stockBlocks: true, days: 2, minConfirmed: 3 }, newAdsetFreezeHours: 60, stock: { ...DEFAULT_RULES.stock, redDays: 5 } };
    expect(scaleParamsFrom(typed)).toEqual({ proofDays: 2, minConfirmed: 3, stepPct: 0.25, stepHours: 24, maxWeekPct: 0.4, learningGuardHours: 60, maxStepsPerDay: 1, stockBlocks: true, stockBlockDays: 5 });
    expect(scaleParamsFrom({ ...typed, scale: { ...typed.scale, stepPct: null } })).toBeNull();
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
