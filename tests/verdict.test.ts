import { describe, expect, it } from "vitest";
import { productVerdict } from "@/core/verdict";

describe("the verdict of a product", () => {
  it("no cost yet is «no data», whatever the rules say", () => {
    expect(productVerdict(null, 3, 5).key).toBe("nodata");
    expect(productVerdict(undefined, null, null).key).toBe("nodata");
    expect(productVerdict(Number.NaN, 3, 5).key).toBe("nodata");
  });
  it("a cost with no break-even written is «no rule» (grey), even when there is a target", () => {
    expect(productVerdict(4, 3, null)).toMatchObject({ key: "norule", tone: "neutral" });
    expect(productVerdict(4, null, null).key).toBe("norule");
  });
  it("at or under the target is a win (green)", () => {
    expect(productVerdict(2.5, 3, 5)).toMatchObject({ key: "win", tone: "ok", label: "رابح — مرشّح تكبير" });
    expect(productVerdict(3, 3, 5).key).toBe("win");
  });
  it("above the target and up to the break-even is «between» (orange)", () => {
    expect(productVerdict(3.01, 3, 5)).toMatchObject({ key: "between", tone: "warn" });
    expect(productVerdict(5, 3, 5).key).toBe("between");
  });
  it("above the break-even is «lose» (red)", () => {
    expect(productVerdict(5.01, 3, 5)).toMatchObject({ key: "lose", tone: "danger", label: "فوق التعادل" });
  });
  it("with a break-even but no target, a cost under it is «between» — it cannot be a win without a target to beat", () => {
    expect(productVerdict(2, null, 5).key).toBe("between");
    expect(productVerdict(6, null, 5).key).toBe("lose");
  });
  it("zero cost is a real cost (a win), not «no data»", () => {
    expect(productVerdict(0, 3, 5).key).toBe("win");
  });
});
