/**
 * «الأرقام» as drawn (v6 · P6, docs/rebuild-v6/04-numbers.md §7): the tiles with their line and their words, the chart with its circles and the list under it, «كل منتج: كنا وصرنا», «رحلة الطلب», the product's
 * Arabic name with its code after it, every one of the 31 numbers as a «كنا ← صرنا» tile. Rendered on the server (no browser). What is held: every number arrives computed, a missing one says WHY (never a bare dash),
 * the figures take the mark of the source (حقيقي · ميتا · تقدير), and the chart never says one thing caused another.
 */
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }), usePathname: () => "/numbers", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { FunnelView, PeriodSwitcher, ProductsCompareTable, RangeLine, TileView, TodaySoFar } from "@/components/numbers/summary";
import { Groups, StatTile } from "@/components/numbers/numbers-view";
import { TrendPanel } from "@/components/numbers/trend-panel";
import { ProductName } from "@/components/ui/product-name";
import { funnelCompare, homeTiles, productCompares } from "@/core/compare";
import { freshness } from "@/core/freshness";
import { STATS, SET_KEYS, type NumbersSet } from "@/core/numbers";
import type { SourceFacts } from "@/core/numbers-readiness";

const NOW = "2026-11-22T12:00:00.000Z";
const FACTS: SourceFacts = { now: NOW, metaLinked: true, metaLastSyncAt: "2026-11-22T11:48:00.000Z", spendYesterday: true, omsLinked: true, omsLastPullAt: "2026-11-22T11:00:00.000Z", productsWithoutBreakeven: 0, unmappedFolders: 0, productsWithoutName: 0, stockFresh: true };
const SILENT: SourceFacts = { ...FACTS, omsLastPullAt: "2026-11-22T02:00:00.000Z" };
const set = (over: Partial<NumbersSet> = {}): NumbersSet => ({ ...Object.fromEntries(SET_KEYS.map((k) => [k, null])), ...over }) as NumbersSet;
const WINDOW = { days: 7, toDay: "2026-11-21" };
const cur = set({ costPerOrder: 2.96, ordersIn: 987, confirmRate: 57, spend: 2814 });
const prev = set({ costPerOrder: 3.42, ordersIn: 826, confirmRate: 50, spend: 3017 });
const line = Array.from({ length: 30 }, (_, i) => 3 + Math.sin(i / 3));

describe("a tile with its line", () => {
  it("the line is drawn when the day by day values are there, and the words, the source badge and «كنا» with it", () => {
    const [t] = homeTiles(cur, prev, FACTS, WINDOW, { realCost: line });
    const out = render(h(TileView, { t: t! }));
    expect(out).toContain("<svg");
    expect(out).toContain("أرخص 13%");
    expect(out).toContain("حقيقي");
    expect(out).toContain("كنا ");
  });

  it("no line when the values could not be read — the tile is still complete", () => {
    const [t] = homeTiles(cur, prev, FACTS, WINDOW);
    const out = render(h(TileView, { t: t! }));
    expect(out).not.toContain("<svg");
    expect(out).toContain("أرخص 13%");
  });

  it("the OMS silent: the figures from it say «تقدير» and the spend still says «ميتا»", () => {
    const out = render(h("div", null, ...homeTiles(cur, prev, SILENT, WINDOW).map((t) => h(TileView, { key: t.key, t }))));
    expect(out.match(/تقدير/g)?.length).toBe(3);
    expect(out).toContain("ميتا");
  });
});

