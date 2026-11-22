/**
 * «كل منتج: كنا وصرنا» and «رحلة الطلب» (v6 · P6, docs/rebuild-v6/04-numbers.md §7): each product with the cost of a real order now and before, the orders of a day, and the verdict the existing
 * `productVerdict` gives; the road of an order out of every 100. The code divides and words; a step with no orders to divide is null, never 0.
 */
import { describe, expect, it } from "vitest";
import { funnelCompare, productCompares } from "@/core/compare";
import { SET_KEYS, type NumbersSet } from "@/core/numbers";
import type { SourceFacts } from "@/core/numbers-readiness";
import { commonBreakeven } from "@/lib/compare-view";

const NOW = "2026-11-22T09:00:00.000Z";
const FACTS: SourceFacts = { now: NOW, metaLinked: true, spendYesterday: true, omsLinked: true, omsLastPullAt: "2026-11-22T08:30:00.000Z", productsWithoutBreakeven: 0, unmappedFolders: 0, productsWithoutName: 0, stockFresh: true };
const set = (over: Partial<NumbersSet> = {}): NumbersSet => ({ ...Object.fromEntries(SET_KEYS.map((k) => [k, null])), ...over }) as NumbersSet;
const WINDOW = { days: 7, toDay: "2026-11-21" };

describe("productCompares", () => {
  const products = [
    { code: "A", name: "حرير", current: set({ costPerOrder: 2.4, ordersIn: 322 }), prev: set({ costPerOrder: 2.9, ordersIn: 266 }), breakeven: 4, hasData: true },
    { code: "B", name: "ندبات", current: set({ costPerOrder: 4.6, ordersIn: 84 }), prev: set({ costPerOrder: 4, ordersIn: 105 }), breakeven: 4.2, hasData: true },
    { code: "C", name: "فاضي", current: set(), prev: set(), breakeven: null, hasData: false },
  ];

  it("a row per product that has numbers, in the order given: the cost and the orders of a day with the words, and the verdict of the owner's own numbers", () => {
    const rows = productCompares(products, 3, FACTS, WINDOW);
    expect(rows.map((r) => r.code)).toEqual(["A", "B"]);
    expect(rows[0]).toMatchObject({ name: "حرير", breakeven: 4 });
    expect(rows[0]!.cost).toMatchObject({ key: "realCost", now: 2.4, was: 2.9, words: "أرخص 17%", tone: "good" });
    expect(rows[0]!.orders).toMatchObject({ key: "orders", now: 46, was: 38, words: "أكتر 21%", tone: "good" });
    expect(rows[0]!.verdict.key).toBe("win"); // 2.4 ≤ target 3
    expect(rows[1]!.cost).toMatchObject({ now: 4.6, was: 4, words: "أغلى 15%", tone: "bad" });
    expect(rows[1]!.verdict.key).toBe("lose"); // 4.6 > break-even 4.2
  });

  it("no target written: a cost under the break-even is «بين»; no break-even: the verdict says what is missing", () => {
    expect(productCompares([products[0]!], null, FACTS, WINDOW)[0]!.verdict.key).toBe("between");
    expect(productCompares([{ ...products[0]!, breakeven: null }], 3, FACTS, WINDOW)[0]!.verdict.key).toBe("norule");
  });

  it("a product with orders but no cost yet: the cost is missing WITH its reason, the verdict is «no data», and the orders still show", () => {
    const [r] = productCompares([{ code: "D", name: "د", current: set({ ordersIn: 14 }), prev: set({ ordersIn: 7 }), breakeven: 4, hasData: true }], 3, FACTS, WINDOW);
    expect(r!.cost).toMatchObject({ now: null, missing: "ما في صرف مسجّل للفترة" });
    expect(r!.verdict.key).toBe("nodata");
    expect(r!.orders.now).toBe(2);
  });

  it("the cost of an order takes the mark of the OMS: an estimate when the OMS is silent", () => {
    const [r] = productCompares([products[0]!], 3, { ...FACTS, omsLastPullAt: "2026-11-22T01:00:00.000Z" }, WINDOW);
    expect(r!.cost.source).toBe("estimate");
  });
});

describe("funnelCompare — out of every 100 orders", () => {
  const cur = { ordersIn: 200, confirmed: 114, shippedOrders: 104, delivered: 82 };
  const prev = { ordersIn: 100, confirmed: 50, shippedOrders: 44, delivered: 36 };

  it("100 came in; the others are the share of them, with «كنا» and the difference in POINTS", () => {
    expect(funnelCompare(cur, prev).map((s) => [s.key, s.now, s.was, s.words])).toEqual([
      ["in", 100, 100, null],
      ["confirmed", 57, 50, "أحسن 7 نقاط"],
      ["shipped", 52, 44, "أحسن 8 نقاط"],
      ["delivered", 41, 36, "أحسن 5 نقاط"],
    ]);
  });

  it("a step that is worse is red, one that did not move is grey", () => {
    const s = funnelCompare({ ordersIn: 100, confirmed: 47, shippedOrders: 52, delivered: 41 }, { ordersIn: 100, confirmed: 50, shippedOrders: 52, delivered: 41 });
    expect(s.find((x) => x.key === "confirmed")).toMatchObject({ words: "أسوأ 3 نقاط", tone: "bad" });
    expect(s.find((x) => x.key === "shipped")).toMatchObject({ words: "متل ما هو", tone: "flat" });
  });

  it("no orders in the window: every step is null (never 0) and says nothing; no «كنا»: the difference is not said", () => {
    const none = funnelCompare({ ordersIn: null, confirmed: null, shippedOrders: null, delivered: null }, prev);
    expect(none.every((s) => s.now === null && s.words === null)).toBe(true);
    const zero = funnelCompare({ ordersIn: 0, confirmed: 0, shippedOrders: 0, delivered: 0 }, prev);
    expect(zero.every((s) => s.now === null)).toBe(true);
    const noPrev = funnelCompare(cur, { ordersIn: null, confirmed: null, shippedOrders: null, delivered: null });
    expect(noPrev.map((s) => s.was)).toEqual([null, null, null, null]);
    expect(noPrev.every((s) => s.words === null)).toBe(true);
  });

  it("a count that is not known stays null even when the orders are", () => {
    const s = funnelCompare({ ordersIn: 100, confirmed: null, shippedOrders: 50, delivered: null }, prev);
    expect(s.map((x) => x.now)).toEqual([100, null, 50, null]);
  });
});

describe("commonBreakeven — the red line of the chart over ALL the products", () => {
  it("drawn only when every product with numbers has one and they are the same figure", () => {
    expect(commonBreakeven([{ hasData: true, breakeven: 4 }, { hasData: true, breakeven: 4 }])).toBe(4);
    expect(commonBreakeven([{ hasData: true, breakeven: 4 }, { hasData: true, breakeven: 5 }])).toBeNull();
    expect(commonBreakeven([{ hasData: true, breakeven: 4 }, { hasData: true, breakeven: null }])).toBeNull();
  });

  it("a product with no numbers in the window does not count; no product at all is no line", () => {
    expect(commonBreakeven([{ hasData: true, breakeven: 4 }, { hasData: false, breakeven: null }])).toBe(4);
    expect(commonBreakeven([])).toBeNull();
  });
});
