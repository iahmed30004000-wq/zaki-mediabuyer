import { describe, expect, it } from "vitest";
import { computeSet, emptyRaw, type Ctx, type Raw } from "@/core/numbers";

/** R-20 — «نسبة التأكيد 100%» when the numbers come from the OMS pull and the rejected count is empty. An unknown rejected count means an unknown rate. */
const raw = (x: Partial<Raw> = {}): Raw => ({ ...emptyRaw(), metaSpend: 100, ordersIn: 48, confirmed: 30, rejected: 6, cancelled: 2, waiting: 10, ...x });
const ctx: Ctx = { fx: 0.01, deliveryRate: 0.8, econ: { unitCost: 2.2, deliveryFee: 2.5, returnFee: 1 }, piecesPerDay: 20 };

describe("the confirmation rate", () => {
  it("is confirmed ÷ (confirmed + rejected) when both are known", () => {
    expect(computeSet(raw(), ctx).confirmRate).toBe(83.3); // 30 ÷ 36
  });

  it("is NOT 100% when the rejected count is unknown — it is null (shown «—»)", () => {
    expect(computeSet(raw({ rejected: null }), ctx).confirmRate).toBeNull();
  });

  it("is null when nothing is known, and when only the rejected count is", () => {
    expect(computeSet(raw({ confirmed: null, rejected: null }), ctx).confirmRate).toBeNull();
    expect(computeSet(raw({ confirmed: null, rejected: 6 }), ctx).confirmRate).toBeNull();
  });

  it("a known zero rejected is a real 100%", () => {
    expect(computeSet(raw({ rejected: 0 }), ctx).confirmRate).toBe(100);
  });
});
