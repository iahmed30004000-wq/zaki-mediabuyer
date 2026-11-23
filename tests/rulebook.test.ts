import { describe, expect, it } from "vitest";
import { aboveStreak, currencyGate, dataGate, dayCost, dayVerdict, judgeAd, judgeAdSet, judgedDays, judgeProductReturn, nightDue, plannedDaily, type AdFacts, type AdSetFacts, type CostParams, type DayFact } from "@/core/rulebook";
import { DEFAULT_RULES, type CampaignRules } from "@/core/rules-v2";

/**
 * The one rulebook (v6 · P10): every rule the night round applies, one case at a time. «Now» is 00:40 Amman on 2026-11-23, so the full days are
 * 11-18 … 11-22 and the numbers of a day are the Amman day's.
 */
const NOW = new Date("2026-11-22T21:40:00Z");
const rules = (over: Partial<CampaignRules> = {}): CampaignRules => ({ ...DEFAULT_RULES, ...over });
const day = (date: string, spend: number, orders = 0, purchases = 0): DayFact => ({ date, spend, orders, purchases });
const oms: CostParams = { basis: "oms", fee: 0, factor: 1.16 };
const pixel: CostParams = { basis: "pixel", fee: 0, factor: 1.16 };

const setFacts = (over: Partial<AdSetFacts> = {}): AdSetFacts => ({
  adSetId: "AS1", name: "BROAD_1", accountMetaId: "act_1", productCode: "TRF01", dailyBudget: 30, ageHours: 400, startDay: "2026-11-01",
  days: [day("2026-11-20", 20, 1), day("2026-11-21", 20, 1), day("2026-11-22", 20, 1)],
  attributionKnown: true, signalKnown: true, breakeven: 5, lastRaise: null, lastRevertAt: null, ...over,
});
const adFacts = (over: Partial<AdFacts> = {}): AdFacts => ({
  adId: "AD1", name: "CR00001", accountMetaId: "act_1", adSetId: "AS1", adSetAgeHours: 400, activeInAdSet: 3, adSetSpend: 60, startDay: "2026-11-01",
  days: [day("2026-11-20", 2), day("2026-11-21", 2), day("2026-11-22", 2)], attributionKnown: true, signalKnown: true, breakeven: 5, ...over,
});

describe("the cost of a real order (R-01 · R-09 · R-17: the day's numbers, the right basis)", () => {
  it("OMS basis: spend with the fee ÷ the orders the OMS tied to the ad", () => expect(dayCost(day("d", 20, 4), { ...oms, fee: 0.01 })).toBeCloseTo(5.05, 5));
  it("pixel basis: the pixel's cost × the owner's factor", () => expect(dayCost(day("d", 20, 0, 4), pixel)).toBeCloseTo(5.8, 5));
  it("no spend, or nothing to divide by: null — never zero", () => {
    expect(dayCost(day("d", 0, 4), oms)).toBeNull();
    expect(dayCost(day("d", 20, 0), oms)).toBeNull();
    expect(dayCost(day("d", 20, 0, 0), pixel)).toBeNull();
  });
  it("above = spent with no sale, or a cost over the break-even; no spend = no verdict", () => {
    expect(dayVerdict(day("d", 20, 0), 5, oms)).toBe("above");
    expect(dayVerdict(day("d", 20, 2), 5, oms)).toBe("above");
    expect(dayVerdict(day("d", 20, 4), 5, oms)).toBe("below");
    expect(dayVerdict(day("d", 0, 0), 5, oms)).toBeNull();
  });
  it("a streak counts the newest days back to back; a day without spend or a gap in the dates ends it", () => {
    const a = (d: string) => day(d, 20, 1);
    expect(aboveStreak([a("2026-11-20"), a("2026-11-21"), a("2026-11-22")], 5, oms)).toBe(3);
    expect(aboveStreak([a("2026-11-19"), day("2026-11-20", 0), a("2026-11-21"), a("2026-11-22")], 5, oms)).toBe(2);
    expect(aboveStreak([a("2026-11-19"), a("2026-11-21"), a("2026-11-22")], 5, oms)).toBe(2);
    expect(aboveStreak([a("2026-11-21"), day("2026-11-22", 20, 8)], 5, oms)).toBe(0);
  });
});

