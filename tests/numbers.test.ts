import { describe, expect, it } from "vitest";
import { GLOSSARY } from "@/lib/glossary";
import { GROUPS, SET_KEYS, STATS, computeSet, costTone, coverUrgency, emptyRaw, scaleFlows, sumRaw, summaryText, topReasons, totalSet, type Ctx, type Raw } from "@/core/numbers";

/** One product's day, the numbers small enough to check by hand. */
const raw = (x: Partial<Raw> = {}): Raw => ({
  ...emptyRaw(),
  metaSpend: 100, impressions: 20_000, linkClicks: 400, pixelPurchases: 52,
  ordersIn: 48, uniqueCustomers: 44, confirmed: 30, rejected: 6, cancelled: 2, waiting: 10,
  shippedOrders: 25, shippedPieces: 41, delivered: 9, returned: 3, outForDelivery: 12, stuck: 2, revenueShipped: 610,
  aovRevenue: 1176, aovOrders: 48, stockUnits: 380,
  offers: [{ offer: "قطعة", orders: 30, pieces: 1 }, { offer: "2+هدية", orders: 18, pieces: 3, revenue: 400 }],
  rejectReasons: [{ reason: "رقم غلط", count: 4 }, { reason: "غيّر رأيه", count: 2 }],
  ...x,
});
const ctx = (x: Partial<Ctx> = {}): Ctx => ({ fx: 0.01, deliveryRate: 0.8, econ: { unitCost: 2.2, deliveryFee: 2.5, returnFee: 1 }, piecesPerDay: 20, ...x });

describe("«الأرقام» — every figure from the raw counts (v4.1)", () => {
  const s = computeSet(raw(), ctx());

  it("ads: the spend is Meta's plus the card's 1%; CPM and CTR are Meta's own (no fee)", () => {
    expect(s.spend).toBe(101);
    expect(s.pixelPurchases).toBe(52);
    expect(s.costPerPixel).toBe(1.94); // 101 ÷ 52
    expect(s.cpm).toBe(5); // 100 × 1000 ÷ 20000
    expect(s.ctr).toBe(2); // 400 × 100 ÷ 20000
  });

  it("site orders: customers, the duplicates removed, and the pixel-vs-real gap", () => {
    expect([s.ordersIn, s.uniqueCustomers, s.duplicates]).toEqual([48, 44, 4]);
    expect(s.gapPct).toBe(8.3); // (52 − 48) ÷ 48
    expect(computeSet(raw({ pixelPurchases: 40 }), ctx()).gapPct).toBe(-16.7); // the pixel saw fewer than the OMS
  });

  it("real cost: spend over orders, over confirmed, over delivered", () => {
    expect(s.costPerOrder).toBe(2.1); // 101 ÷ 48
    expect(s.costPerConfirmed).toBe(3.37); // 101 ÷ 30
    expect(s.costPerDelivered).toBe(11.22); // 101 ÷ 9
  });

  it("confirmation: the rate is confirmed over (confirmed + rejected) — a cancelled order is not in it", () => {
    expect([s.confirmed, s.rejected, s.cancelled, s.waiting]).toEqual([30, 6, 2, 10]);
    expect(s.confirmRate).toBe(83.3); // 30 ÷ 36
    expect(computeSet(raw({ cancelled: 20 }), ctx()).confirmRate).toBe(83.3);
  });

  it("offers: the upsell rate is the orders with two pieces or more over the orders whose pieces are known; the average order value", () => {
    expect(s.upsellRate).toBe(37.5); // 18 ÷ 48
    expect(s.aov).toBe(24.5); // 1176 ÷ 48
    expect(computeSet(raw({ offers: [{ offer: "قطعة", orders: 30 }] }), ctx()).upsellRate).toBeNull();
  });

  it("shipping: what was shipped today and where it stands now", () => {
    expect([s.shippedOrders, s.shippedPieces, s.outForDelivery, s.delivered, s.returned, s.stuck]).toEqual([25, 41, 12, 9, 3, 2]);
  });

  it("money: expected revenue = the shipped amount × the delivery rate — reproducible by hand", () => {
    expect(s.deliveryRate30).toBe(80);
    expect(s.expectedRevenue).toBe(488); // 610 × 0.8
    expect(s.expectedShipping).toBe(67.5); // 25 × 2.5 + 25 × 0.2 × 1
    // 488 − (41 × 0.8 × 2.2 = 72.16) − 67.5 − 101
    expect(s.expectedProfit).toBe(247.34);
  });

  it("stock: units over the pieces shipped a day", () => {
    expect([s.stockUnits, s.stockCover]).toEqual([380, 19]);
  });

  it("never invents: a missing input or a zero denominator is null, not 0", () => {
    const none = computeSet(emptyRaw(), ctx({ deliveryRate: null, piecesPerDay: null }));
    expect(Object.values(none).every((v) => v === null)).toBe(true);
    const z = computeSet(raw({ impressions: 0, ordersIn: 0, confirmed: 0, delivered: 0, pixelPurchases: 0, rejected: 0 }), ctx());
    expect([z.cpm, z.ctr, z.costPerOrder, z.costPerConfirmed, z.costPerDelivered, z.costPerPixel, z.gapPct, z.confirmRate]).toEqual([null, null, null, null, null, null, null, null]);
  });

  it("cannot say what the shipments are worth without a delivery rate — unless a number was pushed, and then it says so only then", () => {
    const noRate = computeSet(raw(), ctx({ deliveryRate: null }));
    expect(noRate.expectedRevenue).toBeNull();
    expect(noRate.expectedProfit).toBeNull();
    expect(computeSet(raw({ expectedRevenuePushed: 500 }), ctx({ deliveryRate: null })).expectedRevenue).toBe(500);
  });

  it("cannot cost the shipping without the product's numbers", () => {
    const s2 = computeSet(raw(), ctx({ econ: null }));
    expect(s2.expectedRevenue).toBe(488);
    expect([s2.expectedShipping, s2.expectedProfit]).toEqual([null, null]);
  });

  it("has an entry in the table for every number, and a formula in the glossary for every entry", () => {
    expect(STATS.map((x) => x.key).sort()).toEqual([...SET_KEYS].sort());
    for (const st of STATS) expect(Object.keys(GLOSSARY), `${st.key} → ${st.term}`).toContain(st.term);
    expect(new Set(STATS.map((x) => x.group))).toEqual(new Set(GROUPS.map((g) => g.key)));
  });

  it("prints no tax field anywhere", () => {
    expect(SET_KEYS.join(" ").toLowerCase()).not.toMatch(/tax|vat|ضريبة/);
    expect(STATS.map((x) => x.label).join(" ")).not.toMatch(/ضريبة/);
  });
});

