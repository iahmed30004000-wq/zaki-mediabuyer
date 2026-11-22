/**
 * THE LINE, DAY BY DAY (v6 · P6, docs/rebuild-v6/04-numbers.md §4): `seriesOf` is pure — a day with no number is a gap, never a zero, and the cost of a confirmed order of a day that has not matured is not drawn;
 * `comparePeriod` always ends yesterday; `loadSeriesMany` reads the tables ONCE for the whole stretch (it is never 30 queries) and computes each day with the same `computeSet` the tiles use.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  db: {
    productDay: { findMany: vi.fn() },
    insightDaily: { groupBy: vi.fn() },
    attributedOrder: { findMany: vi.fn() },
    productEconomics: { findMany: vi.fn() },
    campaign: { findMany: vi.fn() },
    adSet: { findMany: vi.fn() },
    ad: { findMany: vi.fn() },
    stockSnapshot: { findMany: vi.fn() },
    productAlias: { findMany: vi.fn() },
  },
}));
vi.mock("@/server/db", () => ({ db: h.db }));
vi.mock("@/server/settings", () => ({ getSetting: async (k: string) => (k === "economics.fx_fee" ? "0.01" : { targetCost: 3, breakeven: {} }) }));
vi.mock("@/server/redact", () => ({ forViewer: async <T>(v: T) => v }));

import { MAX_PERIOD_DAYS, comparePeriod, seriesOf, seriesValue } from "@/core/compare";
import { SET_KEYS, type NumbersSet } from "@/core/numbers";
import { SERIES_DAYS, loadSeries, loadSeriesMany } from "@/lib/numbers-view";

const NOW = new Date("2026-11-22T09:00:00.000Z"); // Sunday 12:00 Amman → yesterday is 2026-11-21
const set = (over: Partial<NumbersSet> = {}): NumbersSet => ({ ...Object.fromEntries(SET_KEYS.map((k) => [k, null])), ...over }) as NumbersSet;

describe("seriesOf / seriesValue — pure", () => {
  it("days values, the oldest first, the last one is `toDay`; a day with no numbers is null (a gap), never 0", () => {
    const by: Record<string, NumbersSet> = { "2026-11-19": set({ costPerOrder: 3.1 }), "2026-11-21": set({ costPerOrder: 2.9 }) };
    expect(seriesOf("realCost", "2026-11-21", 4, (d) => by[d] ?? null, NOW)).toEqual([null, 3.1, null, 2.9]);
  });

  it("the orders and the spend of ONE day are the day's own figure (a window of a day), the rest as they are", () => {
    const s = set({ ordersIn: 46, spend: 402.5, confirmRate: 57, costPerOrder: 2.96 });
    expect(seriesValue("orders", "2026-11-20", s, NOW)).toBe(46);
    expect(seriesValue("spend", "2026-11-20", s, NOW)).toBe(402.5);
    expect(seriesValue("confirmRate", "2026-11-20", s, NOW)).toBe(57);
  });

  it("the cost of a confirmed order of a day that has not matured is not drawn (R-15): a day matures a day after it ends — on Sunday noon yesterday (the 21st) has not, the 20th has", () => {
    const s = set({ costPerConfirmed: 4.4 });
    expect(seriesValue("costPerConfirmed", "2026-11-21", s, NOW)).toBeNull();
    expect(seriesValue("costPerConfirmed", "2026-11-20", s, NOW)).toBe(4.4);
    expect(seriesValue("costPerConfirmed", "2026-11-19", s, NOW)).toBe(4.4);
    // the other metrics of the same day are drawn: only the rate that can still move is held back
    expect(seriesValue("realCost", "2026-11-21", set({ costPerOrder: 3 }), NOW)).toBe(3);
  });

  it("no set at all is null", () => {
    expect(seriesValue("realCost", "2026-11-20", null, NOW)).toBeNull();
  });
});

describe("comparePeriod — it ends yesterday, always", () => {
  it("the four choices: yesterday, 7 days (the default and the answer to anything unreadable), 30 days, a range", () => {
    expect(comparePeriod({ p: "1" }, NOW)).toMatchObject({ period: "1", from: "2026-11-21", to: "2026-11-21", days: 1 });
    expect(comparePeriod({}, NOW)).toMatchObject({ period: "7", from: "2026-11-15", to: "2026-11-21", days: 7 });
    expect(comparePeriod({ p: "garbage" }, NOW)).toMatchObject({ period: "7", days: 7 });
    expect(comparePeriod({ p: "30" }, NOW)).toMatchObject({ period: "30", from: "2026-10-23", to: "2026-11-21", days: 30 });
    expect(comparePeriod({ p: "custom", from: "2026-11-01", to: "2026-11-10" }, NOW)).toMatchObject({ period: "custom", from: "2026-11-01", to: "2026-11-10", days: 10 });
  });

  it("a range that reaches today or later is cut at yesterday; a range written backwards is put in order; a range with no real dates is the last seven days", () => {
    expect(comparePeriod({ p: "custom", from: "2026-11-18", to: "2026-12-30" }, NOW)).toMatchObject({ from: "2026-11-18", to: "2026-11-21", days: 4 });
    expect(comparePeriod({ p: "custom", from: "2026-11-10", to: "2026-11-01" }, NOW)).toMatchObject({ from: "2026-11-01", to: "2026-11-10" });
    expect(comparePeriod({ p: "custom", from: "2026-12-05", to: "2026-12-30" }, NOW)).toMatchObject({ from: "2026-11-21", to: "2026-11-21", days: 1 });
    expect(comparePeriod({ p: "custom", from: "2026-13-40", to: "x" }, NOW)).toMatchObject({ period: "7" });
  });

  it("a very long range is capped (the window before it must fit the data), keeping its last day", () => {
    const r = comparePeriod({ p: "custom", from: "2026-01-01", to: "2026-11-15" }, NOW);
    expect(r.days).toBe(MAX_PERIOD_DAYS);
    expect(r.to).toBe("2026-11-15");
  });
});

describe("loadSeriesMany — one read for the whole stretch", () => {
  beforeEach(() => {
    delete process.env.MOCK_MODE;
    for (const t of Object.values(h.db)) for (const fn of Object.values(t)) (fn as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue([]);
    h.db.productEconomics.findMany.mockResolvedValue([{ productCode: "TRF01", name: "ماء الكمأة" }, { productCode: "TIN01", name: "TIN" }]);
    h.db.productAlias.findMany.mockResolvedValue([{ productCode: "TIN01", alias: "قطرة الطنين" }]);
    // the pushed rows: Claude's numbers for two products on three days
    const empty = { spend: null, impressions: null, linkClicks: null, pixelPurchases: null, ordersIn: null, uniqueCustomers: null, confirmed: null, rejected: null, cancelled: null, waiting: null, rejectReasons: null, offerBreakdown: null, aov: null, shippedOrders: null, shippedPieces: null, outForDelivery: null, stuck: null, delivered: null, returned: null, revenueShipped: null, expectedRevenue: null, stockUnits: null };
    const row = (productCode: string, d: string, over: Record<string, unknown>) => ({ ...empty, productCode, date: new Date(`${d}T00:00:00Z`), ...over });
    h.db.productDay.findMany.mockResolvedValue([
      row("TRF01", "2026-11-19", { spend: 100, ordersIn: 40, confirmed: 20, rejected: 10 }),
      row("TRF01", "2026-11-20", { spend: 90, ordersIn: 45, confirmed: 27, rejected: 9 }),
      row("TIN01", "2026-11-20", { spend: 10, ordersIn: 5, confirmed: 3, rejected: 1 }),
    ]);
  });

  it("asks every table ONCE for 30 days — never one query per day", async () => {
    await loadSeriesMany(["realCost", "orders", "confirmRate", "spend"], { now: NOW });
    expect(h.db.productDay.findMany).toHaveBeenCalledTimes(1);
    expect(h.db.insightDaily.groupBy).toHaveBeenCalledTimes(1);
    expect(h.db.attributedOrder.findMany).toHaveBeenCalledTimes(1);
    expect(h.db.productEconomics.findMany).toHaveBeenCalledTimes(1);
    expect(h.db.stockSnapshot.findMany).toHaveBeenCalledTimes(1);
    // the stretch: 30 days ending yesterday, and the 29 before the first for its delivery rate
    const gte = (h.db.productDay.findMany.mock.calls[0]![0] as { where: { date: { gte: Date; lte: Date } } }).where.date;
    expect(gte.gte.toISOString().slice(0, 10)).toBe("2026-09-24");
    expect(gte.lte.toISOString().slice(0, 10)).toBe("2026-11-21");
  });

  it("30 values per metric, the oldest first, ending yesterday; a day nobody pushed for is a gap; the figures are the day's own (computed by the code from the sums)", async () => {
    const s = await loadSeriesMany(["orders", "spend", "confirmRate", "realCost"], { now: NOW });
    expect(SERIES_DAYS).toBe(30);
    for (const k of ["orders", "spend", "confirmRate", "realCost"] as const) expect(s[k]).toHaveLength(30);
    // index 29 is yesterday (the 21st): nothing was pushed → null; index 28 is the 20th, 27 the 19th
    expect(s.orders[29]).toBeNull();
    expect(s.orders[28]).toBe(50); // 45 + 5
    expect(s.orders[27]).toBe(40);
    expect(s.orders[0]).toBeNull();
    expect(s.spend[28]).toBe(101); // (90 + 10) × 1.01 with the card's fee
    // cost per order of the 20th: (90+10)*1.01 / 50
    expect(s.realCost[28]).toBe(2.02);
    // confirmRate of the 20th: confirmed 30 over confirmed + rejected 40
    expect(s.confirmRate[28]).toBe(75);
  });

  it("one product alone: the line of that product, not of the total", async () => {
    const line = await loadSeries("orders", 30, "TIN01", NOW);
    expect(line[28]).toBe(5);
    expect(line[27]).toBeNull();
    expect(h.db.productDay.findMany).toHaveBeenCalledTimes(1);
  });

  it("the demo draws a line without touching a table", async () => {
    process.env.MOCK_MODE = "1";
    const s = await loadSeriesMany(["realCost"], { now: NOW });
    expect(s.realCost).toHaveLength(30);
    expect(s.realCost.some((v) => v !== null)).toBe(true);
    expect(h.db.productDay.findMany).not.toHaveBeenCalled();
    delete process.env.MOCK_MODE;
  });
});