describe("which days are judged (the owner's «last N full days, never today, ignore the first day»)", () => {
  const d = (n: number) => day(`2026-11-${String(n).padStart(2, "0")}`, 10, 1);
  it("only the last judgeDays (or the longer window a rule needs)", () => {
    const list = [d(16), d(17), d(18), d(19), d(20), d(21), d(22)];
    expect(judgedDays(list, null, { ignoreFirstDay: false, judgeDays: 3 }).map((x) => x.date)).toEqual(["2026-11-20", "2026-11-21", "2026-11-22"]);
    expect(judgedDays(list, null, { ignoreFirstDay: false, judgeDays: 3 }, 5).map((x) => x.date)).toHaveLength(5);
  });
  it("the day the object started is dropped when he said so, and nothing before it counts", () => {
    const list = [d(18), d(19), d(20), d(21), d(22)];
    expect(judgedDays(list, "2026-11-20", { ignoreFirstDay: true, judgeDays: 5 }).map((x) => x.date)).toEqual(["2026-11-21", "2026-11-22"]);
    expect(judgedDays(list, "2026-11-20", { ignoreFirstDay: false, judgeDays: 5 }).map((x) => x.date)).toEqual(["2026-11-20", "2026-11-21", "2026-11-22"]);
  });
});

describe("the gates (nothing is changed outside the night round, on stale data, or on a currency we do not read)", () => {
  it("the night round is due from his time for three hours (R-02: not at noon, not at 00:34)", () => {
    expect(nightDue({ hour: 0, minute: 34 }, "00:35")).toBe(false);
    expect(nightDue({ hour: 0, minute: 35 }, "00:35")).toBe(true);
    expect(nightDue({ hour: 3, minute: 34 }, "00:35")).toBe(true);
    expect(nightDue({ hour: 3, minute: 35 }, "00:35")).toBe(false);
    expect(nightDue({ hour: 12, minute: 0 }, "00:35")).toBe(false);
    expect(nightDue({ hour: 1, minute: 0 }, "23:30")).toBe(true); // across midnight
  });
  it("stale data stops the round, and says how stale (R-07)", () => {
    expect(dataGate(1.5, 2)).toEqual({ ok: true, why: null });
    expect(dataGate(5, 2).ok).toBe(false);
    expect(dataGate(5, 2).why).toContain("5 ساعة");
    expect(dataGate(Infinity, 2).ok).toBe(false);
  });
  it("an account whose currency is not USD is not judged (R-17)", () => {
    expect(currencyGate("USD").ok).toBe(true);
    expect(currencyGate("jod").ok).toBe(false);
    expect(currencyGate("JOD").why).toContain("JOD");
    expect(currencyGate(null).ok).toBe(false);
  });
});

