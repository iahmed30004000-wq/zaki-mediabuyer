import { describe, expect, it } from "vitest";
import { SEED_PRODUCTS, nextFreeCampaignName, parseAdName, parseAdSetName, parseCampaignName, productFromLegacyName, yymmdd } from "@/core/naming";
import { isMature, maturityCounts } from "@/core/maturity";

describe("naming (spec 5.1)", () => {
  it("reads the three levels", () => {
    expect(parseCampaignName("SY_TRF01_WEB_CRT_261026_C01")).toEqual({ market: "SY", productCode: "TRF01", objective: "WEB", stage: "CRT", date: "261026", seq: 1 });
    expect(parseAdSetName("BROAD_ADV_SP_CPT0012_v1")).toEqual({ audience: "BROAD", placement: "ADV", pageCode: "SP", conceptId: "CPT0012", version: 1 });
    expect(parseAdName("CR00147_H07_HER_LP1")).toEqual({ creativeCode: "CR00147", hookCode: "H07", angleCode: "HER", lpCode: "LP1" });
  });

  it("rejects old placement codes and free text", () => {
    expect(parseAdSetName("BROAD_FB_SP_CPT0012_v1")).toBeNull();
    expect(parseCampaignName("كمأة سوريا جديدة")).toBeNull();
  });

  it("never creates a duplicate name: C{nn} goes up", () => {
    const base = { market: "SY", productCode: "TRF01", objective: "WEB", stage: "CRT", date: "261026" } as const;
    expect(nextFreeCampaignName(base, ["SY_TRF01_WEB_CRT_261026_C01", "SY_TRF01_WEB_CRT_261026_C02"])).toBe("SY_TRF01_WEB_CRT_261026_C03");
  });

  it("dates in Amman time", () => {
    expect(yymmdd(new Date("2026-10-25T22:30:00Z"))).toBe("261026");
  });

  it("old names find their product through the aliases, the longest wins", () => {
    expect(productFromLegacyName("حملة ماء الكمأة سوريا", SEED_PRODUCTS)).toEqual({ code: "TRF01", via: "ماء الكمأة" });
    expect(productFromLegacyName("KamaaEye test 2", SEED_PRODUCTS)?.code).toBe("TRF01");
    expect(productFromLegacyName("قطره طنين جديده", SEED_PRODUCTS)?.code).toBe("TIN01");
    expect(productFromLegacyName("حملة عامة", SEED_PRODUCTS)).toBeNull();
  });
});

describe("mature orders (spec 6.6)", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  it("a 10-hour-old order is not mature and stays out of the confirm rate", () => {
    expect(isMature(new Date("2026-10-26T02:00:00Z"), now)).toBe(false);
    const c = maturityCounts(
      [
        { createdAt: new Date("2026-10-26T02:00:00Z"), status: "new" },
        { createdAt: new Date("2026-10-24T10:00:00Z"), status: "confirmed" },
        { createdAt: new Date("2026-10-24T11:00:00Z"), status: "canceled" },
      ],
      now,
    );
    expect(c).toEqual({ orders: 3, mature: 2, confirmedMature: 1, open: 1 });
  });
});
