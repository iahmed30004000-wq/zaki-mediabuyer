/**
 * «كنا ← صرنا» (v6 · P5, docs/rebuild-v6/04-numbers.md §2–§4): the difference in WORDS and its colour from the good direction of each number, the per-day figures, why a number is
 * missing, and «مبدئي». The code decides every word; nothing here changes a formula of `numbers.ts` or `economics.ts` — a value is read from a `NumbersSet`.
 */
import { describe, expect, it } from "vitest";
import { HOME_METRICS, METRICS, deltaWords, digitsOf, homeTiles, matureThrough, missingReason, pointsWords, valueOf, wasNow, type MetricKey } from "@/core/compare";
import { SET_KEYS, type NumbersSet } from "@/core/numbers";
import type { SourceFacts } from "@/core/numbers-readiness";

const NOW = new Date("2026-11-22T09:00:00.000Z"); // Sunday 12:00 Amman
const FACTS: SourceFacts = { now: NOW.toISOString(), metaLinked: true, spendYesterday: true, omsLinked: true, omsLastPullAt: "2026-11-22T08:30:00.000Z", productsWithoutBreakeven: 0, unmappedFolders: 0, productsWithoutName: 0, stockFresh: true };
const set = (over: Partial<NumbersSet> = {}): NumbersSet => ({ ...Object.fromEntries(SET_KEYS.map((k) => [k, null])), ...over }) as NumbersSet;
const WINDOW = { days: 7, toDay: "2026-11-21" };

describe("deltaWords — the difference in words", () => {
  it("a cost is cheaper or dearer, by percent of «كنا»; lower is good", () => {
    expect(deltaWords("realCost", 2.96, 3.42)).toEqual({ words: "أرخص 13%", tone: "good" });
    expect(deltaWords("realCost", 3.7, 3.42)).toEqual({ words: "أغلى 8%", tone: "bad" });
    expect(deltaWords("costPerConfirmed", 4, 5)).toEqual({ words: "أرخص 20%", tone: "good" });
  });

  it("a count is more or fewer; more is good", () => {
    expect(deltaWords("orders", 141, 118)).toEqual({ words: "أكتر 19%", tone: "good" });
    expect(deltaWords("orders", 100, 104)).toEqual({ words: "أقل 4%", tone: "bad" });
  });

  it("a rate is compared in POINTS, not percent: 50% → 57% is «أحسن 7 نقاط»", () => {
    expect(deltaWords("confirmRate", 57, 50)).toEqual({ words: "أحسن 7 نقاط", tone: "good" });
    expect(deltaWords("confirmRate", 47, 50)).toEqual({ words: "أسوأ 3 نقاط", tone: "bad" });
    expect(deltaWords("deliveredRate", 80.4, 70)).toEqual({ words: "أحسن 10 نقاط", tone: "good" });
    expect(deltaWords("confirmRate", 61, 50)).toEqual({ words: "أحسن 11 نقطة", tone: "good" });
  });

  it("the spend says it grew or fell, and is ALWAYS grey (more spend is not good or bad by itself)", () => {
    expect(deltaWords("spend", 431, 402)).toEqual({ words: "زاد 7%", tone: "flat" });
    expect(deltaWords("spend", 300, 402)).toEqual({ words: "نزل 25%", tone: "flat" });
  });

  it("a change under one percent (half a point for a rate) is «متل ما هو», grey", () => {
    expect(deltaWords("realCost", 3.43, 3.42)).toEqual({ words: "متل ما هو", tone: "flat" });
    expect(deltaWords("orders", 100, 100)).toEqual({ words: "متل ما هو", tone: "flat" });
    expect(deltaWords("confirmRate", 50.4, 50)).toEqual({ words: "متل ما هو", tone: "flat" });
    expect(deltaWords("confirmRate", 50.5, 50)).toEqual({ words: "أحسن نقطة", tone: "good" });
  });

  it("«كنا» of zero or a missing side gives NO difference — never a made-up one", () => {
    expect(deltaWords("orders", 10, 0)).toBeNull();
    expect(deltaWords("realCost", null, 3)).toBeNull();
    expect(deltaWords("realCost", 3, null)).toBeNull();
    expect(deltaWords("confirmRate", undefined, 50)).toBeNull();
    expect(deltaWords("realCost", Number.NaN, 3)).toBeNull();
    // a rate that was zero is still a rate: the points are there
    expect(deltaWords("confirmRate", 12, 0)).toEqual({ words: "أحسن 12 نقطة", tone: "good" });
  });

  it("the words of the points follow Arabic: نقطة · نقطتين · 3-10 نقاط · 11+ نقطة", () => {
    expect([1, 2, 3, 10, 11, 25].map(pointsWords)).toEqual(["نقطة", "نقطتين", "3 نقاط", "10 نقاط", "11 نقطة", "25 نقطة"]);
  });

  it("every metric of the table has a tone rule, and the good direction is the owner's: a cost down, a count up", () => {
    for (const k of Object.keys(METRICS) as MetricKey[]) expect(deltaWords(k, 50, 100)).not.toBeNull();
    expect(HOME_METRICS).toEqual(["realCost", "orders", "confirmRate", "spend"]);
  });
});