describe("rule: an ad set above its break-even N days back to back stops (R-01 · R-09 · R-10 · R-13 · R-14)", () => {
  it("3 days above on the OMS's orders → a pause, with the numbers in the sentence", () => {
    const { decision } = judgeAdSet(setFacts(), rules(), NOW);
    expect(decision).toMatchObject({ rule: "adset_above_breakeven", level: "adset", targetId: "AS1", action: "pause", accountMetaId: "act_1" });
    expect(decision!.sentence).toContain("3 أيام");
    expect(decision!.sentence).toContain("5.00$");
  });
  it("one day below breaks the run", () => expect(judgeAdSet(setFacts({ days: [day("2026-11-20", 20, 1), day("2026-11-21", 20, 8), day("2026-11-22", 20, 1)] }), rules(), NOW).decision).toBeNull());
  it("two days are not three", () => expect(judgeAdSet(setFacts({ days: [day("2026-11-21", 20, 1), day("2026-11-22", 20, 1)] }), rules(), NOW).decision).toBeNull());
  it("«no orders» when the OMS names the ads counts as above", () => expect(judgeAdSet(setFacts({ days: [day("2026-11-20", 9, 0), day("2026-11-21", 9, 0), day("2026-11-22", 9, 0)] }), rules(), NOW).decision?.rule).toBe("adset_above_breakeven"));
  it("pixel basis: the cost is the pixel's × his factor (5/4 × 1.16 = 5.8 is above 5, below 6)", () => {
    const days = ["2026-11-20", "2026-11-21", "2026-11-22"].map((d) => day(d, 20, 0, 4));
    expect(judgeAdSet(setFacts({ attributionKnown: false, days, breakeven: 5 }), rules(), NOW).decision).not.toBeNull();
    expect(judgeAdSet(setFacts({ attributionKnown: false, days, breakeven: 6 }), rules(), NOW).decision).toBeNull();
  });
  it("R-01: no OMS ad ids and no pixel purchases anywhere → no verdict at all, said (never «zero orders»)", () => {
    const v = judgeAdSet(setFacts({ attributionKnown: false, signalKnown: false, days: [day("2026-11-20", 20), day("2026-11-21", 20), day("2026-11-22", 20)] }), rules(), NOW);
    expect(v.decision).toBeNull();
    expect(v.held?.why).toContain("ما بنحكم");
  });
  it("R-10: a product with no break-even typed is held, not judged", () => {
    const v = judgeAdSet(setFacts({ breakeven: null }), rules(), NOW);
    expect(v.decision).toBeNull();
    expect(v.held?.why).toContain("TRF01");
  });
  it("a new ad set is left alone for the owner's hours (R-13: the age is from its start)", () => {
    expect(judgeAdSet(setFacts({ ageHours: 50 }), rules(), NOW).held?.why).toContain("جديدة");
    expect(judgeAdSet(setFacts({ ageHours: 50 }), rules({ newAdsetFreezeHours: 24 }), NOW).decision).not.toBeNull();
  });
  it("the first day is ignored: an ad set that started on the 20th has two judged days, not three", () => {
    expect(judgeAdSet(setFacts({ startDay: "2026-11-20" }), rules(), NOW).decision).toBeNull();
    expect(judgeAdSet(setFacts({ startDay: "2026-11-20" }), rules({ ignoreFirstDay: false }), NOW).decision).not.toBeNull();
  });
  it("his number of days is the one used", () => {
    const four = ["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"].map((d) => day(d, 20, 1));
    expect(judgeAdSet(setFacts({ days: four }), rules({ adsetPauseDays: 4, judgeDays: 4 }), NOW).decision?.sentence).toContain("4 أيام");
    expect(judgeAdSet(setFacts({ days: four.slice(1) }), rules({ adsetPauseDays: 4, judgeDays: 4 }), NOW).decision).toBeNull();
  });
});

