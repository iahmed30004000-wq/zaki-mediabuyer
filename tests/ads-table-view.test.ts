import { describe, expect, it } from "vitest";
import type { InsightRow, OrderRow } from "@/core/ads-table";
import { parseRange } from "@/core/dates";
import { assembleTable, videoLine, videoMap, type Ctx, type Source } from "@/lib/ads-table";
import { PRODUCTS, targetsOf } from "@/lib/mock/data";

// 2026-11-14, noon in Amman
const NOW = new Date("2026-11-14T09:00:00Z");
const TODAY = "2026-11-14";
const YESTERDAY = "2026-11-13";
const trf = PRODUCTS.find((p) => p.code === "TRF01")!;
const margin = targetsOf(trf).margin;

const ins = (id: string, day: string, spend: number, x: Partial<InsightRow> = {}): InsightRow => ({ level: "ad", id, day, spend, impressions: 1000, clicks: 20, purchases: 1, v3s: 300, thru: 100, conversations: 0, frequency: 1.5, ...x });
const order = (adId: string, adSetId: string, campaignId: string, day: string, status = "confirmed"): OrderRow => ({ adId, adSetId, campaignId, day, status, matureAt: NOW.getTime() - 86_400_000, messaging: false });

const source = (): Source => ({
  demo: false,
  products: [trf],
  campaigns: [
    {
      id: "C1", name: "SY_TRF01_WEB_SCALE_261012_C01", status: "active", market: "SY", productCode: "TRF01", stage: "SCALE", namingOk: true, budget: null, start: "2026-11-10T08:00:00+03:00",
      adsets: [
        { id: "S1", name: "BROAD_ADV_SP_CPT0012_v1", status: "active", pageCode: "SP", budget: 40, start: "2026-11-10T08:00:00+03:00", ads: [{ id: "A1", name: "CR00147_H07_HER_LP1", status: "active", start: null }, { id: "A2", name: "CR00152_H03_ING_LP1", status: "paused", start: null }] },
        { id: "S2", name: "BROAD_ADV_VP_CPT0015_v1", status: "learning", pageCode: "VP", budget: 25, start: null, ads: [{ id: "A3", name: "CR00160_H01_HER_LP1", status: "active", start: null }] },
      ],
    },
    {
      id: "C2", name: "SY_TRF01_WEB_CRT_261026_C01", status: "active", market: "SY", productCode: "TRF01", stage: "CRT", namingOk: true, budget: 30, start: null,
      adsets: [{ id: "S3", name: "BROAD_ADV_SP_CPT0020_v1", status: "active", pageCode: "SP", budget: null, start: null, ads: [{ id: "A4", name: "CR00170_H02_ING_LP1", status: "active", start: null }] }],
    },
    { id: "C3", name: "my campaign", status: "paused", market: "JO", productCode: null, stage: null, namingOk: false, budget: null, start: null, adsets: [] },
  ],
  insights: [
    ins("A1", TODAY, 10), ins("A1", YESTERDAY, 8),
    ins("A2", TODAY, 5),
    ins("A3", TODAY, 20, { frequency: 2.5 }),
    ins("A4", TODAY, 10), ins("A4", YESTERDAY, 4),
  ],
  orders: [
    order("A1", "S1", "C1", TODAY), order("A1", "S1", "C1", TODAY),
    order("A3", "S2", "C1", TODAY),
    order("A1", "S1", "C1", YESTERDAY),
    order("A4", "S3", "C2", TODAY),
  ],
});

const ctx: Ctx = { fx: 0.01, testLimit: 0.2, stepPct: 0.2, target: 3, breakeven: (c) => (c === "TRF01" ? 5 : null), rulesMissing: false };
const build = (d = "today") => assembleTable(source(), parseRange({ d }, NOW), NOW, ctx);