describe("the totals (a ratio is never an average of ratios)", () => {
  const a = { raw: raw(), set: computeSet(raw(), ctx()), piecesPerDay: 20 };
  const bRaw = raw({ metaSpend: 50, ordersIn: 12, uniqueCustomers: 12, confirmed: 6, rejected: 6, pixelPurchases: 14, revenueShipped: 100, shippedOrders: 5, shippedPieces: 5, delivered: 2, stockUnits: 120, impressions: 10_000, linkClicks: 100 });
  const bCtx = ctx({ deliveryRate: 0.5, piecesPerDay: 10 });
  const b = { raw: bRaw, set: computeSet(bRaw, bCtx), piecesPerDay: 10 };
  const t = totalSet([a, b], 0.01);

  it("sums the counts and recomputes every ratio from the sums", () => {
    expect([t.ordersIn, t.confirmed, t.rejected]).toEqual([60, 36, 12]);
    expect(t.spend).toBe(151.5); // (100 + 50) × 1.01
    expect(t.costPerOrder).toBe(2.53); // 151.5 ÷ 60
    expect(t.confirmRate).toBe(75); // 36 ÷ 48
    expect(t.cpm).toBe(5); // 150 × 1000 ÷ 30000
    expect(t.ctr).toBe(1.67); // 500 × 100 ÷ 30000
  });

  it("adds the money of each product — each has its own delivery rate and unit cost", () => {
    expect(t.expectedRevenue).toBe(a.set.expectedRevenue! + b.set.expectedRevenue!);
    expect(t.expectedRevenue).toBe(538); // 488 + 50
    expect(t.expectedProfit).toBe(r2(a.set.expectedProfit! + b.set.expectedProfit!));
  });

  it("covers the stock of everything together: all the units over all the pieces a day", () => {
    expect(t.stockUnits).toBe(500);
    expect(t.stockCover).toBe(16.7); // 500 ÷ 30
  });
});

