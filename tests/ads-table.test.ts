import { describe, expect, it } from "vitest";
import {
  COLUMNS,
  COLUMN_KEYS,
  DEFAULT_COLUMNS,
  daysRunning,
  earliest,
  filterTree,
  filtersActive,
  indexFacts,
  metricsOf,
  sanitizeColumns,
  scaleStep,
  stageIsTest,
  testShareOf,
  type Counted,
  type CountsLike,
  type Filterable,
  type InsightRow,
  type Node,
  type OrderRow,
  type ViewLike,
} from "@/core/ads-table";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const DAY = 86_400_000;

const ad = (id: string): Node => ({ id, level: "ad", children: [] });
const tree: Node[] = [
  {
    id: "C1",
    level: "campaign",
    children: [
      { id: "S1", level: "adset", children: [ad("A1"), ad("A2")] },
      { id: "S2", level: "adset", children: [ad("A3")] },
    ],
  },
];

const ins = (level: InsightRow["level"], id: string, day: string, x: Partial<InsightRow> = {}): InsightRow => ({
  level, id, day, spend: 10, impressions: 1000, clicks: 20, purchases: 1, v3s: 300, thru: 100, conversations: 0, frequency: 1.5, ...x,
});
const order = (o: Partial<OrderRow> & Pick<OrderRow, "day" | "status">): OrderRow => ({ adId: null, adSetId: null, campaignId: null, matureAt: NOW - DAY, messaging: false, ...o });

describe("columns", () => {
  it("has 16 default columns that start with the name, and six more the picker can add", () => {
    expect(DEFAULT_COLUMNS).toHaveLength(16);
    expect(DEFAULT_COLUMNS[0]).toBe("name");
    expect(COLUMNS.filter((c) => !c.on).map((c) => c.key)).toEqual(["spend", "costPerConfirmed", "cpaPixel", "hook", "hold", "gap"]);
    expect(new Set(COLUMN_KEYS).size).toBe(COLUMN_KEYS.length);
  });

  it("every numeric column names the glossary term that explains it", () => {
    for (const c of COLUMNS) if (c.metric || c.key === "days" || c.key === "budget" || c.key === "spendTY" || c.key === "adsCount" || c.key === "page") expect(c.term, c.key).toBeTruthy();
  });

  it("sanitizeColumns keeps known keys in the saved order, drops the rest, and puts the name first", () => {
    expect(sanitizeColumns(["orders", "nope", "spend", "orders", 7, null])).toEqual(["name", "orders", "spend"]);
    expect(sanitizeColumns(["costPerOrder", "name", "cpm"])).toEqual(["name", "costPerOrder", "cpm"]);
  });

  it("an empty or unreadable choice falls back to the defaults", () => {
    expect(sanitizeColumns(undefined)).toEqual(DEFAULT_COLUMNS);
    expect(sanitizeColumns([])).toEqual(DEFAULT_COLUMNS);
    expect(sanitizeColumns("orders")).toEqual(DEFAULT_COLUMNS);
    expect(sanitizeColumns(["zzz"])).toEqual(DEFAULT_COLUMNS);
  });
});