describe("the value of a tile", () => {
  it("a per-day figure is the window's total over its days; the others are read as they are; a missing one stays missing", () => {
    expect(valueOf("orders", set({ ordersIn: 70 }), 7)).toBe(10);
    expect(valueOf("spend", set({ spend: 2814 }), 7)).toBe(402);
    expect(valueOf("realCost", set({ costPerOrder: 3.42 }), 7)).toBe(3.42);
    expect(valueOf("orders", set({ ordersIn: null }), 7)).toBeNull();
    expect(valueOf("deliveredRate", set({ deliveryRate30: 71.5 }), 7)).toBe(71.5);
  });

  it("an average of a day is written whole once it is big and with a decimal while it is small", () => {
    expect(digitsOf("spend", 402, 431)).toBe(0);
    expect(digitsOf("spend", 40, 431)).toBe(2);
    expect(digitsOf("orders", 118, 141)).toBe(0);
    expect(digitsOf("orders", 4.7, 4.0)).toBe(1);
    expect(digitsOf("realCost", 3, 3)).toBeUndefined();
  });
});

describe("one tile", () => {
  it("«صرنا» against «كنا»: the words, the colour and the source", () => {
    const t = wasNow("realCost", set({ costPerOrder: 2.96 }), set({ costPerOrder: 3.42 }), [], FACTS, WINDOW);
    expect(t).toMatchObject({ key: "realCost", label: "تكلفة الطلب الحقيقي", now: 2.96, was: 3.42, words: "أرخص 13%", tone: "good", source: "real", missing: null, series: [] });
    expect(t.delta).toEqual({ abs: -0.46, pct: -13.5, points: null });
    const spend = wasNow("spend", set({ spend: 2814 }), set({ spend: 3017 }), [], FACTS, WINDOW);
    expect(spend).toMatchObject({ now: 402, was: 431, source: "meta", tone: "flat", words: "نزل 7%", digits: 0 });
  });

  it("a rate carries its difference in points and no percent", () => {
    const t = wasNow("confirmRate", set({ confirmRate: 57 }), set({ confirmRate: 50 }), [], FACTS, WINDOW);
    expect(t.delta).toEqual({ abs: 7, pct: null, points: 7 });
    expect(t.words).toBe("أحسن 7 نقاط");
  });

  it("a missing number is null with the REASON, not zero; and it has no words", () => {
    const t = wasNow("realCost", set(), set(), [], { ...FACTS, metaLinked: false }, WINDOW);
    expect(t).toMatchObject({ now: null, was: null, words: null, delta: null, tone: "flat", missing: "ميتا مش مربوطة" });
  });

  it("with «كنا» missing the number is still shown, with no difference", () => {
    const t = wasNow("orders", set({ ordersIn: 70 }), set(), [], FACTS, WINDOW);
    expect(t).toMatchObject({ now: 10, was: null, words: null, delta: null, missing: null });
  });

  it("the home has four tiles, in order", () => {
    const tiles = homeTiles(set({ costPerOrder: 3, ordersIn: 70, confirmRate: 50, spend: 700 }), set({ costPerOrder: 3, ordersIn: 70, confirmRate: 50, spend: 700 }), FACTS, WINDOW);
    expect(tiles.map((t) => t.key)).toEqual(["realCost", "orders", "confirmRate", "spend"]);
    expect(tiles.every((t) => t.words === "متل ما هو")).toBe(true);
  });
});