const r2 = (n: number) => Math.round(n * 100) / 100;

describe("windows", () => {
  it("sums flows and states, and merges the offers and the reasons by name", () => {
    const s = sumRaw([raw(), raw({ offers: [{ offer: "قطعة", orders: 5, pieces: 1 }], rejectReasons: [{ reason: "رقم غلط", count: 1 }] })]);
    expect(s.ordersIn).toBe(96);
    expect(s.offers.find((o) => o.offer === "قطعة")?.orders).toBe(35);
    expect(s.rejectReasons[0]).toEqual({ reason: "رقم غلط", count: 5 });
  });

  it("scales the flows to another length and leaves the states alone — the 7-day average of a one-day window", () => {
    const seven = scaleFlows(raw({ metaSpend: 700, ordersIn: 350 }), 1 / 7);
    expect(seven.metaSpend).toBe(100);
    expect(seven.ordersIn).toBe(50);
    expect(seven.stockUnits).toBe(380);
    expect(seven.waiting).toBe(10);
  });

  it("keeps the top reasons", () => {
    expect(topReasons([{ reason: "أ", count: 1 }, { reason: "ب", count: 5 }, { reason: "أ", count: 2 }, { reason: "ج", count: 4 }], 2)).toEqual([{ reason: "ب", count: 5 }, { reason: "ج", count: 4 }]);
  });
});

describe("colours against the owner's rules", () => {
  it("is green up to the target, amber up to the break-even, red above it", () => {
    expect(costTone(2.9, 3, 5.7)).toBe("ok");
    expect(costTone(3, 3, 5.7)).toBe("ok");
    expect(costTone(4.5, 3, 5.7)).toBe("warn");
    expect(costTone(5.7, 3, 5.7)).toBe("warn");
    expect(costTone(6.05, 3, 5.7)).toBe("danger");
  });
  it("has no colour when there is no cost, or when the rules are not typed", () => {
    expect(costTone(null, 3, 5.7)).toBeUndefined();
    expect(costTone(4, null, null)).toBeUndefined();
  });
  it("uses the rules that exist: only a break-even, or only a target", () => {
    expect(costTone(7, null, 5.7)).toBe("danger");
    expect(costTone(2, null, 5.7)).toBe("warn");
    expect(costTone(4, 3, null)).toBe("warn");
  });
  it("shows the stock's urgency: 🔴 < 7 · 🟠 7–10 · 🟡 10–14", () => {
    const t = { redDays: 7, orangeDays: 10, yellowDays: 14 };
    expect([coverUrgency(5, t), coverUrgency(8, t), coverUrgency(12, t), coverUrgency(30, t), coverUrgency(null, t)]).toEqual(["red", "orange", "yellow", null, null]);
  });
});

describe("the Telegram summary", () => {
  it("says the day in lines — totals first — with a dash for what is not known", () => {
    const set = computeSet(raw(), ctx());
    const text = summaryText("اليوم (2026-11-14)", set, [{ name: "كمأة", set }, { name: "بلا بيانات", set: computeSet(emptyRaw(), ctx()) }]);
    const lines = text.split("\n");
    expect(lines[0]).toBe("📊 أرقام اليوم (2026-11-14)");
    expect(lines[1]).toContain("المجموع: صرف 101.00$");
    expect(lines[1]).toContain("طلبات 48");
    expect(lines[1]).toContain("(83%)");
    expect(lines.some((l) => l.startsWith("كمأة:"))).toBe(true);
    expect(text).not.toContain("بلا بيانات");
    expect(text.length).toBeLessThan(4000);
  });
});

describe("printing a number", () => {
  const def = (unit: "$" | "%" | "" | "يوم") => ({ unit });
  it("prints a dash for what is not known, money with two decimals, a rate with one, a count whole", async () => {
    const { formatStat } = await import("@/core/numbers");
    expect([formatStat(def("$"), null), formatStat(def("$"), 2.1), formatStat(def("%"), 83.33), formatStat(def(""), 47.6), formatStat(def("يوم"), 19)]).toEqual(["—", "2.10$", "83.3%", "48", "19.0 يوم"]);
  });
});