describe("indexFacts — a row's numbers", () => {
  const W = { from: "2026-11-13", to: "2026-11-14" };

  it("an ad reads its own rows; frequency is the impressions-weighted mean", () => {
    const f = indexFacts(tree, [ins("ad", "A1", "2026-11-13", { impressions: 1000, frequency: 1 }), ins("ad", "A1", "2026-11-14", { impressions: 3000, frequency: 2 })], [], NOW);
    const c = f.counted("ad", "A1", W);
    expect(c.counts.spend).toBe(20);
    expect(c.counts.impressions).toBe(4000);
    expect(c.frequency).toBe(1.75); // (1000×1 + 3000×2) ÷ 4000
    expect(c.hasInsights).toBe(true);
  });

  it("a day outside the window is not counted", () => {
    const f = indexFacts(tree, [ins("ad", "A1", "2026-11-12"), ins("ad", "A1", "2026-11-14")], [], NOW);
    expect(f.counted("ad", "A1", W).counts.spend).toBe(10);
    expect(f.counted("ad", "A1", { from: "2026-11-01", to: "2026-11-11" }).hasInsights).toBe(false);
  });

  it("an ad set with no rows of its own is the sum of its ads; a campaign the sum of its ad sets", () => {
    const f = indexFacts(tree, [ins("ad", "A1", "2026-11-14", { spend: 5 }), ins("ad", "A2", "2026-11-14", { spend: 7 }), ins("adset", "S2", "2026-11-14", { spend: 20 })], [], NOW);
    expect(f.counted("adset", "S1", W).counts.spend).toBe(12);
    expect(f.counted("adset", "S2", W).counts.spend).toBe(20);
    expect(f.counted("campaign", "C1", W).counts.spend).toBe(32);
  });

  it("when an object has its own rows they win over what its children carry (no double count)", () => {
    const f = indexFacts(tree, [ins("campaign", "C1", "2026-11-14", { spend: 100 }), ins("ad", "A1", "2026-11-14", { spend: 5 })], [], NOW);
    expect(f.counted("campaign", "C1", W).counts.spend).toBe(100);
  });

  it("an object nobody has numbers for has no insights — not a zero result", () => {
    const f = indexFacts(tree, [], [], NOW);
    const c = f.counted("ad", "A3", W);
    expect(c.hasInsights).toBe(false);
    expect(c.has).toBe(false);
    expect(c.frequency).toBeNull();
  });

  it("orders belong to the object whose id they carry: ad, ad set and campaign each count their own", () => {
    const orders: OrderRow[] = [
      order({ adId: "A1", adSetId: "S1", campaignId: "C1", day: "2026-11-14", status: "confirmed" }),
      order({ adId: "A1", adSetId: "S1", campaignId: "C1", day: "2026-11-14", status: "delivered" }),
      order({ adId: "A2", adSetId: "S1", campaignId: "C1", day: "2026-11-13", status: "returned" }),
      order({ adId: "A3", adSetId: "S2", campaignId: "C1", day: "2026-11-14", status: "new" }),
      order({ adId: "A3", adSetId: "S2", campaignId: "C1", day: "2026-11-01", status: "delivered" }), // outside the window
    ];
    const f = indexFacts(tree, [], orders, NOW);
    expect(f.counted("ad", "A1", W).counts).toMatchObject({ orders: 2, confirmed: 2, shipments: 1, delivered: 1, returned: 0 });
    expect(f.counted("adset", "S1", W).counts).toMatchObject({ orders: 3, confirmed: 3, shipments: 2, delivered: 1, returned: 1 });
    expect(f.counted("campaign", "C1", W).counts).toMatchObject({ orders: 4, confirmed: 3 });
    expect(f.counted("campaign", "C1", W).hasInsights).toBe(false);
    expect(f.counted("campaign", "C1", W).has).toBe(true);
  });

  it("only mature orders count as confirmed (an order from the last hours may still be waiting)", () => {
    const orders = [order({ adId: "A1", day: "2026-11-14", status: "confirmed", matureAt: NOW + 3_600_000 }), order({ adId: "A1", day: "2026-11-14", status: "confirmed" })];
    const c = indexFacts(tree, [], orders, NOW).counted("ad", "A1", W);
    expect(c.counts.orders).toBe(2);
    expect(c.counts.mature).toBe(1);
    expect(c.counts.confirmed).toBe(1);
  });

  it("a messaging order marks the row as a messaging one (conversations are reported)", () => {
    const orders = [order({ adId: "A1", day: "2026-11-14", status: "new", messaging: true })];
    const f = indexFacts(tree, [ins("ad", "A1", "2026-11-14", { conversations: 9 })], orders, NOW);
    expect(f.counted("ad", "A1", W).counts.conversations).toBe(9);
    expect(indexFacts(tree, [ins("ad", "A1", "2026-11-14")], [], NOW).counted("ad", "A1", W).counts.conversations).toBeUndefined();
  });

  it("spendOf reads only the spend (today / yesterday columns)", () => {
    const f = indexFacts(tree, [ins("ad", "A1", "2026-11-14", { spend: 4 })], [], NOW);
    expect(f.spendOf("ad", "A1", { from: "2026-11-14", to: "2026-11-14" })).toBe(4);
    expect(f.spendOf("ad", "A1", { from: "2026-11-13", to: "2026-11-13" })).toBeNull();
  });
});

