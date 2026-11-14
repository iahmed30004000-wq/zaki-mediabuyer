import { describe, expect, it } from "vitest";
import { CampaignRulesSchema, DEFAULT_RULES, breakevenOf, describeRules, missingRules, readRules, type CampaignRules } from "@/core/rules-v2";
import { stockAlertKey, stockAlertText, stockUrgency } from "@/core/stock-alerts";

const filled = (): CampaignRules => ({
  ...DEFAULT_RULES,
  targetCost: 3,
  breakeven: { TIN01: 5.7, KAM01: 5 },
  ad: { ...DEFAULT_RULES.ad, spendZeroSales: 6, spendOneSale: 9 },
  scale: { ...DEFAULT_RULES.scale, maxCost: 3, capRunning: 800 },
  videos: { ...DEFAULT_RULES.videos, fatigueCostMax: 3 },
  budgets: { runningCap: 800, newProductTests: 50, testPerProduct: 15, fallbackTotal: 700 },
  newProductTest: { ...DEFAULT_RULES.newProductTest, perDay: 15, day2Max: 4, day3Max: 4, maxSpend: 50 },
});

describe("the campaign rules v2 (v4 · F)", () => {
  it("start with no amount of money at all — those are the owner's, typed in the rules page, never in this repository", () => {
    const r = DEFAULT_RULES;
    expect(r.targetCost).toBeNull();
    expect(r.breakeven).toEqual({});
    expect([r.ad.spendZeroSales, r.ad.spendOneSale, r.scale.maxCost, r.scale.capRunning, r.videos.fatigueCostMax]).toEqual([null, null, null, null, null]);
    expect(Object.values(r.budgets)).toEqual([null, null, null, null]);
    expect([r.newProductTest.perDay, r.newProductTest.day2Max, r.newProductTest.day3Max, r.newProductTest.maxSpend]).toEqual([null, null, null, null]);
    expect(CampaignRulesSchema.safeParse(r).success).toBe(true);
  });

  it("keep the process of the owner: the night round, three days, +20% every 48 hours, 72 hours of quiet for a new ad set", () => {
    const r = DEFAULT_RULES;
    expect([r.nightRound, r.judgeDays, r.ignoreFirstDay, r.realCostFactor]).toEqual(["00:35", 3, true, 1.16]);
    expect([r.scale.stepPct, r.scale.everyHours, r.scale.maxWeekPct, r.scale.stockBlocks]).toEqual([0.2, 48, 0.5, false]);
    expect(r.newAdsetFreezeHours).toBe(72);
    expect([r.stock.redDays, r.stock.orangeDays, r.stock.yellowDays]).toEqual([7, 10, 14]);
    expect(r.stock.audience).toEqual(["owner", "abdullah", "mohammad"]);
  });

  it("read what is stored over the defaults, field by field", () => {
    const r = readRules({ targetCost: 3, scale: { capRunning: 500 }, breakeven: { TIN01: 5.7 } });
    expect(r.targetCost).toBe(3);
    expect(r.scale.capRunning).toBe(500);
    expect(r.scale.days).toBe(3); // untouched default
    expect(r.breakeven).toEqual({ TIN01: 5.7 });
  });

  it("take the break-even map whole, so a removed product stays removed", () => {
    expect(readRules({ breakeven: { A: 1 } }).breakeven).toEqual({ A: 1 });
    expect(readRules({ breakeven: {} }).breakeven).toEqual({});
  });

  it("fall back to the defaults when what is stored is broken — never a crash on the night round", () => {
    expect(readRules({ nightRound: "midnight" })).toEqual(DEFAULT_RULES);
    expect(readRules("garbage")).toEqual(DEFAULT_RULES);
    expect(readRules(null)).toEqual(DEFAULT_RULES);
    expect(readRules({ realCostFactor: 0.2 })).toEqual(DEFAULT_RULES);
  });

  it("refuse a rule they do not know", () => {
    expect(CampaignRulesSchema.safeParse({ ...DEFAULT_RULES, secretRule: 1 }).success).toBe(false);
  });
});

describe("the fourteen sentences", () => {
  it("are fourteen, and say «؟» wherever a number is still missing", () => {
    const text = describeRules(DEFAULT_RULES);
    expect(text).toHaveLength(14);
    expect(text[2]).toContain("أقل من ؟");
    expect(text[2]).toContain("لسا ما انكتبت");
    expect(text.join("\n")).toContain("00:35");
  });

  it("carry the owner's numbers once he has typed them", () => {
    const text = describeRules(filled());
    expect(text[2]).toContain("أقل من 3$");
    expect(text[2]).toContain("TIN01 5.7$");
    expect(text[4]).toContain("6$");
    expect(text[4]).toContain("9$");
    expect(text[4]).toContain("10%");
    expect(text[6]).toContain("+20%");
    expect(text[6]).toContain("800$");
    expect(text[6]).toContain("المخزون ما بيمنع التكبير");
    expect(text[8]).toContain("أقل من 7 أيام");
    expect(text.join("\n")).not.toContain("؟");
  });

  it("say that Claude acts inside the rules and only notifies — the owner decides the rest", () => {
    expect(describeRules(DEFAULT_RULES)[13]).toContain("المالك بيقرر");
  });
});

describe("what is still missing", () => {
  it("lists the empty numbers, break-even first", () => {
    const m = missingRules(DEFAULT_RULES);
    expect(m[0]!.key).toBe("breakeven");
    expect(m.map((x) => x.key)).toContain("scale.capRunning");
    expect(m).toHaveLength(10);
  });
  it("is empty when everything is typed", () => {
    expect(missingRules(filled())).toEqual([]);
  });
  it("finds the break-even of a product by its code, whatever the case", () => {
    expect(breakevenOf(filled(), "tin01")).toBe(5.7);
    expect(breakevenOf(filled(), "NOPE")).toBeNull();
    expect(breakevenOf(filled(), null)).toBeNull();
  });
});

describe("stock alerts (rule 9)", () => {
  const t = DEFAULT_RULES.stock;
  it("rings red under 7 days, orange to 10, yellow to 14, and is quiet beyond", () => {
    expect(stockUrgency(3, t)).toBe("red");
    expect(stockUrgency(6.9, t)).toBe("red");
    expect(stockUrgency(7, t)).toBe("orange");
    expect(stockUrgency(9.9, t)).toBe("orange");
    expect(stockUrgency(10, t)).toBe("yellow");
    expect(stockUrgency(13.9, t)).toBe("yellow");
    expect(stockUrgency(14, t)).toBeNull();
  });
  it("writes the alert and its once-a-day key", () => {
    const a = stockAlertText("TIN01", 4.26, "red", 120);
    expect(a.title).toContain("🔴");
    expect(a.title).toContain("4.3");
    expect(a.body).toContain("120 قطعة");
    expect(stockAlertKey("TIN01", "red", "2026-11-14")).toBe("stock:TIN01:red:2026-11-14");
  });
});