describe("assembleTable", () => {
  const data = build();
  const c1 = data.rows.find((r) => r.id === "C1")!;
  const s1 = c1.children.find((r) => r.id === "S1")!;
  const s2 = c1.children.find((r) => r.id === "S2")!;

  it("a campaign is the sum of its ad sets, which are the sum of their ads (Meta's spend plus the card's 1%)", () => {
    expect(c1.m.spend).toBe(35.35); // (10 + 5 + 20) × 1.01
    expect(s1.m.spend).toBe(15.15);
    expect(s2.m.spend).toBe(20.2);
    expect(c1.m.pixel).toBe(3);
  });

  it("real orders and their cost come from the OMS rows tied to the object", () => {
    expect(c1.m.orders).toBe(3);
    expect(c1.m.costPerOrder).toBe(11.78); // 35.35 ÷ 3
    expect(s1.m.orders).toBe(2);
    expect(s1.m.costPerOrder).toBe(7.58);
    expect(s2.m.orders).toBe(1);
    expect(c1.children.flatMap((s) => s.children).find((a) => a.id === "A2")!.m.orders).toBe(0);
  });

  it("estimated profit = orders × the product's margin − spend", () => {
    expect(c1.m.profit).toBe(Math.round((3 * margin - 35.35) * 100) / 100);
  });

  it("CPM and CTR read Meta's own spend; the frequency is the impressions-weighted mean", () => {
    expect(c1.m.cpm).toBe(11.67); // 35 × 1000 ÷ 3000
    expect(c1.m.ctr).toBe(2);
    expect(c1.m.frequency).toBe(1.83); // (1000×1.5 + 1000×1.5 + 1000×2.5) ÷ 3000
  });

  it("today and yesterday carry the card's fee", () => {
    expect(c1.spendToday).toBe(35.35);
    expect(c1.spendYesterday).toBe(8.08);
    expect(s2.spendYesterday).toBeNull(); // nobody has yesterday's numbers for that ad set
  });

  it("«قارن»: the window before — yesterday, when the range is today", () => {
    expect(c1.prev.spend).toBe(8.08);
    expect(c1.prev.orders).toBe(1);
    expect(c1.prev.costPerOrder).toBe(8.08);
  });

  it("budgets: an ad set holds its own; a campaign without one shows the sum of its ad sets and cannot be scaled as a whole", () => {
    expect(s1.budget).toBe(40);
    expect(c1.budget).toBe(65);
    expect(c1.canScale).toBe(false);
    expect(s1.canScale).toBe(true);
    const c2 = data.rows.find((r) => r.id === "C2")!;
    expect(c2.budget).toBe(30);
    expect(c2.canScale).toBe(true);
    expect(c2.children[0]!.canScale).toBe(false); // an ad set with no budget of its own (CBO)
  });

  it("days running count the start as day 1 (a campaign with no start of its own is as old as its oldest ad set)", () => {
    expect(c1.days).toBe(5);
    expect(s1.days).toBe(5);
    expect(data.rows.find((r) => r.id === "C2")!.days).toBeNull();
  });

  it("pages and ad counts roll up", () => {
    expect(c1.pages).toEqual(["SP", "VP"]);
    expect(s1.pages).toEqual(["SP"]);
    expect(c1.adsCount).toBe(3);
    expect(s1.adsCount).toBe(2);
    expect(s1.children[0]!.adsCount).toBeNull();
  });

  it("rows are sorted by spend, biggest first — ad sets and ads too", () => {
    expect(data.rows.map((r) => r.id)).toEqual(["C1", "C2", "C3"]);
    expect(c1.children.map((r) => r.id)).toEqual(["S2", "S1"]);
    expect(s1.children.map((r) => r.id)).toEqual(["A1", "A2"]);
  });

  it("a campaign nobody has numbers for shows dashes, not zeros", () => {
    const c3 = data.rows.find((r) => r.id === "C3")!;
    expect(c3.m.spend).toBeNull();
    expect(c3.m.cpm).toBeNull();
    expect(c3.m.orders).toBeNull();
    expect(c3.spendToday).toBeNull();
    expect(c3.isTest).toBeNull();
    expect(c3.needsNaming).toBe(true);
  });

  it("the test-share gauge counts the spend of the campaigns whose stage is a test", () => {
    // C2 (CRT, a test): 10.1 of 45.45
    expect(data.share.test).toBe(10.1);
    expect(data.share.total).toBe(45.45);
    expect(data.share.share).toBe(0.222);
    expect(data.share.over).toBe(true);
  });

  it("the filters of the screen come from the rows: products and pages", () => {
    expect(data.products).toEqual([{ code: "TRF01", name: "ماء الكمأة" }]);
    expect(data.pages).toEqual(["SP", "VP"]);
  });

  it("a longer range sums its days (7 days: yesterday's spend joins today's)", () => {
    const week = build("7d");
    const w1 = week.rows.find((r) => r.id === "C1")!;
    expect(w1.m.spend).toBe(43.43); // (10 + 8 + 5 + 20) × 1.01
    expect(w1.m.orders).toBe(4);
    expect(w1.spendToday).toBe(35.35); // the today / yesterday columns do not move with the range
  });

  it("the ad rows say what their name says", () => {
    const a1 = s1.children[0]!;
    expect(a1.creativeCode).toBe("CR00147");
    expect(a1.codes).toBe("H07 · HER · LP1");
    expect(a1.counts).toMatchObject({ orders: 2 });
  });
});

describe("the video behind an ad (V and JOB)", () => {
  it("joins an ad's creative code to the bank's V and JOB through the Drive file they share", () => {
    expect(
      videoMap(
        [{ crCode: "CR00147", driveFileId: "file-1" }, { crCode: "CR00160", driveFileId: "file-2" }, { crCode: "CR00170", driveFileId: null }, { crCode: "CR00180", driveFileId: "file-9" }],
        [{ driveFileId: "file-1", vName: "V12", job: "JOB-TRF-3" }, { driveFileId: "file-1", vName: "V99", job: "JOB-OTHER" }, { driveFileId: "file-2", vName: "V13", job: "JOB-TRF-4" }, { driveFileId: null, vName: "V1", job: "J" }],
      ),
    ).toEqual({ CR00147: { v: "V12", job: "JOB-TRF-3" }, CR00160: { v: "V13", job: "JOB-TRF-4" } });
  });

  it("the ad's first decoded line names its V and JOB when the bank knows the file, and stays «فيديو CR…» when it does not", () => {
    const withVideo = assembleTable({ ...source(), videoOf: { CR00147: { v: "V12", job: "JOB-TRF-3" } } }, parseRange({ d: "today" }, NOW), NOW, ctx);
    const ad = (id: string) => withVideo.rows.flatMap((c) => c.children).flatMap((s) => s.children).find((a) => a.id === id)!;
    expect(ad("A1").decoded?.[0]).toBe("فيديو CR00147 · V12 · JOB-TRF-3");
    expect(ad("A3").decoded?.[0]).toBe("فيديو CR00160");
    expect(videoLine("CR00147")).toBe("فيديو CR00147");
  });
});
