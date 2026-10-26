import { describe, expect, it } from "vitest";
import { judgeFatigue } from "@/core/fatigue";

const early = { impressions: 30000, reach: 26000, clicks: 600, hooks: 10500, spend: 90, orders: 30 };
describe("creative fatigue (spec 6.5)", () => {
  it("all three — frequency, a 25% drop, cost +30% — is tired, with the reasons", () => {
    const recent = { impressions: 30000, reach: 10000, clicks: 390, hooks: 9900, spend: 120, orders: 28 };
    const v = judgeFatigue(early, recent, { impressions: 70000, reach: 25000 }, "SY");
    expect(v.state).toBe("tired");
    expect(v.reasons).toHaveLength(3);
    expect(v.reasons[1]).toContain("النقر نزل 35%");
  });
  it("two of three is only «watch»; a fresh ad is fresh", () => {
    const recent = { impressions: 30000, reach: 10000, clicks: 390, hooks: 9900, spend: 90, orders: 30 };
    expect(judgeFatigue(early, recent, { impressions: 70000, reach: 25000 }, "SY").state).toBe("watch");
    expect(judgeFatigue(early, early, { impressions: 70000, reach: 60000 }, "SY").state).toBe("fresh");
  });
  it("Jordan's small audience is watched from a frequency of 2.0", () => {
    const recent = { impressions: 30000, reach: 10000, clicks: 390, hooks: 9900, spend: 120, orders: 28 };
    expect(judgeFatigue(early, recent, { impressions: 55000, reach: 25000 }, "JO").state).toBe("tired");
    expect(judgeFatigue(early, recent, { impressions: 55000, reach: 25000 }, "SY").state).toBe("watch");
  });
  it("orders that stopped while it still spends count as a cost rise", () => {
    const recent = { impressions: 30000, reach: 10000, clicks: 390, hooks: 9900, spend: 60, orders: 0 };
    expect(judgeFatigue(early, recent, { impressions: 70000, reach: 25000 }, "SY").costRise).toBe(1);
  });
});