describe("the chart and what we did", () => {
  const metric = { key: "realCost", short: "التكلفة", title: "تكلفة الطلب الحقيقي", unit: "$" as const, values: line, empty: "ما في خط", breakEven: 4.5, target: 3 };

  it("the line, the owner's two lines, a numbered circle per mark and the same numbers in a list with their sentences", () => {
    const out = render(h(TrendPanel, { metrics: [metric], marks: [{ index: 20, text: "كبّرنا «حرير 3» +20%", href: "/inbox/change%3Ac1" }, { index: 25, text: "جولة الليل: كبّرت 2 ووقّفت 3", href: null }], rest: [{ day: "2026-11-10", text: "أمر: ولا فيديو جديد", href: null }], today: "2026-11-22" }));
    expect(out).toContain("تكلفة الطلب الحقيقي — آخر 30 يوم");
    expect(out).toContain("نقطة التعادل");
    expect(out).toContain("الهدف");
    expect(out).toContain("كبّرنا «حرير 3» +20%");
    expect(out).toContain('href="/inbox/change%3Ac1"');
    expect(out).toContain("باقي اللي عملناه");
    expect(out).toContain("قبل 12 يوم");
    expect(out).not.toMatch(/بسبب|لأنو/); // the chart never says one thing caused another
  });

  it("a break-even or a target the owner did not write is not drawn", () => {
    const out = render(h(TrendPanel, { metrics: [{ ...metric, breakEven: null, target: null }], marks: [], rest: [], today: "2026-11-22" }));
    expect(out).not.toContain("نقطة التعادل");
    expect(out).not.toContain("الهدف");
    expect(out).not.toContain("باقي اللي عملناه");
  });

  it("fewer than two numbers: the chart says WHY it has no line (not a bare dash), and draws no circle", () => {
    const out = render(h(TrendPanel, { metrics: [{ ...metric, values: [null, 3, null], empty: "ما في خط: ميتا مش مربوطة" }], marks: [{ index: 1, text: "حدث", href: null }], rest: [], today: "2026-11-22" }));
    expect(out).toContain("ما في خط: ميتا مش مربوطة");
    expect(out).not.toContain("<svg");
  });

  it("the switch offers the four numbers when there are four; one number has no switch", () => {
    const four = ["realCost", "orders", "confirmRate", "spend"].map((key) => ({ ...metric, key, short: key }));
    expect(render(h(TrendPanel, { metrics: four, marks: [], rest: [], today: "2026-11-22" }))).toContain('role="radiogroup"');
    expect(render(h(TrendPanel, { metrics: [metric], marks: [], rest: [], today: "2026-11-22" }))).not.toContain('role="radiogroup"');
  });
});

describe("«كل منتج: كنا وصرنا»", () => {
  const products = [
    { code: "ALBETCHU", name: "حرير", current: set({ costPerOrder: 2.4, ordersIn: 322 }), prev: set({ costPerOrder: 2.9, ordersIn: 266 }), breakeven: 4, hasData: true },
    { code: "D", name: "د", current: set({ ordersIn: 14 }), prev: set({ ordersIn: 7 }), breakeven: null, hasData: true },
  ];

  it("the Arabic name with its code after it, the cost before and now with the words, the verdict, and the reason where the cost is missing", () => {
    const out = render(h(ProductsCompareTable, { rows: productCompares(products, 3, FACTS, WINDOW), query: "p=30" }));
    expect(out).toContain("حرير");
    expect(out).toContain("ALBETCHU");
    expect(out).toContain('href="/numbers/products/ALBETCHU?p=30"');
    expect(out).toContain("أرخص 17%");
    expect(out).toContain("رابح — مرشّح تكبير");
    expect(out).toContain("ما في صرف مسجّل للفترة"); // the cost of «د» is missing: it says why
    expect(out).toContain("ما في طلبات مربوطة"); // and its verdict says there is no cost to judge
    expect(out).toContain("كنا 38"); // the orders of a day: now, with «كنا» beside it
  });

  it("no product with numbers: it says so and what brings them", () => {
    expect(render(h(ProductsCompareTable, { rows: [], query: "" }))).toContain("ما في منتج إله أرقام بهالفترة");
  });
});

describe("«رحلة الطلب»", () => {
  it("of every 100: the steps with «كنا» and the difference in points", () => {
    const out = render(h(FunnelView, { steps: funnelCompare({ ordersIn: 200, confirmed: 114, shippedOrders: 104, delivered: 82 }, { ordersIn: 100, confirmed: 50, shippedOrders: 44, delivered: 36 }) }));
    expect(out).toContain("من كل 100 طلب دخلوا");
    for (const w of ["دخل", "تأكّد", "انشحن", "تسلّم", "أحسن 7 نقاط"]) expect(out, w).toContain(w);
  });

  it("no orders: one sentence that says why, not four dashes", () => {
    const out = render(h(FunnelView, { steps: funnelCompare({ ordersIn: null, confirmed: null, shippedOrders: null, delivered: null }, { ordersIn: null, confirmed: null, shippedOrders: null, delivered: null }) }));
    expect(out).toContain("ما في طلبات بالفترة");
    expect(out).not.toContain("كنا");
  });
});

