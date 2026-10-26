import { describe, expect, it } from "vitest";
import { computeTruth, estimateTargets, pct1, round2 } from "@/core/economics";

/** Spec 17.1 — «مثال الحقيقة»: must come out to the cent. */
describe("the truth example (spec 17.1)", () => {
  // one ad: spend 120 · 80 conversations · 30 orders · 22 confirmed · 21 shipments · 16 delivered · 5 returned
  // price 20 · delivery 2.5 · unit cost 2.20 · fx 1% · overhead 0.97
  const t = computeTruth({
    spend: 120,
    fxFee: "0.01",
    conversations: 80,
    orders: 30,
    confirmed: 22,
    shipments: 21,
    delivered: 16,
    returned: 5,
    collected: 16 * 20,
    deliveryFees: "52.5",
    returnFees: 0,
    cogsDelivered: "35.2",
    overheadFactor: "0.97",
  });

  it.each([
    ["spend with fee", t.spendWithFee, 121.2],
    ["cost per conversation", t.costPerConversation, 1.52],
    ["cost per confirmed", t.costPerConfirmed, 5.51],
    ["net collected", t.netCollected, 267.5],
    ["loss limit per shipment", t.lossLimit, 11.06],
    ["scaling ceiling", t.scalingCeiling, 6.64],
    ["profit after costs", t.profitAfterCosts, 107.77],
    ["profit per delivered", t.profitPerDelivered, 6.74],
    ["cost per delivered", t.costPerDelivered, 7.58],
    ["true ROAS", t.trueRoas, 2.21],
  ])("%s", (_label, value, expected) => {
    expect(round2(value)).toBe(expected);
  });

  it.each([
    ["conversation to order", t.conversationToOrder, 37.5],
    ["confirm rate", t.confirmRate, 73.3],
    ["delivery rate", t.deliveryRate, 76.2],
    ["return rate", t.returnRate, 23.8],
  ])("%s %%", (_label, value, expected) => {
    expect(pct1(value)).toBe(expected);
  });

  it("verdict: 5.51 < 6.64 — eligible for the scaling ladder", () => {
    expect(t.costPerConfirmed!.lt(t.scalingCeiling!)).toBe(true);
  });

  it("a zero denominator is «not enough», never 0 or Infinity", () => {
    const empty = computeTruth({ spend: 10, fxFee: 0, orders: 0, confirmed: 0, shipments: 0, delivered: 0, returned: 0, collected: 0, deliveryFees: 0, returnFees: 0, cogsDelivered: 0, overheadFactor: "0.97" });
    expect(empty.costPerOrder).toBeNull();
    expect(empty.lossLimit).toBeNull();
    expect(empty.scalingCeiling).toBeNull();
    expect(round2(empty.profitAfterCosts)).toBe(-10); // a loss is not shaved by the overhead factor
  });
});

/** Spec 17.2 — the estimate before 50 shipments. */
describe("the estimate (spec 17.2)", () => {
  const e = estimateTargets({ price: 17, unitCost: "2.5", shipping: 3, returnFee: 2, codFee: "0.04", confirmCost: "0.3", confirmRate: "0.65", deliveryRate: "0.75", profitMinShare: "0.30" });

  it("M = 4.16 · T_order = 2.50 · T_confirmed = 3.84 · T_delivered = 5.12", () => {
    expect(round2(e.margin)).toBe(4.16);
    expect(round2(e.tOrder)).toBe(2.5);
    expect(round2(e.tConfirmed)).toBe(3.84);
    expect(round2(e.tDelivered)).toBe(5.12);
    expect(e.losing).toBe(false);
  });

  it("a product that loses at its prices raises the flag", () => {
    expect(estimateTargets({ price: 5, unitCost: 3, shipping: 3, returnFee: 2, codFee: "0.04", confirmCost: "0.3", confirmRate: "0.65", deliveryRate: "0.75", profitMinShare: "0.3" }).losing).toBe(true);
  });
});

/** Spec 17.4 «3 أمثلة يدوية» — worked by hand on paper first, then checked here to the cent. */
describe("three hand-worked examples (spec 17.4)", () => {
  it("A · a small profit, but the cost per confirmed is above the ceiling: no ladder", () => {
    // 50 × 1.01 = 50.50 · net 88 − 18 − 4 = 66 · margin 66 − 12.4 = 53.6 · limit 53.6 ÷ 6 = 8.93 · ceiling × 0.6 = 5.36
    // profit (53.6 − 50.5) × 0.97 = 3.007 · per confirmed 50.5 ÷ 6 = 8.42 · confirm 6 ÷ 8 mature = 75%
    const t = computeTruth({ spend: 50, fxFee: "0.01", orders: 10, confirmed: 6, matureOrders: 8, shipments: 6, delivered: 4, returned: 2, collected: 88, deliveryFees: 18, returnFees: 4, cogsDelivered: "12.4", overheadFactor: "0.97" });
    expect([t.spendWithFee, t.netCollected, t.lossLimit, t.scalingCeiling, t.profitAfterCosts, t.costPerConfirmed, t.trueRoas, t.profitPerDelivered].map(round2)).toEqual([50.5, 66, 8.93, 5.36, 3.01, 8.42, 1.31, 0.75]);
    expect(pct1(t.confirmRate)).toBe(75);
    expect(t.costPerConfirmed!.gt(t.scalingCeiling!)).toBe(true);
  });
  it("B · a loss: shown whole, never shaved by the overhead factor", () => {
    // 200 × 1.01 = 202 · net 170 − 54 − 16 = 100 · margin 75 · limit 75 ÷ 18 = 4.17 · ceiling 2.50 · profit 75 − 202 = −127
    const t = computeTruth({ spend: 200, fxFee: "0.01", orders: 40, confirmed: 20, shipments: 18, delivered: 10, returned: 8, collected: 170, deliveryFees: 54, returnFees: 16, cogsDelivered: 25, overheadFactor: "0.97" });
    expect([t.spendWithFee, t.netCollected, t.lossLimit, t.scalingCeiling, t.profitAfterCosts, t.costPerConfirmed, t.trueRoas, t.profitPerDelivered].map(round2)).toEqual([202, 100, 4.17, 2.5, -127, 10.1, 0.5, -12.7]);
    expect(pct1(t.returnRate)).toBe(44.4);
  });
  it("C · collected below the price (a discount at the door), no card fee", () => {
    // 80 · net 228 − 35 = 193 · margin 193 − 26.4 = 166.6 · limit 166.6 ÷ 14 = 11.90 · ceiling 7.14 · profit 86.6 × 0.97 = 84.00
    const t = computeTruth({ spend: 80, fxFee: 0, orders: 20, confirmed: 15, shipments: 14, delivered: 12, returned: 2, collected: 228, deliveryFees: 35, returnFees: 0, cogsDelivered: "26.4", overheadFactor: "0.97" });
    expect([t.netCollected, t.lossLimit, t.scalingCeiling, t.profitAfterCosts, t.costPerConfirmed, t.profitPerDelivered, t.trueRoas].map(round2)).toEqual([193, 11.9, 7.14, 84, 5.33, 7, 2.41]);
    expect(pct1(t.deliveryRate)).toBe(85.7);
  });
});