describe("rule: a raised ad set that went above its break-even goes back, then stops", () => {
  const raised = { at: new Date("2026-11-21T10:00:00Z"), from: 30, to: 36 };
  it("back to the old budget on the first bad day after the raise", () => {
    const { decision } = judgeAdSet(setFacts({ dailyBudget: 36, lastRaise: raised, days: [day("2026-11-21", 20, 8), day("2026-11-22", 20, 1)] }), rules(), NOW);
    expect(decision).toMatchObject({ rule: "adset_revert", action: "reduce", newBudget: 30 });
    expect(decision!.sentence).toContain("36.00$");
  });
  it("not when he switched «back to the old budget» off", () => {
    const r = rules({ revert: { backToOldBudget: false, pauseAfterHours: 48 } });
    expect(judgeAdSet(setFacts({ dailyBudget: 36, lastRaise: raised, days: [day("2026-11-21", 20, 8), day("2026-11-22", 20, 1)] }), r, NOW).decision).toBeNull();
  });
  it("not when the budget is already back (nothing to revert)", () => expect(judgeAdSet(setFacts({ dailyBudget: 30, lastRaise: raised, days: [day("2026-11-21", 20, 8), day("2026-11-22", 20, 1)] }), rules(), NOW).decision).toBeNull());
  it("a bad day BEFORE the raise is not a reason to revert it", () => expect(judgeAdSet(setFacts({ dailyBudget: 36, lastRaise: { ...raised, at: new Date("2026-11-22T10:00:00Z") }, days: [day("2026-11-21", 20, 1), day("2026-11-22", 20, 8)] }), rules(), NOW).decision).toBeNull());
  it("after the revert, still above after his hours → it stops", () => {
    const { decision } = judgeAdSet(setFacts({ dailyBudget: 30, lastRaise: raised, lastRevertAt: new Date("2026-11-20T10:00:00Z"), days: [day("2026-11-21", 20, 8), day("2026-11-22", 20, 1)] }), rules(), NOW);
    expect(decision).toMatchObject({ rule: "adset_revert_pause", action: "pause" });
  });
  it("before his hours pass it does not stop yet", () => expect(judgeAdSet(setFacts({ dailyBudget: 30, lastRaise: raised, lastRevertAt: new Date("2026-11-22T10:00:00Z"), days: [day("2026-11-22", 20, 1)] }), rules(), NOW).decision).toBeNull());
});

describe("rule: a single ad stops on the owner's thresholds (a number he did not type = silent)", () => {
  const withAd = (over: Partial<CampaignRules["ad"]>) => rules({ ad: { ...DEFAULT_RULES.ad, daysAboveBreakeven: 0, ...over } });
  it("silent while his numbers are empty", () => expect(judgeAd(adFacts({ days: [day("2026-11-22", 50)] }), rules()).decision).toBeNull());
  it("spend at his limit with no sale → a pause", () => {
    const { decision } = judgeAd(adFacts(), withAd({ spendZeroSales: 6 }));
    expect(decision).toMatchObject({ rule: "ad_spend_no_sale", level: "ad", targetId: "AD1", action: "pause" });
    expect(judgeAd(adFacts(), withAd({ spendZeroSales: 6.01 })).decision).toBeNull();
  });
  it("one sale is not «no sale»", () => expect(judgeAd(adFacts({ days: [day("2026-11-20", 2, 1), day("2026-11-21", 2), day("2026-11-22", 2)] }), withAd({ spendZeroSales: 6 })).decision).toBeNull());
  it("spend at his limit with exactly one sale → a pause", () => {
    const facts = adFacts({ days: [day("2026-11-20", 4, 1), day("2026-11-21", 4), day("2026-11-22", 4)] });
    expect(judgeAd(facts, withAd({ spendOneSale: 12 })).decision?.rule).toBe("ad_spend_one_sale");
    expect(judgeAd(adFacts({ days: [day("2026-11-20", 4, 2), day("2026-11-21", 4), day("2026-11-22", 4)] }), withAd({ spendOneSale: 12 })).decision).toBeNull();
  });
  it("his days above the break-even, back to back → a pause", () => {
    const facts = adFacts({ days: [day("2026-11-20", 10, 1), day("2026-11-21", 10, 1), day("2026-11-22", 10, 1)] });
    expect(judgeAd(facts, withAd({ daysAboveBreakeven: 3 })).decision?.rule).toBe("ad_days_above");
    expect(judgeAd({ ...facts, breakeven: null }, withAd({ daysAboveBreakeven: 3 })).decision).toBeNull();
  });
  it("an ad set under his hours is not judged ad by ad", () => expect(judgeAd(adFacts({ adSetAgeHours: 40 }), withAd({ spendZeroSales: 1 })).held?.why).toContain("48"));
  it("the last active ad of an ad set is never stopped", () => expect(judgeAd(adFacts({ activeInAdSet: 1 }), withAd({ spendZeroSales: 1 })).held?.why).toContain("آخر إعلان"));
  it("«لم يُختبر»: under his share of the ad set's spend there is no verdict", () => {
    const v = judgeAd(adFacts({ adSetSpend: 100 }), withAd({ spendZeroSales: 1, untestedShare: 0.1 }));
    expect(v.decision).toBeNull();
    expect(v.held?.why).toContain("لم يُختبر");
  });
  it("R-01: with no sales signal at all an ad is not stopped for «no sale»", () => expect(judgeAd(adFacts({ attributionKnown: false, signalKnown: false }), withAd({ spendZeroSales: 1 })).decision).toBeNull());
  it("the fee is part of the spend on the OMS basis", () => {
    expect(judgeAd(adFacts({ days: [day("2026-11-22", 5.95)] }), withAd({ spendZeroSales: 6 }), 0.01).decision).not.toBeNull();
    expect(judgeAd(adFacts({ days: [day("2026-11-22", 5.95)] }), withAd({ spendZeroSales: 6 }), 0).decision).toBeNull();
  });
});