describe("today so far and the line under the switcher", () => {
  it("today is shown on its own, with no difference and the reason it is not compared", () => {
    const out = render(h(TodaySoFar, { spend: 98, orders: 12, cost: 8.17, facts: FACTS }));
    expect(out).toContain("اليوم لهلق");
    expect(out).toContain("لسا ما خلص، فما بيدخل بالمقارنة");
    expect(out).not.toMatch(/أرخص|أغلى|أكتر|أقل|زاد|نزل/);
  });

  it("nothing yet today: not drawn", () => {
    expect(render(h(TodaySoFar, { spend: null, orders: null, cost: null, facts: FACTS }))).toBe("");
  });

  it("the window, the one before it and when the numbers last moved — the dates are written left to right", () => {
    const out = render(h(RangeLine, { line: freshness(FACTS).line, range: { from: "2026-11-15", to: "2026-11-21" }, prev: { from: "2026-11-08", to: "2026-11-14" } }));
    expect(out).toContain("آخر تحديث قبل 12 دقيقة");
    expect(out).toContain("الفترة من");
    expect(out).toContain("2026-11-15");
    expect(out).toContain("2026-11-08");
    expect(out).toContain('dir="ltr"');
    expect(out).toContain("بتخلص عند أمس");
  });

  it("the switcher offers the four periods", () => {
    const out = render(h(PeriodSwitcher, { period: "7", from: "2026-11-15", to: "2026-11-21", yesterday: "2026-11-21" }));
    for (const w of ["أمس مقابل اللي قبله", "آخر 7 أيام", "آخر 30 يوم", "مخصص"]) expect(out, w).toContain(w);
  });
});

describe("every one of the 31 numbers is a «كنا ← صرنا» tile", () => {
  it("a share is read in points, a cost in cheaper or dearer, a count in more or fewer, and the stock cover keeps one decimal", () => {
    const now = set({ confirmRate: 57, costPerDelivered: 8, rejected: 10, stockCover: 6.5, spend: 120 });
    const was = set({ confirmRate: 50, costPerDelivered: 10, rejected: 20, stockCover: 5, spend: 100 });
    const tile = (k: (typeof STATS)[number]["key"]) => render(h(StatTile, { def: STATS.find((s) => s.key === k)!, set: now, prev: was, facts: FACTS }));
    expect(tile("confirmRate")).toContain("أحسن 7 نقاط");
    expect(tile("costPerDelivered")).toContain("أرخص 20%");
    expect(tile("rejected")).toContain("أقل 50%"); // fewer rejections is good: green
    expect(tile("stockCover")).toContain("6.5");
    expect(tile("spend")).toContain("زاد 20%");
  });

  it("a missing number says why by its group, and the badge «حقيقي» of the glossary becomes «تقدير» while the OMS is silent", () => {
    const def = STATS.find((s) => s.key === "ordersIn")!;
    expect(render(h(StatTile, { def, set: set(), prev: set(), facts: SILENT }))).toContain("نظام الطلبات ما انسحب من فترة");
    expect(render(h(StatTile, { def, set: set({ ordersIn: 5 }), prev: set({ ordersIn: 4 }), facts: FACTS }))).toContain("حقيقي");
    expect(render(h(StatTile, { def, set: set({ ordersIn: 5 }), prev: set({ ordersIn: 4 }), facts: SILENT }))).toContain("تقدير");
    const stock = STATS.find((s) => s.key === "stockUnits")!;
    expect(render(h(StatTile, { def: stock, set: set(), prev: set(), facts: FACTS }))).toContain("Claude لسا ما بعت المخزون");
  });

  it("the groups list all 31 numbers, none of them with a tool name in its words", () => {
    const out = render(h(Groups, { p: { current: cur, prev, breakeven: 4, rejectReasons: [{ reason: "سعر", count: 3 }], offers: [{ offer: "قطعة", orders: 9, pieces: 1 }], stockUrgency: "red" }, facts: FACTS, target: 3 }));
    for (const s of STATS) expect(out, s.label).toContain(s.label.includes("(") ? s.label.split("(")[0]!.trim() : s.label);
    expect(out).toContain("أكتر أسباب الرفض: سعر (3)");
    expect(out).toContain("المخزون أحمر");
    expect(out).not.toMatch(/push_|log_run|_TOKEN|MCP/);
  });
});

describe("the product's name", () => {
  it("Arabic first, its code small and faint after it; a code that IS the name is written once", () => {
    const out = render(h(ProductName, { name: "حرير", code: "ALBETCHU" }));
    expect(out.indexOf("حرير")).toBeLessThan(out.indexOf("ALBETCHU"));
    expect(out).toContain('dir="ltr"');
    expect(render(h(ProductName, { name: "KAMAA", code: "KAMAA" })).match(/KAMAA/g)?.length).toBe(1);
  });
});
