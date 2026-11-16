import { describe, expect, it } from "vitest";
import { EMPTY_OPS_RULES, funnel, median, noAnswerRate, personFlag, readOpsRules } from "@/core/ops";

describe("the funnel", () => {
  it("each step carries its share of the one before; the shipments step is left out when unknown", () => {
    const f = funnel({ ordersIn: 100, confirmed: 80, landed: null, shippedOrders: 60, delivered: 45 });
    expect(f.map((s) => s.key)).toEqual(["in", "confirmed", "shipped", "delivered"]);
    expect(f.map((s) => s.pctOfPrev)).toEqual([null, 80, 75, 75]);
  });
  it("with the «landed» numbers: دخل ← مؤكد ← نزل على الشحن ← انشحن ← تسلّم", () => {
    const f = funnel({ ordersIn: 100, confirmed: 80, landed: 72, shippedOrders: 60, delivered: 45 });
    expect(f.map((s) => s.label)).toEqual(["دخل", "مؤكد", "نزل على الشحن", "انشحن", "تسلّم"]);
    expect(f[2]!.pctOfPrev).toBe(90);
    expect(f[3]!.pctOfPrev).toBe(83.3);
  });
  it("an unknown or a zero step before makes the share «—» (null), never a made-up number", () => {
    expect(funnel({ ordersIn: null, confirmed: 5, landed: null, shippedOrders: 3, delivered: null }).map((s) => s.pctOfPrev)).toEqual([null, null, 60, null]);
    expect(funnel({ ordersIn: 0, confirmed: 0, landed: null, shippedOrders: 0, delivered: 0 }).every((s) => s.pctOfPrev === null)).toBe(true);
  });
});

describe("the owner's limits", () => {
  it("empty by default; a bad value is dropped to null", () => {
    expect(readOpsRules(undefined)).toEqual(EMPTY_OPS_RULES);
    expect(readOpsRules({ stuckMax: 5, noAnswerMargin: -1, newDays: "x" })).toEqual({ stuckMax: 5, noAnswerMargin: null, newDays: null });
  });
});

describe("the flag beside a person", () => {
  const p = (over: Partial<{ claims: number | null; noAnswer: number | null; stuck48h: number | null; daysOfData: number }> = {}) => ({ claims: 20, noAnswer: 2, stuck48h: 1, daysOfData: 10, ...over });
  const rules = { stuckMax: 3, noAnswerMargin: 0.1, newDays: 3 };
  it("no limit written = no flag at all", () => {
    expect(personFlag(p({ stuck48h: 99 }), 0.1, EMPTY_OPS_RULES)).toBeNull();
  });
  it("«جديد» first, then «عالق كتير», then «ما ردّ عالي», else «منيح»", () => {
    expect(personFlag(p({ daysOfData: 2, stuck48h: 99 }), 0.1, rules)?.key).toBe("new");
    expect(personFlag(p({ stuck48h: 4 }), 0.1, rules)?.key).toBe("stuck");
    expect(personFlag(p({ stuck48h: 3 }), 0.1, rules)?.key).toBe("fine");
    expect(personFlag(p({ noAnswer: 8 }), 0.1, rules)?.key).toBe("noanswer"); // 0.4 > 0.1 + 0.1
    expect(personFlag(p({ noAnswer: 4 }), 0.1, rules)?.key).toBe("fine"); // 0.2 <= 0.2
  });
  it("a limit that is missing is skipped, not guessed", () => {
    expect(personFlag(p({ noAnswer: 18 }), 0.1, { stuckMax: 3, noAnswerMargin: null, newDays: null })?.key).toBe("fine");
    expect(personFlag(p({ stuck48h: 50 }), null, { stuckMax: null, noAnswerMargin: 0.1, newDays: null })?.key).toBe("fine");
  });
  it("the rate and the team's median", () => {
    expect(noAnswerRate({ claims: 20, noAnswer: 5 })).toBe(0.25);
    expect(noAnswerRate({ claims: 0, noAnswer: 5 })).toBeNull();
    expect(noAnswerRate({ claims: 10, noAnswer: null })).toBeNull();
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});
