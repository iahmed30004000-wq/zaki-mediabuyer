/**
 * «شو ناقص لتطلع الأرقام» (v6 · P5, docs/rebuild-v6/04-numbers.md §6) — pure. The facts about where the numbers come from go in (`SourceFacts`, read once by
 * `loadSourceFacts()` and handed to every screen), the list of what is there and what is missing comes out, each missing one with a sentence that says WHAT is missing
 * and the place that fixes it. A tile never says «—» and keeps quiet: it says why, and when all of them are missing the home draws this list instead of four dashes.
 * Nothing here reads a clock or a table: the clock is `facts.now`.
 */
import { agoWords } from "./bell";

/** What the numbers stand on — the same object feeds the home, the numbers screens and (for the owner) the health answer. */
export interface SourceFacts {
  /** ISO — the moment the facts were read */
  now: string;
  /** a Meta read token is there (the spend can be pulled) */
  metaLinked: boolean;
  /** a spend row exists for yesterday (from Meta or pushed by Claude) */
  spendYesterday: boolean;
  /** the OMS address and token are there */
  omsLinked: boolean;
  /** ISO — the last REAL pull of the OMS (a skipped or backed-off slot is not a pull); null: never */
  omsLastPullAt: string | null;
  /** products that have numbers in the window but no break-even point */
  productsWithoutBreakeven: number;
  /** drive folders (found by the last library read) that belong to no product */
  unmappedFolders: number;
  /** products that have numbers but no Arabic name */
  productsWithoutName: number;
  /** a stock reading from the last 24 hours exists */
  stockFresh: boolean;
}

/** The OMS pull is «fresh» for this many hours (the same limit the health rule uses: after it every OMS figure is an estimate). */
export const OMS_FRESH_H = 3;

export interface ReadinessItem {
  key: "spend" | "orders" | "breakeven" | "names" | "stock";
  ok: boolean;
  /** what is missing, in a sentence; when it is fine, what is fine */
  text: string;
  /** the button that fixes it (an address inside the site), or null when nothing the owner presses fixes it */
  action: { label: string; href: string } | null;
}

/** Hours since the last OMS pull, or null when there never was one. */
export function omsPullAgeHours(f: Pick<SourceFacts, "now" | "omsLastPullAt">): number | null {
  if (!f.omsLastPullAt) return null;
  const ms = Date.parse(f.now) - Date.parse(f.omsLastPullAt);
  return Number.isFinite(ms) ? Math.max(0, ms / 3_600_000) : null;
}

/** The OMS pull is recent enough for its figures to be called real. */
export const omsFresh = (f: Pick<SourceFacts, "now" | "omsLastPullAt">): boolean => {
  const h = omsPullAgeHours(f);
  return h !== null && h < OMS_FRESH_H;
};

const LINK = "/settings/connections";

/** The five things the numbers need, in the order of the plan (04-numbers.md §6). */
export function numbersReadiness(f: SourceFacts): ReadinessItem[] {
  const spend: ReadinessItem = f.spendYesterday
    ? { key: "spend", ok: true, text: "الصرف: في أرقام لأمس", action: null }
    : {
        key: "spend",
        ok: false,
        text: f.metaLinked ? "الصرف ناقص: ما في صرف مسجّل لأمس، وClaude ما بعت أرقام" : "الصرف ناقص: ميتا مش مربوطة، وClaude ما بعت أرقام أمس",
        action: f.metaLinked ? null : { label: "اربط ميتا", href: LINK },
      };

  const age = omsPullAgeHours(f);
  const orders: ReadinessItem = omsFresh(f)
    ? { key: "orders", ok: true, text: `الطلبات: آخر سحب من نظام الطلبات ${agoWords((age ?? 0) * 60)}`, action: null }
    : {
        key: "orders",
        ok: false,
        text: !f.omsLinked ? "الطلبات ناقصة: نظام الطلبات مش مربوط" : age === null ? "الطلبات ناقصة: ما سحبنا من نظام الطلبات لسا" : `الطلبات قديمة: آخر سحب من نظام الطلبات ${agoWords(age * 60)}`,
        action: { label: "افتح الربط", href: LINK },
      };

  const breakeven: ReadinessItem =
    f.productsWithoutBreakeven === 0
      ? { key: "breakeven", ok: true, text: "نقاط التعادل: مكتوبة لكل منتج شغّال", action: null }
      : { key: "breakeven", ok: false, text: `${f.productsWithoutBreakeven} ${f.productsWithoutBreakeven === 1 ? "منتج بلا نقطة تعادل" : "منتجات بلا نقطة تعادل"} — اللون والحكم واقفين عليهم`, action: { label: "اكتبها", href: "/settings/rules#campaign-rules" } };

  const names: ReadinessItem =
    f.unmappedFolders === 0 && f.productsWithoutName === 0
      ? { key: "names", ok: true, text: "أسماء المنتجات: كل رمز إله اسم", action: null }
      : {
          key: "names",
          ok: false,
          text: f.unmappedFolders > 0 ? `${f.unmappedFolders} مجلد درايف ما إلهم منتج — اربطهم` : `${f.productsWithoutName} ${f.productsWithoutName === 1 ? "منتج بلا اسم عربي" : "منتجات بلا اسم عربي"}`,
          action: { label: "اربطهم", href: "/settings/products" },
        };

  // the stock comes from Claude: nothing the owner presses sends it
  const stock: ReadinessItem = f.stockFresh ? { key: "stock", ok: true, text: "المخزون: في قراءة من آخر 24 ساعة", action: null } : { key: "stock", ok: false, text: "ما في مخزون مسجّل — Claude لسا ما بعته", action: null };

  return [spend, orders, breakeven, names, stock];
}

/** How many of the items are missing. */
export const missingCount = (items: readonly ReadinessItem[]): number => items.filter((i) => !i.ok).length;