describe("why a number is missing — a sentence, by what it stands on", () => {
  it("the spend: Meta is not linked, or it is linked and nothing was recorded for the window", () => {
    expect(missingReason("spend", set(), { ...FACTS, metaLinked: false })).toBe("ميتا مش مربوطة");
    expect(missingReason("spend", set(), FACTS)).toBe("ما في صرف مسجّل للفترة");
    expect(missingReason("spend", set({ spend: 5 }), FACTS)).toBeNull();
  });

  it("the orders: the OMS is not linked, never pulled, pulled long ago, or simply has none in the window", () => {
    expect(missingReason("orders", set(), { ...FACTS, omsLinked: false })).toBe("نظام الطلبات مش مربوط");
    expect(missingReason("orders", set(), { ...FACTS, omsLastPullAt: null })).toBe("ما سحبنا من نظام الطلبات لسا");
    expect(missingReason("orders", set(), { ...FACTS, omsLastPullAt: "2026-11-21T10:00:00.000Z" })).toBe("نظام الطلبات ما انسحب من فترة");
    expect(missingReason("orders", set(), FACTS)).toBe("ما في طلبات بالفترة");
  });

  it("the cost of an order needs the spend first, then the orders", () => {
    expect(missingReason("realCost", set({ ordersIn: 9 }), { ...FACTS, metaLinked: false })).toBe("ميتا مش مربوطة");
    expect(missingReason("realCost", set({ spend: 9 }), { ...FACTS, omsLinked: false })).toBe("نظام الطلبات مش مربوط");
  });

  it("the confirm rate is not known when the rejected count is not (R-20) — it is not 100%", () => {
    expect(missingReason("confirmRate", set({ ordersIn: 9, confirmed: 5, rejected: null }), FACTS)).toBe("المرفوض مش معروف لنظام الطلبات");
    expect(missingReason("confirmRate", set({ confirmRate: 50 }), FACTS)).toBeNull();
  });
});

describe("«مبدئي» — the last day's confirmations can still move", () => {
  it("a day matures a full day after it ends: on Sunday noon Amman the latest mature day is Friday", () => {
    expect(matureThrough(NOW)).toBe("2026-11-20");
    expect(matureThrough(new Date("2026-11-22T20:59:59.000Z"))).toBe("2026-11-20"); // 23:59 Amman, still not the next midnight
    expect(matureThrough(new Date("2026-11-22T21:00:00.000Z"))).toBe("2026-11-21"); // 00:00 Amman on the 23rd
  });

  it("the confirm rate of a window ending yesterday is provisional; the cost of an order and the spend are not", () => {
    const cur = set({ confirmRate: 50, costPerConfirmed: 5, costPerOrder: 3, ordersIn: 7, spend: 21 });
    expect(wasNow("confirmRate", cur, cur, [], FACTS, WINDOW).provisional).toBe(true);
    expect(wasNow("costPerConfirmed", cur, cur, [], FACTS, WINDOW).provisional).toBe(true);
    expect(wasNow("realCost", cur, cur, [], FACTS, WINDOW).provisional).toBe(false);
    expect(wasNow("spend", cur, cur, [], FACTS, WINDOW).provisional).toBe(false);
    // a window that ended before the mature day is settled
    expect(wasNow("confirmRate", cur, cur, [], FACTS, { days: 7, toDay: "2026-11-20" }).provisional).toBe(false);
    // nothing to be provisional about when there is no number
    expect(wasNow("confirmRate", set(), set(), [], FACTS, WINDOW).provisional).toBe(false);
  });
});