describe("metricsOf", () => {
  const view: ViewLike = { spend: 10.1, ctr: 2, hook: 30.126, hold: 12, cpaPixel: 10.1, confirmRate: 80, costPerConfirmed: 5.05, profit: 999, gap: 16.7 };
  const counted = (x: { hasInsights?: boolean; counts?: Partial<CountsLike> } = {}): Counted => ({
    counts: { spend: 10, impressions: 1000, clicks: 20, v3s: 300, thru: 100, purchases: 1, orders: 2, mature: 2, confirmed: 2, shipments: 0, delivered: 0, returned: 0, ...x.counts },
    frequency: 1.4,
    hasInsights: true,
    has: true,
    ...(x.hasInsights === undefined ? {} : { hasInsights: x.hasInsights }),
  });

  it("spend carries the card's fee (it comes in the view); CPM and CTR read Meta's own spend", () => {
    const m = metricsOf(counted(), view, 6);
    expect(m.spend).toBe(10.1);
    expect(m.cpm).toBe(10); // 10 × 1000 ÷ 1000, without the fee
    expect(m.ctr).toBe(2);
    expect(m.hook).toBe(30.13);
  });

  it("cost of a real order = spend ÷ the OMS orders; no orders, no cost", () => {
    expect(metricsOf(counted(), view, 6).costPerOrder).toBe(5.05);
    expect(metricsOf(counted({ counts: { orders: 0 } }), view, 6).costPerOrder).toBeNull();
  });

  it("estimated profit = orders × the product's expected margin − spend, as on the home screen; unknown product = a dash", () => {
    expect(metricsOf(counted(), view, 6).profit).toBe(1.9); // 2 × 6 − 10.1
    expect(metricsOf(counted({ counts: { orders: 0 } }), view, 6).profit).toBe(-10.1);
    expect(metricsOf(counted(), view, null).profit).toBeNull();
  });

  it("with no Meta numbers the delivery metrics are dashes, but real orders still show", () => {
    const m = metricsOf(counted({ hasInsights: false }), view, 6);
    expect(m.spend).toBeNull();
    expect(m.cpm).toBeNull();
    expect(m.pixel).toBeNull();
    expect(m.costPerOrder).toBeNull();
    expect(m.profit).toBeNull();
    expect(m.orders).toBe(2);
  });

  it("no impressions: CPM and CTR are dashes, not zero", () => {
    const m = metricsOf(counted({ counts: { impressions: 0, clicks: 0 } }), view, 6);
    expect(m.cpm).toBeNull();
    expect(m.ctr).toBeNull();
  });
});

describe("daysRunning", () => {
  it("counts the day it started as the first", () => {
    expect(daysRunning("2026-11-14T08:00:00+0200", "2026-11-14")).toBe(1);
    expect(daysRunning("2026-11-11T08:00:00+0200", "2026-11-14")).toBe(4);
  });
  it("reads the start on the Amman clock (22:30 UTC on the 13th is already the 14th there)", () => {
    expect(daysRunning(new Date("2026-11-13T22:30:00Z"), "2026-11-14")).toBe(1);
    expect(daysRunning(new Date("2026-11-13T20:30:00Z"), "2026-11-14")).toBe(2);
  });
  it("a start in the future is 0 days; no start or nonsense is a dash", () => {
    expect(daysRunning("2026-11-20T08:00:00Z", "2026-11-14")).toBe(0);
    expect(daysRunning(null, "2026-11-14")).toBeNull();
    expect(daysRunning("not a date", "2026-11-14")).toBeNull();
  });
  it("earliest picks the oldest start and ignores the empty ones", () => {
    expect(earliest(["2026-11-12T00:00:00Z", null, "2026-11-10T00:00:00Z", undefined])?.toISOString()).toBe("2026-11-10T00:00:00.000Z");
    expect(earliest([null, undefined])).toBeNull();
  });
});

interface R extends Filterable<R> {
  id: string;
}
const row = (id: string, level: R["level"], x: Partial<R> = {}, children: R[] = []): R => ({ id, level, product: { code: "TRF01" }, market: "SY", pages: [], isTest: false, status: "active", children, ...x });

