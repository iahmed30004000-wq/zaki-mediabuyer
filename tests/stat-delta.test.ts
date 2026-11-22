/**
 * ANY of the 31 numbers as «كنا ← صرنا» (v6 · P6): `statDelta` words the difference from the unit and the good direction of the number (the six of `deltaWords` have their own); `statMissing` says why a number is
 * missing by its group; `periodQuery` gives a window back. Pure — nothing here touches a formula of `numbers.ts`.
 */
import { describe, expect, it } from "vitest";
import { periodQuery, statDelta, statMissing } from "@/core/compare";
import { STATS, SET_KEYS, type NumbersSet } from "@/core/numbers";
import type { SourceFacts } from "@/core/numbers-readiness";

const FACTS: SourceFacts = { now: "2026-11-22T12:00:00.000Z", metaLinked: true, spendYesterday: true, omsLinked: true, omsLastPullAt: "2026-11-22T11:00:00.000Z", productsWithoutBreakeven: 0, unmappedFolders: 0, productsWithoutName: 0, stockFresh: true };
const set = (over: Partial<NumbersSet> = {}): NumbersSet => ({ ...Object.fromEntries(SET_KEYS.map((k) => [k, null])), ...over }) as NumbersSet;

describe("statDelta", () => {
  it("a share is read in points; the colour is the good direction of THIS number, not the sign", () => {
    expect(statDelta({ unit: "%", good: "up" }, 57, 50)).toEqual({ words: "أحسن 7 نقاط", tone: "good" });
    expect(statDelta({ unit: "%", good: "up" }, 47, 50)).toEqual({ words: "أسوأ 3 نقاط", tone: "bad" });
    expect(statDelta({ unit: "%", good: "down" }, 47, 50)).toEqual({ words: "أحسن 3 نقاط", tone: "good" });
    expect(statDelta({ unit: "%", good: "none" }, 30, 20)).toEqual({ words: "زاد 10 نقاط", tone: "flat" });
  });

  it("a cost in dollars is dearer or cheaper; an amount that is good when it grows is more or less", () => {
    expect(statDelta({ unit: "$", good: "down" }, 8, 10)).toEqual({ words: "أرخص 20%", tone: "good" });
    expect(statDelta({ unit: "$", good: "down" }, 12, 10)).toEqual({ words: "أغلى 20%", tone: "bad" });
    expect(statDelta({ unit: "$", good: "up" }, 12, 10)).toEqual({ words: "أكتر 20%", tone: "good" });
  });

  it("a count: more or fewer; fewer rejections is GOOD (green), more of them is bad", () => {
    expect(statDelta({ unit: "", good: "up" }, 120, 100)).toEqual({ words: "أكتر 20%", tone: "good" });
    expect(statDelta({ unit: "", good: "down" }, 10, 20)).toEqual({ words: "أقل 50%", tone: "good" });
    expect(statDelta({ unit: "", good: "down" }, 30, 20)).toEqual({ words: "أكتر 50%", tone: "bad" });
  });

  it("a number with no good direction says grew or fell, always grey", () => {
    expect(statDelta({ unit: "$", good: "none" }, 120, 100)).toEqual({ words: "زاد 20%", tone: "flat" });
    expect(statDelta({ unit: "", good: "none" }, 50, 100)).toEqual({ words: "نزل 50%", tone: "flat" });
  });

  it("the days of cover: more is better", () => {
    expect(statDelta({ unit: "يوم", good: "up" }, 6.5, 5)).toEqual({ words: "أكتر 30%", tone: "good" });
  });

  it("under one percent (half a point for a share) is «متل ما هو»; «كنا» of zero or missing, or «صرنا» missing, gives nothing — never a made-up zero", () => {
    expect(statDelta({ unit: "$", good: "down" }, 10.05, 10)).toEqual({ words: "متل ما هو", tone: "flat" });
    expect(statDelta({ unit: "%", good: "up" }, 50.4, 50)).toEqual({ words: "متل ما هو", tone: "flat" });
    expect(statDelta({ unit: "", good: "up" }, 5, 0)).toBeNull();
    expect(statDelta({ unit: "", good: "up" }, 5, null)).toBeNull();
    expect(statDelta({ unit: "", good: "up" }, null, 5)).toBeNull();
    expect(statDelta({ unit: "%", good: "up" }, 5, undefined)).toBeNull();
    expect(statDelta({ unit: "", good: "up" }, Number.NaN, 5)).toBeNull();
  });

  it("every one of the 31 numbers has a definition that gives a difference or says nothing — none throws", () => {
    expect(STATS).toHaveLength(31);
    for (const s of STATS) expect(() => statDelta(s, 12, 10), s.key).not.toThrow();
    // a spot check across the list: the shares are the ones in %, and every share word is points
    for (const s of STATS.filter((x) => x.unit === "%")) expect(statDelta(s, 60, 50)?.words, s.key).toMatch(/نقاط$/);
  });
});

describe("statMissing — the reason by group", () => {
  it("the ads' and the cost's stand on the spend first; with the spend there, on the orders; the stock on Claude", () => {
    expect(statMissing("ads", set(), { ...FACTS, metaLinked: false })).toBe("ميتا مش مربوطة");
    expect(statMissing("ads", set({ spend: 5 }), FACTS)).toBe("ما في رقم للفترة");
    expect(statMissing("cost", set(), FACTS)).toBe("ما في صرف مسجّل للفترة");
    expect(statMissing("cost", set({ spend: 5 }), { ...FACTS, omsLinked: false })).toBe("نظام الطلبات مش مربوط");
    for (const g of ["site", "confirm", "offers", "shipping", "money"]) expect(statMissing(g, set(), { ...FACTS, omsLastPullAt: null }), g).toBe("ما سحبنا من نظام الطلبات لسا");
    expect(statMissing("stock", set(), FACTS)).toBe("Claude لسا ما بعت المخزون");
  });

  it("the orders are there but this number is not: the plain sentence, never a tool name", () => {
    expect(statMissing("confirm", set({ ordersIn: 10 }), FACTS)).toBe("ما في رقم للفترة");
  });
});

describe("periodQuery — a window given back", () => {
  it("the default seven days is empty; the other choices keep their key; a range keeps its days", () => {
    expect(periodQuery({ period: "7", from: "2026-11-15", to: "2026-11-21" })).toBe("");
    expect(periodQuery({ period: "1", from: "2026-11-21", to: "2026-11-21" })).toBe("p=1");
    expect(periodQuery({ period: "30", from: "2026-10-23", to: "2026-11-21" })).toBe("p=30");
    expect(periodQuery({ period: "custom", from: "2026-11-01", to: "2026-11-10" })).toBe("p=custom&from=2026-11-01&to=2026-11-10");
  });
});
