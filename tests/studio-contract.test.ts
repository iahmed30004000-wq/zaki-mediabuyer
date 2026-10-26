import { describe, expect, it } from "vitest";
import { isVpId, parseWindow, performanceRows, studioAdName, vpIdFromAdName } from "@/core/studio-contract";
import { hashToken, newToken } from "@/server/api-token";

describe("studio ids (the studio's adname.py, docs/STUDIO_DATA_CONTRACT_AR.md)", () => {
  it("accepts the studio's VP ids, hook versions included, and nothing else", () => {
    expect(isVpId("VP-TRF01-0012-v2")).toBe(true);
    expect(isVpId("VP-kama-109-v2-h3")).toBe(true);
    expect(isVpId("VP-kama-109")).toBe(false);
    expect(isVpId("CR00147_H07_HER_LP1")).toBe(false);
    expect(isVpId("VP-a b-1-v1")).toBe(false);
  });
  it("reads the fifth field of a studio-style ad name, never guesses", () => {
    expect(vpIdFromAdName("SY|kama|DawaCare|video|VP-kama-109-v2")).toBe("VP-kama-109-v2");
    expect(vpIdFromAdName("SY|kama|DawaCare|video")).toBeNull();
    expect(vpIdFromAdName("CR00147_H07_HER_LP1")).toBeNull();
  });
  it("builds the name the studio links on, with no stray separator", () => {
    expect(studioAdName({ market: "SY", productCode: "TRF01", pageCode: "SP", vpId: "VP-TRF01-0012-v2" })).toBe("SY|TRF01|SP|video|VP-TRF01-0012-v2");
    const name = studioAdName({ market: null, productCode: "A|B", pageCode: null, vpId: "VP-TRF01-0012-v2" });
    expect(name.split("|")).toHaveLength(5);
    expect(vpIdFromAdName(name)).toBe("VP-TRF01-0012-v2");
  });
});

describe("the date window", () => {
  it("takes both days and at most 31 of them", () => {
    expect(parseWindow("2026-10-01", "2026-10-31")).toMatchObject({ from: new Date("2026-10-01T00:00:00Z") });
    expect(typeof parseWindow("2026-10-01", "2026-11-01")).toBe("string");
    expect(typeof parseWindow("2026-10-05", "2026-10-01")).toBe("string");
    expect(typeof parseWindow("1/10/2026", null)).toBe("string");
    expect(typeof parseWindow(null, null)).toBe("string");
  });
});

describe("performance rows (what the studio's crm.py keeps)", () => {
  const ads = [{ metaAdId: "a1", adName: "SY|TRF01|SP|video|VP-TRF01-0012-v2" }];
  const spend = [
    { metaAdId: "a1", date: "2026-10-20", spend: "42.50", impressions: 10000, video3s: 2310 },
    { metaAdId: "zz", date: "2026-10-20", spend: "99", impressions: 1, video3s: 1 },
  ];
  const order = (status: string, collected: string | null = null) => ({ metaAdId: "a1", date: "2026-10-20", status, collected });
  const orders = [order("delivered", "20"), order("delivered", null), order("confirmed"), order("returned"), { ...order("delivered", "20"), metaAdId: "zz" }];

  it("counts per ad and order day, with the rates the contract names", () => {
    const [row, ...rest] = performanceRows(ads, spend, orders);
    expect(rest).toHaveLength(0); // the unlinked ad never shows
    expect(row).toEqual({ ad_name: "SY|TRF01|SP|video|VP-TRF01-0012-v2", date: "2026-10-20", spend: 42.5, orders: 4, delivered: 2, collected: 1, delivery_rate: 0.5, cost_per_delivered: 21.25, engagement: 0.231 });
  });
  it("carries only the contract's keys — no customer field can ride along", () => {
    const [row] = performanceRows(ads, spend, orders);
    expect(Object.keys(row!).sort()).toEqual(["ad_name", "collected", "cost_per_delivered", "date", "delivered", "delivery_rate", "engagement", "orders", "spend"]);
  });
  it("leaves out days with neither spend nor orders, and divides by nothing as null", () => {
    expect(performanceRows(ads, [{ ...spend[0]!, spend: "0", impressions: 0 }], [])).toEqual([]);
    const [row] = performanceRows(ads, [], [order("confirmed")]);
    expect(row).toMatchObject({ spend: 0, orders: 1, delivered: 0, cost_per_delivered: null, engagement: null });
  });
});

describe("studio tokens", () => {
  it("are random, and only a fixed-length hash is kept", () => {
    const a = newToken();
    expect(a).not.toBe(newToken());
    expect(a.length).toBeGreaterThan(40);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toContain(a.slice(4, 14));
  });
});
