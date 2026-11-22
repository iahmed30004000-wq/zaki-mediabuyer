/**
 * «وين كنا وكيف صرنا» read from the tables (v6 · P5): the window is the last seven COMPLETE days (ending yesterday) against the seven before; the facts the numbers stand on are read once and
 * hand the tiles their reasons; when nothing is there the readiness card stands in for four dashes. `loadNumbers` is the real numbers screen's reader — here it is a stand-in that hands back
 * sets, so what is held is the window, the one-call-two-windows rule and what is made of the facts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  numbers: vi.fn(),
  token: true,
  oms: true,
  rows: { insight: null as unknown, pushed: null as unknown, oms: [] as unknown[], drive: null as unknown, stock: null as unknown },
}));
vi.mock("@/lib/numbers-view", () => ({ loadNumbers: h.numbers }));
vi.mock("@/jobs/meta-sync", () => ({ metaToken: async () => (h.token ? "t" : null) }));
vi.mock("@/server/env", () => ({ omsLinked: () => h.oms }));
vi.mock("@/server/db", () => ({
  db: {
    insightDaily: { findFirst: vi.fn(async () => h.rows.insight) },
    productDay: { findFirst: vi.fn(async () => h.rows.pushed) },
    jobRun: { findMany: vi.fn(async () => h.rows.oms), findFirst: vi.fn(async () => h.rows.drive) },
    stockSnapshot: { findFirst: vi.fn(async () => h.rows.stock) },
  },
}));

import { SET_KEYS, type NumbersSet } from "@/core/numbers";
import { homeRange, loadCompare } from "@/lib/compare-view";
import { loadSourceFacts, productGaps } from "@/lib/source-facts";

const NOW = new Date("2026-11-22T09:00:00.000Z"); // Sunday 12:00 Amman
const set = (over: Partial<NumbersSet> = {}): NumbersSet => ({ ...Object.fromEntries(SET_KEYS.map((k) => [k, null])), ...over }) as NumbersSet;
const answer = (cur: NumbersSet, prev: NumbersSet, products: unknown[] = []) => ({ demo: false, totals: { current: cur, prev, avg7: prev }, products });

beforeEach(() => {
  h.numbers.mockReset();
  h.token = true;
  h.oms = true;
  h.rows = { insight: { id: "i" }, pushed: null, oms: [{ status: "ok", startedAt: new Date("2026-11-22T08:00:00.000Z"), finishedAt: new Date("2026-11-22T08:01:00.000Z"), stats: { orders: 40 } }], drive: null, stock: { id: "s" } };
});

describe("the window", () => {
  it("seven days ending YESTERDAY — an unfinished day never takes part in a comparison", () => {
    const r = homeRange(NOW);
    expect(r).toMatchObject({ from: "2026-11-15", to: "2026-11-21", days: 7 });
  });

  it("one read of the numbers gives both windows: the same range is asked once, and the window before it comes from the answer", async () => {
    h.numbers.mockResolvedValue(answer(set({ ordersIn: 70, spend: 700, costPerOrder: 10, confirmRate: 50 }), set({ ordersIn: 35, spend: 350, costPerOrder: 10, confirmRate: 40 })));
    const c = await loadCompare({ now: NOW });
    expect(h.numbers).toHaveBeenCalledTimes(1);
    expect(h.numbers.mock.calls[0]![0]).toEqual({ d: "custom", from: "2026-11-15", to: "2026-11-21" });
    expect(c.prev).toEqual({ from: "2026-11-08", to: "2026-11-14" });
    expect(c.range.days).toBe(7);
  });
});

describe("the tiles", () => {
  it("four, with the day's averages for the orders and the spend, and the words of the difference", async () => {
    h.numbers.mockResolvedValue(answer(set({ ordersIn: 70, spend: 2814, costPerOrder: 2.96, confirmRate: 57 }), set({ ordersIn: 56, spend: 3017, costPerOrder: 3.42, confirmRate: 50 })));
    const c = await loadCompare({ now: NOW });
    expect(c.tiles.map((t) => [t.key, t.now, t.was, t.words])).toEqual([
      ["realCost", 2.96, 3.42, "أرخص 13%"],
      ["orders", 10, 8, "أكتر 25%"],
      ["confirmRate", 57, 50, "أحسن 7 نقاط"],
      ["spend", 402, 431, "نزل 7%"],
    ]);
    expect(c.allMissing).toBe(false);
    expect(c.tiles.find((t) => t.key === "confirmRate")!.provisional).toBe(true);
  });

  it("nothing in: all four missing, each with its reason — and the readiness card is what the home draws", async () => {
    h.token = false;
    h.oms = false;
    h.rows = { insight: null, pushed: null, oms: [], drive: null, stock: null };
    h.numbers.mockResolvedValue(answer(set(), set()));
    const c = await loadCompare({ now: NOW });
    expect(c.allMissing).toBe(true);
    expect(c.tiles.map((t) => t.missing)).toEqual(["ميتا مش مربوطة", "نظام الطلبات مش مربوط", "نظام الطلبات مش مربوط", "ميتا مش مربوطة"]);
    expect(c.readiness.filter((r) => !r.ok).map((r) => r.key)).toEqual(["spend", "orders", "stock"]);
  });

  it("only some missing: the tiles that have a number show it, the others say why — the card is not drawn", async () => {
    h.numbers.mockResolvedValue(answer(set({ ordersIn: 70 }), set({ ordersIn: 70 })));
    const c = await loadCompare({ now: NOW });
    expect(c.allMissing).toBe(false);
    expect(c.tiles.find((t) => t.key === "orders")!.now).toBe(10);
    expect(c.tiles.find((t) => t.key === "spend")!.missing).toBe("ما في صرف مسجّل للفترة");
  });
});

describe("loadSourceFacts — read once, nothing made up", () => {
  it("reads Meta's token, yesterday's spend (Meta's rows or what Claude pushed), the last REAL OMS pull, the folders with no product and the stock", async () => {
    h.rows.insight = null;
    h.rows.pushed = { id: "p" };
    h.rows.drive = { stats: { unmappedFolders: ["a", "b", "c"] } };
    // a slot that was skipped (no `orders` in its stats) is not a pull
    h.rows.oms = [
      { status: "ok", startedAt: new Date("2026-11-22T08:30:00.000Z"), finishedAt: null, stats: { skipped: true } },
      { status: "ok", startedAt: new Date("2026-11-22T06:00:00.000Z"), finishedAt: new Date("2026-11-22T06:02:00.000Z"), stats: { orders: 12 } },
    ];
    const f = await loadSourceFacts({ now: NOW, products: [{ code: "A", name: "ماء", hasData: true, breakeven: null }, { code: "B", name: "KAMAA", hasData: true, breakeven: 4 }, { code: "C", name: "C", hasData: false, breakeven: null }] });
    expect(f).toEqual({
      now: NOW.toISOString(),
      metaLinked: true,
      spendYesterday: true,
      omsLinked: true,
      omsLastPullAt: "2026-11-22T06:02:00.000Z",
      productsWithoutBreakeven: 1,
      unmappedFolders: 3,
      productsWithoutName: 1,
      stockFresh: true,
    });
  });

  it("a fresh site: nothing is linked, nothing pulled, nothing pushed — each fact says so", async () => {
    h.token = false;
    h.oms = false;
    h.rows = { insight: null, pushed: null, oms: [], drive: null, stock: null };
    const f = await loadSourceFacts({ now: NOW });
    expect(f).toMatchObject({ metaLinked: false, spendYesterday: false, omsLinked: false, omsLastPullAt: null, unmappedFolders: 0, stockFresh: false, productsWithoutBreakeven: 0 });
  });

  it("the products' gaps count only the ones that have numbers in the window; a Latin name is a name with no Arabic", () => {
    expect(productGaps([{ code: "A", name: "ماء الكمأة", hasData: true, breakeven: 4 }, { code: "B", name: "B", hasData: true, breakeven: null }, { code: "C", name: "C", hasData: false, breakeven: null }])).toEqual({ withoutBreakeven: 1, withoutName: 1 });
  });
});
