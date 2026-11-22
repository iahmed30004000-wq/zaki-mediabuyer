/**
 * «كنا ← صرنا» (v6 · P5, docs/rebuild-v6/04-numbers.md §2–§4) — pure. For the numbers of the home (and, later, the numbers screens): the value NOW (the window), the value
 * WAS (the window of the same length right before it), the difference in WORDS and whether the direction is good for THIS number. The code decides every word and every colour:
 * a screen only draws what is returned. No formula of `economics.ts` or `numbers.ts` is touched here — a value is read from a `NumbersSet` that those already computed.
 *
 * What is never done: a zero is never made up for a missing number (it is `null` with a REASON), «كنا» of zero or missing gives no difference, and a change under 1% (half a
 * point for a rate) is «متل ما هو» — grey, not green or red.
 */
import type { TermKey } from "@/lib/glossary";
import { addDays, ammanKey, eachDay, isKey, type Range } from "./dates";
import { sourceAfter } from "./freshness";
import { DEFAULT_CONFIRM_WINDOW_H } from "./maturity";
import type { NumbersSet, SetKey } from "./numbers";
import { omsFresh, omsPullAgeHours, type SourceFacts } from "./numbers-readiness";
import { productVerdict, type Verdict } from "./verdict";

export const METRIC_KEYS = ["realCost", "orders", "confirmRate", "spend", "costPerConfirmed", "deliveredRate"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
export type MetricUnit = "usd" | "count" | "pct";
export type Tone = "good" | "bad" | "flat";

/** What kind of number it is decides the WORD of the difference: a cost is cheaper/dearer, a count more/fewer, a rate better/worse, the spend grew/fell. */
type Kind = "cost" | "count" | "rate" | "spend";

interface MetricDef {
  label: string;
  unit: MetricUnit;
  kind: Kind;
  /** the number in the `NumbersSet` the window computed */
  set: SetKey;
  /** a per-day figure: the window's total over its days («طلبات حقيقية باليوم») */
  perDay: boolean;
  /** the entry in the glossary — the «ليش؟» */
  term: TermKey;
  /** where it comes from: the OMS (حقيقي) or Meta */
  source: "real" | "meta";
}

/**
 * The six numbers that have a comparison (04-numbers.md §3). The first four are the tiles of the home and the summary. `deliveredRate` is the 30-day delivery rate of the
 * products (it is never a window of its own), so the two windows hold the same figure until the products' own screens read it per product.
 */
export const METRICS: Record<MetricKey, MetricDef> = {
  realCost: { label: "تكلفة الطلب الحقيقي", unit: "usd", kind: "cost", set: "costPerOrder", perDay: false, term: "costPerOrder", source: "real" },
  orders: { label: "طلبات حقيقية باليوم", unit: "count", kind: "count", set: "ordersIn", perDay: true, term: "realOrders", source: "real" },
  confirmRate: { label: "نسبة التأكيد", unit: "pct", kind: "rate", set: "confirmRate", perDay: false, term: "confirmRateDay", source: "real" },
  spend: { label: "الصرف باليوم", unit: "usd", kind: "spend", set: "spend", perDay: true, term: "spend", source: "meta" },
  costPerConfirmed: { label: "تكلفة المؤكد", unit: "usd", kind: "cost", set: "costPerConfirmed", perDay: false, term: "costPerConfirmed", source: "real" },
  deliveredRate: { label: "نسبة التسليم", unit: "pct", kind: "rate", set: "deliveryRate30", perDay: false, term: "deliveryRate30", source: "real" },
};

/** The four tiles of the home, in order. */
export const HOME_METRICS: readonly MetricKey[] = ["realCost", "orders", "confirmRate", "spend"];

const r1 = (n: number) => Math.round(n * 10) / 10;

/** «نقطة» · «نقطتين» · «7 نقاط» · «11 نقطة». */
export function pointsWords(n: number): string {
  const k = Math.max(1, Math.round(Math.abs(n)));
  return k === 1 ? "نقطة" : k === 2 ? "نقطتين" : k < 11 ? `${k} نقاط` : `${k} نقطة`;
}

/** The change of a rate is under half a point, the change of anything else under one percent: it is «متل ما هو». */
const FLAT = { points: 0.5, pct: 1 } as const;

/**
 * The difference between «صرنا» and «كنا» in words, and its colour from the direction that is good for THIS number — never from the sign.
 *  rates   — by POINTS: 50% → 57% is «أحسن 7 نقاط»
 *  others  — by percent of «كنا»: «أرخص 13%» (a cost) · «أكتر 19%» (a count) · «زاد 7%» (the spend, always grey)
 * «كنا» of zero or missing (or «صرنا» missing) gives no difference: null. A change under the flat limit is «متل ما هو».
 */
export function deltaWords(key: MetricKey, now: number | null | undefined, was: number | null | undefined): { words: string; tone: Tone } | null {
  if (now === null || now === undefined || was === null || was === undefined || Number.isNaN(now) || Number.isNaN(was)) return null;
  const def = METRICS[key];
  const same = { words: "متل ما هو", tone: "flat" as const };
  if (def.kind === "rate") {
    const d = now - was;
    if (Math.abs(d) < FLAT.points) return same;
    return d > 0 ? { words: `أحسن ${pointsWords(d)}`, tone: "good" } : { words: `أسوأ ${pointsWords(d)}`, tone: "bad" };
  }
  if (was === 0) return null;
  const pct = ((now - was) / Math.abs(was)) * 100;
  if (Math.abs(pct) < FLAT.pct) return same;
  const n = Math.round(Math.abs(pct));
  const up = pct > 0;
  if (def.kind === "cost") return up ? { words: `أغلى ${n}%`, tone: "bad" } : { words: `أرخص ${n}%`, tone: "good" };
  if (def.kind === "count") return up ? { words: `أكتر ${n}%`, tone: "good" } : { words: `أقل ${n}%`, tone: "bad" };
  return { words: `${up ? "زاد" : "نزل"} ${n}%`, tone: "flat" };
}

export interface WasNow {
  key: MetricKey;
  label: string;
  unit: MetricUnit;
  now: number | null;
  was: number | null;
  /** null when either side is missing */
  delta: { abs: number; pct: number | null; points: number | null } | null;
  /** green · red · grey — from the good direction of this number, not from the sign */
  tone: Tone;
  /** «أرخص 13%» · «أكتر 19%» · «أحسن 7 نقاط» … */
  words: string | null;
  source: "real" | "meta" | "estimate";
  /** why the number is missing, in a sentence («ميتا مش مربوطة»); null when it is there */
  missing: string | null;
  /** the last day of the window has orders that have not matured yet: the rate can still move */
  provisional: boolean;
  /** the entry in the glossary — the «ليش؟» */
  term: TermKey;
  /** decimals to write the figure with (an average of a day is «402$» and «118», a small one «4.7»); undefined: the usual writing of its unit */
  digits?: number;
  /** the day by day values, the oldest first (null for a day without a number). P6 fills it; until then it is empty and the tile draws no line. */
  series: (number | null)[];
}

/** The value of a metric in a window: a per-day figure is the window's total over its days; anything else is read as it is. */
export function valueOf(key: MetricKey, set: Pick<NumbersSet, SetKey>, days: number): number | null {
  const def = METRICS[key];
  const v = set[def.set];
  if (v === null || v === undefined) return null;
  return def.perDay ? r1(v / Math.max(1, days)) : v;
}

/** The latest Amman day whose orders have all matured (a day matures `windowHours` after it ends: an order from 23:50 is settled the day after tomorrow's midnight). */
export function matureThrough(now: Date, windowHours = DEFAULT_CONFIRM_WINDOW_H): string {
  return addDays(ammanKey(new Date(now.getTime() - windowHours * 3_600_000)), -1);
}

/**
 * How many decimals the two figures of a tile are written with — one rule for «صرنا» and «كنا» so they read alike: the spend of a day is a whole number once it is a hundred or more,
 * the orders of a day are whole once both are ten or more (4.7 a day must not read as 5 — the difference would not make sense). Everything else is written as its unit usually is.
 */
export function digitsOf(key: MetricKey, now: number | null, was: number | null): number | undefined {
  const big = (limit: number) => (now === null || Math.abs(now) >= limit) && (was === null || Math.abs(was) >= limit);
  if (key === "spend") return big(100) ? 0 : 2;
  if (key === "orders") return big(10) ? 0 : 1;
  return undefined;
}

/** Why a number is missing, in a sentence: the source it stands on is not there, or the window holds nothing. Null when there is nothing to say. */
export function missingReason(key: MetricKey, set: Pick<NumbersSet, SetKey>, facts: SourceFacts): string | null {
  const spendMissing = set.spend === null;
  const ordersMissing = set.ordersIn === null;
  const noSpend = facts.metaLinked ? "ما في صرف مسجّل للفترة" : "ميتا مش مربوطة";
  const noOrders = !facts.omsLinked ? "نظام الطلبات مش مربوط" : !omsFresh(facts) ? (omsPullAgeHours(facts) === null ? "ما سحبنا من نظام الطلبات لسا" : "نظام الطلبات ما انسحب من فترة") : "ما في طلبات بالفترة";
  switch (key) {
    case "spend":
      return spendMissing ? noSpend : null;
    case "orders":
      return ordersMissing ? noOrders : null;
    case "realCost":
      return spendMissing ? noSpend : ordersMissing ? noOrders : set.costPerOrder === null ? "ما في طلبات بالفترة" : null;
    case "confirmRate":
      return set.confirmRate !== null ? null : ordersMissing ? noOrders : "المرفوض مش معروف لنظام الطلبات";
    case "costPerConfirmed":
      return spendMissing ? noSpend : set.confirmed === null ? (ordersMissing ? noOrders : "المؤكد مش معروف") : set.costPerConfirmed === null ? "ما في طلبات مؤكدة بالفترة" : null;
    case "deliveredRate":
      return set.deliveryRate30 === null ? "ما في شحنات انحسمت" : null;
  }
}

/**
 * One tile: the window and the one before it in, the words and the colour out. `facts.now` is the clock for «مبدئي»; `days` is the length of both windows (for the per-day figures);
 * `toDay` is the last day of the window (an Amman date) — the rates that count confirmations are provisional while that day's orders can still be confirmed.
 */
export function wasNow(key: MetricKey, cur: Pick<NumbersSet, SetKey>, prev: Pick<NumbersSet, SetKey>, series: (number | null)[], facts: SourceFacts, window: { days: number; toDay: string }): WasNow {
  const def = METRICS[key];
  const now = valueOf(key, cur, window.days);
  const was = valueOf(key, prev, window.days);
  const d = deltaWords(key, now, was);
  const delta = now === null || was === null ? null : { abs: Math.round((now - was) * 100) / 100, pct: def.kind === "rate" || was === 0 ? null : r1(((now - was) / Math.abs(was)) * 100), points: def.kind === "rate" ? r1(now - was) : null };
  const confirms = key === "confirmRate" || key === "costPerConfirmed";
  return {
    key,
    label: def.label,
    unit: def.unit,
    now,
    was,
    delta,
    tone: d?.tone ?? "flat",
    words: d?.words ?? null,
    // R-23: a figure from the OMS is «تقدير» the moment the OMS goes quiet (`freshness.ts` owns the rule)
    source: sourceAfter(def.source, facts),
    missing: now === null ? missingReason(key, cur, facts) : null,
    provisional: confirms && now !== null && window.toDay > matureThrough(new Date(facts.now)),
    term: def.term,
    ...(digitsOf(key, now, was) !== undefined ? { digits: digitsOf(key, now, was) as number } : {}),
    series,
  };
}

/** All the tiles of the home for a window and the one before it. `series` (P6): the 30 days of each metric, when the screen has read them. */
export function homeTiles(cur: Pick<NumbersSet, SetKey>, prev: Pick<NumbersSet, SetKey>, facts: SourceFacts, window: { days: number; toDay: string }, series: Partial<Record<MetricKey, (number | null)[]>> = {}): WasNow[] {
  return HOME_METRICS.map((k) => wasNow(k, cur, prev, series[k] ?? [], facts, window));
}

// ───────────────────────────── the period of the numbers screens (P6) ─────────────────────────────

/** «أمس مقابل اللي قبله» · «آخر 7 أيام» (the default) · «آخر 30 يوم» · a range written in the address. */
export const PERIODS = ["1", "7", "30", "custom"] as const;
export type PeriodKey = (typeof PERIODS)[number];
export const PERIOD_AR: Record<PeriodKey, string> = { "1": "أمس مقابل اللي قبله", "7": "آخر 7 أيام", "30": "آخر 30 يوم", custom: "مخصص" };
/** The longest range the comparison takes: the window before it must fit in the days the data reads. */
export const MAX_PERIOD_DAYS = 45;

/**
 * `?p=1|7|30|custom&from=…&to=…` → the window. It ALWAYS ends yesterday at the latest: today is unfinished and never takes part in a comparison («اليوم لهلق» is shown on its own, without a
 * difference). Anything unreadable is the last seven days. A custom range is put in order, cut at yesterday and capped; the window before it is `previousRange` of the result (same length).
 */
export function comparePeriod(q: { p?: string | null; from?: string | null; to?: string | null }, now: Date): Range & { period: PeriodKey } {
  const yesterday = addDays(ammanKey(now), -1);
  const mk = (period: PeriodKey, days: number, to = yesterday) => ({ key: "custom" as const, from: addDays(to, -(days - 1)), to, days, period });
  if (q.p === "1") return mk("1", 1);
  if (q.p === "30") return mk("30", 30);
  if (q.p === "custom" && isKey(q.from) && isKey(q.to)) {
    let [from, to] = q.from <= q.to ? [q.from, q.to] : [q.to, q.from];
    if (to > yesterday) to = yesterday;
    if (from > to) from = to;
    const days = eachDay(from, to).length;
    return days > MAX_PERIOD_DAYS ? mk("custom", MAX_PERIOD_DAYS, to) : { key: "custom", from, to, days, period: "custom" };
  }
  return mk("7", 7);
}

/** The query string that gives a window back (`""` for the default seven days): a link from one numbers screen to another keeps the period. */
export function periodQuery(w: { period: PeriodKey; from: string; to: string }): string {
  return w.period === "7" ? "" : w.period === "custom" ? `p=custom&from=${w.from}&to=${w.to}` : `p=${w.period}`;
}

// ───────────────────────────── a day-by-day line (P6) ─────────────────────────────

/**
 * One value of a metric for ONE day: the same figure as a tile, over a window of a day (`valueOf` with one day). `costPerConfirmed` of a day whose orders have not matured is
 * null — a rate that can still move is never drawn as a fact (R-15) — and so is every figure that is not there (a gap in the line, never a zero).
 */
export function seriesValue(key: MetricKey, day: string, set: Pick<NumbersSet, SetKey> | null, now: Date): number | null {
  if (!set) return null;
  if (key === "costPerConfirmed" && day > matureThrough(now)) return null;
  return valueOf(key, set, 1);
}

/** The line of `days` days ending at `toDay` (the oldest first): `setOf(day)` is the numbers of that day, or null when the day has none. */
export function seriesOf(key: MetricKey, toDay: string, days: number, setOf: (day: string) => Pick<NumbersSet, SetKey> | null, now: Date): (number | null)[] {
  return eachDay(addDays(toDay, -(days - 1)), toDay).map((d) => seriesValue(key, d, setOf(d), now));
}

// ───────────────────────────── a product: «كل منتج: كنا وصرنا» (P6) ─────────────────────────────

export interface ProductCompare {
  code: string;
  name: string;
  /** the cost of a real order: now, was, the words */
  cost: WasNow;
  /** the real orders of a day: now, was, the words */
  orders: WasNow;
  /** the word about the cost against the owner's own numbers: from `productVerdict`, nothing of its own */
  verdict: Verdict;
  /** the owner's break-even for this product, null until he writes it */
  breakeven: number | null;
}

/** The products, each with the two numbers of its row and its verdict. A product with nothing in the window is left out; the order is the one given (the loader sorts by the spend). */
export function productCompares(
  products: readonly { code: string; name: string; current: Pick<NumbersSet, SetKey>; prev: Pick<NumbersSet, SetKey>; breakeven: number | null; hasData: boolean }[],
  target: number | null,
  facts: SourceFacts,
  window: { days: number; toDay: string },
): ProductCompare[] {
  return products
    .filter((p) => p.hasData)
    .map((p) => ({
      code: p.code,
      name: p.name,
      cost: wasNow("realCost", p.current, p.prev, [], facts, window),
      orders: wasNow("orders", p.current, p.prev, [], facts, window),
      verdict: productVerdict(p.current.costPerOrder, target, p.breakeven),
      breakeven: p.breakeven,
    }));
}

// ───────────────────────────── the road of an order, out of every 100 (P6) ─────────────────────────────

export interface FunnelStepCompare {
  key: "in" | "confirmed" | "shipped" | "delivered";
  label: string;
  /** how many of every 100 orders that came in reached this step (the first is 100); null when it is not known */
  now: number | null;
  was: number | null;
  /** «أحسن 7 نقاط» · «أسوأ 3 نقاط» · «متل ما هو»; null with no «كنا» */
  words: string | null;
  tone: Tone;
}

type FunnelSet = Pick<NumbersSet, "ordersIn" | "confirmed" | "shippedOrders" | "delivered">;

/** Of every 100 orders: how many were confirmed, shipped, delivered — this window against the one before. The code divides; a step with no orders to divide is null, never 0. */
export function funnelCompare(cur: FunnelSet, prev: FunnelSet): FunnelStepCompare[] {
  const per100 = (n: number | null, of: number | null): number | null => (n === null || of === null || of <= 0 ? null : r1((n * 100) / of));
  const step = (key: FunnelStepCompare["key"], label: string, pick: (s: FunnelSet) => number | null): FunnelStepCompare => {
    const first = key === "in";
    const now = first ? (cur.ordersIn !== null && cur.ordersIn > 0 ? 100 : null) : per100(pick(cur), cur.ordersIn);
    const was = first ? (prev.ordersIn !== null && prev.ordersIn > 0 ? 100 : null) : per100(pick(prev), prev.ordersIn);
    // a share is read in points: «أحسن 7 نقاط»
    const d = first ? null : deltaWords("confirmRate", now, was);
    return { key, label, now, was, words: d?.words ?? null, tone: d?.tone ?? "flat" };
  };
  return [step("in", "دخل", (s) => s.ordersIn), step("confirmed", "تأكّد", (s) => s.confirmed), step("shipped", "انشحن", (s) => s.shippedOrders), step("delivered", "تسلّم", (s) => s.delivered)];
}

// ───────────────────────────── any of the 31 numbers of a product (P6) ─────────────────────────────

/** What `STATS` says about a number that the difference needs: its unit and which way is good. */
export interface StatLike {
  unit: "$" | "%" | "" | "يوم";
  good: "up" | "down" | "none";
}

/**
 * The difference of ANY number in words, from its unit and its good direction (the six of `deltaWords` have their own kinds; the other 25 of the product screen come here): a share is read in points,
 * the rest by percent of «كنا»; a cost in dollars is «أرخص/أغلى», a count or an average «أكتر/أقل», a number with no good direction «زاد/نزل» in grey. «كنا» of zero or missing gives no difference; a change
 * under one percent (half a point for a share) is «متل ما هو». The colour comes from the good direction, never from the sign.
 */
export function statDelta(def: StatLike, now: number | null | undefined, was: number | null | undefined): { words: string; tone: Tone } | null {
  if (now === null || now === undefined || was === null || was === undefined || Number.isNaN(now) || Number.isNaN(was)) return null;
  const same = { words: "متل ما هو", tone: "flat" as const };
  const toneOf = (up: boolean): Tone => (def.good === "none" ? "flat" : up === (def.good === "up") ? "good" : "bad");
  if (def.unit === "%") {
    const d = now - was;
    if (Math.abs(d) < FLAT.points) return same;
    const up = d > 0;
    const word = def.good === "none" ? (up ? "زاد" : "نزل") : up === (def.good === "up") ? "أحسن" : "أسوأ";
    return { words: `${word} ${pointsWords(d)}`, tone: toneOf(up) };
  }
  if (was === 0) return null;
  const pct = ((now - was) / Math.abs(was)) * 100;
  if (Math.abs(pct) < FLAT.pct) return same;
  const n = Math.round(Math.abs(pct));
  const up = pct > 0;
  const word = def.good === "none" ? (up ? "زاد" : "نزل") : def.unit === "$" && def.good === "down" ? (up ? "أغلى" : "أرخص") : up ? "أكتر" : "أقل";
  return { words: `${word} ${n}%`, tone: toneOf(up) };
}

/** Why one of the 31 numbers is missing, by the group it is in: the ads' and the cost's stand on the spend, the others on the orders. */
export function statMissing(group: string, set: Pick<NumbersSet, SetKey>, facts: SourceFacts): string {
  if (group === "ads" || group === "cost") {
    const spend = missingReason("spend", set, facts);
    if (spend) return spend;
  }
  if (group !== "ads" && group !== "stock") {
    const orders = missingReason("orders", set, facts);
    if (orders) return orders;
  }
  return group === "stock" ? "Claude لسا ما بعت المخزون" : "ما في رقم للفترة";
}