describe("what an account plans per day (R-03: ad sets AND campaign budgets, paused ones nothing)", () => {
  it("counts a campaign budget (CBO) together with ad set budgets", () => {
    expect(plannedDaily([{ status: "ACTIVE", dailyBudget: 100, adsets: [{ status: "ACTIVE", dailyBudget: null }] }, { status: "ACTIVE", dailyBudget: null, adsets: [{ status: "ACTIVE", dailyBudget: 40 }, { status: "ACTIVE", dailyBudget: 25.5 }] }])).toBe(165.5);
  });
  it("paused and Meta's «campaign paused» statuses count nothing, and neither do the ad sets under a paused campaign", () => {
    expect(plannedDaily([{ status: "CAMPAIGN_PAUSED", dailyBudget: 100, adsets: [{ status: "ACTIVE", dailyBudget: 40 }] }, { status: "ACTIVE", dailyBudget: null, adsets: [{ status: "ADSET_PAUSED", dailyBudget: 40 }, { status: "ACTIVE", dailyBudget: 10 }] }])).toBe(10);
  });
  it("nothing planned is 0", () => expect(plannedDaily([])).toBe(0));
});

describe("rule: the product's return stop (the owner's share of his first N shipments)", () => {
  const r = rules();
  it("more than his share of the first shipments → a pause of the product", () => {
    expect(judgeProductReturn({ productCode: "TIN01", shipments: 20, returned: 7, shipmentsToDate: 20 }, r)).toMatchObject({ rule: "high_return", level: "product", targetId: "TIN01", action: "pause", accountMetaId: null });
  });
  it("exactly at his share is not over it", () => expect(judgeProductReturn({ productCode: "TIN01", shipments: 50, returned: 16, shipmentsToDate: 50 }, r)).toBeNull());
  it("before his minimum of shipments, or after his window, nothing", () => {
    expect(judgeProductReturn({ productCode: "TIN01", shipments: 9, returned: 9, shipmentsToDate: 9 }, r)).toBeNull();
    expect(judgeProductReturn({ productCode: "TIN01", shipments: 80, returned: 40, shipmentsToDate: 80 }, r)).toBeNull();
  });
  it("his own numbers are the ones used", () => {
    expect(judgeProductReturn({ productCode: "TIN01", shipments: 20, returned: 7, shipmentsToDate: 20 }, rules({ returns: { stopShare: 0.5, windowShipments: 50, minShipments: 10 } }))).toBeNull();
    expect(judgeProductReturn({ productCode: "TIN01", shipments: 12, returned: 5, shipmentsToDate: 12 }, rules({ returns: { stopShare: 0.32, windowShipments: 50, minShipments: 15 } }))).toBeNull();
  });
});
