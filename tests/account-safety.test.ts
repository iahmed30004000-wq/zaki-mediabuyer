import { describe, expect, it } from "vitest";
import { appealDraft, attributionHealth, judgeAccount } from "@/core/account-safety";
import { effectiveLevel } from "@/core/autonomy";

describe("account safety (spec S11 / T4.5)", () => {
  it("an active account with no rejection is fine", () => expect(judgeAccount({ accountStatus: 1, rejected24h: 0, paymentOk: true })).toMatchObject({ verdict: "ok", downgrade: false, freezeCreate: false }));
  it("a disabled account or a payment problem drops to level 0", () => {
    const v = judgeAccount({ accountStatus: 2, disableReason: 1, rejected24h: 0, paymentOk: true });
    expect(v).toMatchObject({ verdict: "restricted", downgrade: true });
    expect(effectiveLevel(2, { accountHealthAlert: v.downgrade, tokenExpired: false, sourceDown: false, bigGap: false }).level).toBe(0);
    expect(judgeAccount({ accountStatus: 1, rejected24h: 0, paymentOk: false }).downgrade).toBe(true);
    expect(judgeAccount({ accountStatus: 3, rejected24h: 0, paymentOk: true }).notes[0]).toContain("دفعة متأخرة");
  });
  it("three rejections in 24 h freeze creation, two only warn", () => {
    expect(judgeAccount({ accountStatus: 1, rejected24h: 3, paymentOk: true })).toMatchObject({ verdict: "watch", freezeCreate: true, downgrade: false });
    expect(judgeAccount({ accountStatus: 1, rejected24h: 2, paymentOk: true })).toMatchObject({ verdict: "watch", freezeCreate: false });
  });
  it("an appeal is drafted for a clean text, and advised against when our dictionary agrees with Meta", () => {
    const clean = appealDraft({ name: "CR00147_H07_HER_LP1", text: "قطرة طبيعية للعناية اليومية" }, { "Health": "Personal health" });
    expect(clean.worthAppeal).toBe(true);
    expect(clean.draft).toContain("CR00147_H07_HER_LP1");
    expect(clean.draft).toContain("بإيد المالك");
    const bad = appealDraft({ name: "CR00148_H01_PRB_LP1", text: "بيشفي المي الزرقا نهائياً" }, {});
    expect(bad.worthAppeal).toBe(false);
    expect(bad.draft).toContain("نعدّل");
  });
});

describe("attribution health (M09 / T4.4)", () => {
  const base = { ordersByMethod: { ad_id: 90, naming: 8, none: 2 }, capiAcceptedPct: 96, capiErrors: [] };
  it("small gaps, most orders tied by ad id, CAPI accepted: good", () => {
    const h = attributionHealth({ ...base, campaigns: [{ campaign: "SY_TRF01_WEB_CRT_261026_C01", metaPurchases: 52, webOrders: 50 }] });
    expect(h).toMatchObject({ attribution_health: "good", attributed_pct: 90, notify: [] });
    expect(h.gaps[0]).toMatchObject({ gap_pct: 4, likely_cause: "ضمن المقبول" });
  });
  it("a big gap shows per campaign with its likely cause, worst first", () => {
    const h = attributionHealth({ ...base, campaigns: [{ campaign: "A", metaPurchases: 30, webOrders: 50 }, { campaign: "B", metaPurchases: 80, webOrders: 50 }, { campaign: "tiny", metaPurchases: 9, webOrders: 2 }] });
    expect(h.gaps.map((g) => [g.campaign, g.gap_pct])).toEqual([["B", 60], ["A", -40]]);
    expect(h.gaps[1]!.likely_cause).toContain("معاملات الرابط");
    expect(h).toMatchObject({ attribution_health: "weak", notify: ["mediabuyer"] });
  });
  it("orders that do not reach their ad: broken, and the OMS is told", () => {
    const h = attributionHealth({ campaigns: [], ordersByMethod: { ad_id: 30, none: 70 }, capiAcceptedPct: null, capiErrors: ["Meta 400 190/: token expired"] });
    expect(h.attribution_health).toBe("broken");
    expect(h.notify).toEqual(expect.arrayContaining(["oms", "replies"]));
    expect(h.capi_issues[0]!.fix).toContain("توكن");
  });
});
