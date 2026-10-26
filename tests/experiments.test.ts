import { describe, expect, it } from "vitest";
import { creativeTestBudget, judgeExperiment, stopRulesFor } from "@/core/experiments";

describe("the tests (spec 5.3 / T4.2)", () => {
  it("a creative test budget is max(15$, 3 × T_order)", () => {
    expect(creativeTestBudget(2.5)).toBe(15);
    expect(creativeTestBudget(6.2)).toBe(19);
  });
  const rules = stopRulesFor("creative", { tOrder: 2.5, ceiling: 3.84 });
  it("no verdict in the first days; a no-order spender is still named a loser", () => {
    const v = judgeExperiment([{ key: "CPT0012", spend: 6, orders: 0, confirmed: 0 }], rules, 1);
    expect(v).toMatchObject({ status: "running", winner: null, losers: ["CPT0012"] });
  });
  it("the cheapest arm with enough confirmed under the ceiling wins at the end", () => {
    const v = judgeExperiment([
      { key: "CPT0012", spend: 60, orders: 30, confirmed: 20 },
      { key: "CPT0015", spend: 60, orders: 25, confirmed: 18 },
      { key: "CPT0016", spend: 60, orders: 4, confirmed: 3 },
    ], rules, 4);
    expect(v.status).toBe("done");
    expect(v.winner).toBe("CPT0012");
    expect(v.costs.CPT0012).toBe(3);
  });
  it("too few confirmed = «بيانات غير كافية», never a fake winner", () => {
    const v = judgeExperiment([{ key: "A", spend: 10, orders: 3, confirmed: 2 }], rules, 3);
    expect(v).toMatchObject({ status: "running", winner: null });
  });
  it("a landing test never ends before 7 days", () => {
    const l = stopRulesFor("landing", { tOrder: 2.5, ceiling: 3.84 });
    expect(l.minDays).toBe(7);
    expect(judgeExperiment([{ key: "LP1", spend: 100, orders: 60, confirmed: 40 }], l, 5).status).toBe("running");
  });
  it("time is up with no winner: done, and it says why", () => {
    expect(judgeExperiment([{ key: "A", spend: 40, orders: 5, confirmed: 2 }], rules, 4)).toMatchObject({ status: "done", winner: null });
  });
});