describe("filterTree", () => {
  const rows: R[] = [
    row("c1", "campaign", { pages: ["SP"] }, [
      row("s1", "adset", { pages: ["SP"] }, [row("a1", "ad", { pages: ["SP"] }), row("a2", "ad", { pages: ["SP"], status: "paused" })]),
      row("s2", "adset", { pages: ["VP"], status: "paused" }, []),
    ]),
    row("c2", "campaign", { product: { code: "TIN01" }, isTest: true, pages: ["VP"] }, [row("s3", "adset", { product: { code: "TIN01" }, isTest: true, pages: ["VP"] }, [])]),
    row("c3", "campaign", { product: null, isTest: null, market: "JO", needsNaming: true }, [row("s4", "adset", { product: null, isTest: null, market: "JO" }, [])]),
  ];
  const ids = (r: R[]): string[] => r.flatMap((x) => [x.id, ...ids(x.children)]);

  it("no filter keeps everything", () => {
    expect(filtersActive({})).toBe(false);
    expect(filtersActive({ kind: "all" })).toBe(false);
    expect(ids(filterTree(rows, {}))).toEqual(ids(rows));
  });

  it("product and kind belong to the whole campaign", () => {
    expect(ids(filterTree(rows, { product: "TIN01" }))).toEqual(["c2", "s3"]);
    expect(ids(filterTree(rows, { kind: "test" }))).toEqual(["c2", "s3"]);
    expect(ids(filterTree(rows, { kind: "scale" }))).toEqual(["c1", "s1", "a1", "a2", "s2"]);
  });

  it("an unreadable stage shows only under «الكل»", () => {
    expect(ids(filterTree(rows, { kind: "all" }))).toContain("c3");
    expect(ids(filterTree(rows, { kind: "test" }))).not.toContain("c3");
    expect(ids(filterTree(rows, { kind: "scale" }))).not.toContain("c3");
  });

  it("status finds a paused ad inside a running campaign, and prunes what does not match", () => {
    const out = filterTree(rows, { status: "paused" });
    expect(ids(out)).toEqual(["c1", "s1", "a2", "s2"]);
  });

  it("page keeps the campaigns and ad sets of that page", () => {
    expect(ids(filterTree(rows, { page: "VP" }))).toEqual(["c1", "s2", "c2", "s3"]);
  });

  it("the market belongs to the whole campaign", () => {
    expect(ids(filterTree(rows, { market: "JO" }))).toEqual(["c3", "s4"]);
    expect(ids(filterTree(rows, { market: "SY", kind: "test" }))).toEqual(["c2", "s3"]);
    expect(filtersActive({ market: "SY" })).toBe(true);
  });

  it("«بدها تسمية» keeps the campaign whose name could not be read, with everything under it", () => {
    expect(ids(filterTree(rows, { status: "naming" }))).toEqual(["c3", "s4"]);
  });

  it("the filters combine", () => {
    expect(ids(filterTree(rows, { product: "TRF01", status: "paused" }))).toEqual(["c1", "s1", "a2", "s2"]);
    expect(ids(filterTree(rows, { product: "TIN01", status: "paused" }))).toEqual([]);
  });

  it("it does not change the rows it was given", () => {
    const before = JSON.stringify(rows);
    filterTree(rows, { status: "paused" });
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe("test share", () => {
  it("is the test campaigns' spend over all the spend, and says when it passes the limit", () => {
    const s = testShareOf([{ isTest: true, spend: 70 }, { isTest: false, spend: 30 }, { isTest: null, spend: null }], 0.2);
    expect(s).toEqual({ test: 70, total: 100, share: 0.7, limit: 0.2, over: true });
    expect(testShareOf([{ isTest: true, spend: 10 }, { isTest: false, spend: 90 }], 0.2).over).toBe(false);
  });
  it("with no spend there is no share (and no alarm)", () => {
    const s = testShareOf([{ isTest: true, spend: null }], 0.2);
    expect(s.share).toBeNull();
    expect(s.over).toBe(false);
  });
  it("an unreadable name is neither a test nor a scale", () => {
    expect(stageIsTest("TEST")).toBe(true);
    expect(stageIsTest("CRT")).toBe(true);
    expect(stageIsTest("SCALE")).toBe(false);
    expect(stageIsTest(null)).toBeNull();
  });
});

describe("scaleStep", () => {
  it("one step up of the ladder (20%)", () => {
    expect(scaleStep(40, 0.2)).toEqual({ before: 40, after: 48, delta: 8 });
    expect(scaleStep(25, 0.2)).toEqual({ before: 25, after: 30, delta: 5 });
  });
  it("always moves at least a cent, and refuses what has no budget of its own", () => {
    expect(scaleStep(0.01, 0.2)?.after).toBe(0.02);
    expect(scaleStep(null, 0.2)).toBeNull();
    expect(scaleStep(0, 0.2)).toBeNull();
    expect(scaleStep(40, 0)).toBeNull();
  });
});
