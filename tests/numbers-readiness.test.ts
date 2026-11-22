/**
 * «شو ناقص لتطلع الأرقام» (v6 · P5, docs/rebuild-v6/04-numbers.md §6): five things the numbers stand on, each fine or missing, a missing one with a sentence and the place that fixes it.
 * Pure — the facts come in, the list comes out; the clock is `facts.now`.
 */
import { describe, expect, it } from "vitest";
import { OMS_FRESH_H, missingCount, numbersReadiness, omsFresh, omsPullAgeHours, type SourceFacts } from "@/core/numbers-readiness";

const NOW = "2026-11-22T12:00:00.000Z";
const GOOD: SourceFacts = { now: NOW, metaLinked: true, spendYesterday: true, omsLinked: true, omsLastPullAt: "2026-11-22T11:00:00.000Z", productsWithoutBreakeven: 0, unmappedFolders: 0, productsWithoutName: 0, stockFresh: true };
const item = (f: SourceFacts, key: string) => numbersReadiness(f).find((i) => i.key === key)!;

describe("numbersReadiness", () => {
  it("lists the five things in the order of the plan; with everything there, nothing is missing and no button is offered", () => {
    const list = numbersReadiness(GOOD);
    expect(list.map((i) => i.key)).toEqual(["spend", "orders", "breakeven", "names", "stock"]);
    expect(list.every((i) => i.ok)).toBe(true);
    expect(list.every((i) => i.action === null)).toBe(true);
    expect(missingCount(list)).toBe(0);
  });

  it("the spend: no row for yesterday — Meta not linked says so and offers the link; linked says it was not recorded and offers nothing to press", () => {
    expect(item({ ...GOOD, spendYesterday: false, metaLinked: false }, "spend")).toMatchObject({ ok: false, text: "الصرف ناقص: ميتا مش مربوطة، وClaude ما بعت أرقام أمس", action: { label: "اربط ميتا", href: "/settings/connections" } });
    expect(item({ ...GOOD, spendYesterday: false }, "spend")).toMatchObject({ ok: false, action: null });
  });

  it("the orders: fresh under three hours; older says how old, never pulled says that, not linked says that", () => {
    expect(OMS_FRESH_H).toBe(3);
    expect(item({ ...GOOD, omsLastPullAt: "2026-11-22T09:01:00.000Z" }, "orders").ok).toBe(true); // 2h59
    expect(item({ ...GOOD, omsLastPullAt: "2026-11-22T09:00:00.000Z" }, "orders").ok).toBe(false); // exactly 3h: stale
    expect(item({ ...GOOD, omsLastPullAt: "2026-11-22T03:00:00.000Z" }, "orders").text).toBe("الطلبات قديمة: آخر سحب من نظام الطلبات قبل 9 ساعات");
    expect(item({ ...GOOD, omsLastPullAt: null }, "orders").text).toBe("الطلبات ناقصة: ما سحبنا من نظام الطلبات لسا");
    expect(item({ ...GOOD, omsLinked: false, omsLastPullAt: null }, "orders").text).toBe("الطلبات ناقصة: نظام الطلبات مش مربوط");
    expect(item({ ...GOOD, omsLastPullAt: null }, "orders").action).toEqual({ label: "افتح الربط", href: "/settings/connections" });
    expect(omsPullAgeHours({ now: NOW, omsLastPullAt: "2026-11-22T10:30:00.000Z" })).toBe(1.5);
    expect(omsFresh({ now: NOW, omsLastPullAt: null })).toBe(false);
  });

  it("the break-even points: the count of products without one, singular and plural, with the button that writes them", () => {
    expect(item({ ...GOOD, productsWithoutBreakeven: 5 }, "breakeven")).toMatchObject({ ok: false, text: "5 منتجات بلا نقطة تعادل — اللون والحكم واقفين عليهم", action: { label: "اكتبها", href: "/settings/rules#campaign-rules" } });
    expect(item({ ...GOOD, productsWithoutBreakeven: 1 }, "breakeven").text).toBe("1 منتج بلا نقطة تعادل — اللون والحكم واقفين عليهم");
  });

  it("the names: folders with no product are one count (not a wall of names); else products with no Arabic name", () => {
    expect(item({ ...GOOD, unmappedFolders: 24 }, "names")).toMatchObject({ ok: false, text: "24 مجلد درايف ما إلهم منتج — اربطهم", action: { label: "اربطهم", href: "/settings/products" } });
    expect(item({ ...GOOD, productsWithoutName: 2 }, "names").text).toBe("2 منتجات بلا اسم عربي");
    expect(item({ ...GOOD, productsWithoutName: 1 }, "names").text).toBe("1 منتج بلا اسم عربي");
  });

  it("the stock comes from Claude: when it is missing the sentence says so and nothing the owner presses fixes it", () => {
    expect(item({ ...GOOD, stockFresh: false }, "stock")).toMatchObject({ ok: false, text: "ما في مخزون مسجّل — Claude لسا ما بعته", action: null });
  });

  it("everything missing: five missing items, each with its own sentence — the card the home draws instead of four dashes", () => {
    const none: SourceFacts = { now: NOW, metaLinked: false, spendYesterday: false, omsLinked: false, omsLastPullAt: null, productsWithoutBreakeven: 5, unmappedFolders: 24, productsWithoutName: 0, stockFresh: false };
    const list = numbersReadiness(none);
    expect(missingCount(list)).toBe(5);
    expect(new Set(list.map((i) => i.text)).size).toBe(5);
  });
});
