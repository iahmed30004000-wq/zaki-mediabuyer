/**
 * «وين كنا وكيف صرنا» as the screens read it (v6 · P5 → P6, docs/rebuild-v6/04-numbers.md §4): a window of complete days against the window of the same length right before it. The window ends at
 * yesterday — an unfinished day never takes part in a comparison — and every number is the one `computeSet` already computed (`loadNumbers`): this file gathers and hands over,
 * `src/core/compare.ts` decides the words and the colours, `src/core/freshness.ts` decides «حقيقي» or «تقدير».
 *
 * `loadNumbers` returns the window AND the window before it of the same length (`totals.current` / `totals.prev`), so one call is enough — it is not called twice. The line of each tile is the 30 days
 * (`loadSeriesMany`, one read for all four): if it cannot be read the tiles are drawn without it — a line is a picture, never the reason a number is missing.
 */
import { addDays, ammanKey, parseRange, previousRange, type Range } from "@/core/dates";
import { comparePeriod, funnelCompare, HOME_METRICS, homeTiles, productCompares, type FunnelStepCompare, type MetricKey, type PeriodKey, type ProductCompare, type WasNow } from "@/core/compare";
import { freshness, type Freshness } from "@/core/freshness";
import { numbersReadiness, type ReadinessItem, type SourceFacts } from "@/core/numbers-readiness";
import { loadNumbers, loadSeriesMany } from "./numbers-view";
import { loadSourceFacts } from "./source-facts";

export interface CompareData {
  demo: boolean;
  /** the window and the one before it */
  range: Range;
  prev: { from: string; to: string };
  /** which of the choices of the switcher this window is */
  period: PeriodKey;
  tiles: WasNow[];
  facts: SourceFacts;
  /** where each side comes from and how old it is: the mark of the tiles, the reports and the exports */
  freshness: Freshness;
  /** what the numbers need, and which of it is missing */
  readiness: ReadinessItem[];
  /** none of the four tiles has a number: the home draws the readiness card instead of four dashes */
  allMissing: boolean;
  /** «كل منتج: كنا وصرنا» */
  products: ProductCompare[];
  /** «رحلة الطلب»: of every 100 orders, how many got to each step — now and was */
  funnel: FunnelStepCompare[];
  /** the 30 days of each tile's metric, the oldest first (empty when they could not be read) */
  series: Partial<Record<MetricKey, (number | null)[]>>;
  /** the owner's target for the cost of a real order, null until he writes it */
  target: number | null;
  /** the one break-even every product with numbers shares, or null when they differ or none is written: the red line of the chart */
  breakeven: number | null;
  /** v6 · P11: the market the numbers are filtered to (null: all), the currencies with no rate, and the products whose pushed days could not be placed */
  market?: string | null;
  missingRates?: string[];
  unplacedPushed?: string[];
}

/** The window of the home: seven days ending yesterday. */
export function homeRange(now: Date): Range {
  const today = ammanKey(now);
  return parseRange({ d: "custom", from: addDays(today, -7), to: addDays(today, -1) }, now);
}

/** The break-even a chart can draw for ALL products together: only when every product with numbers has one and they are the same figure. A line that belongs to one product is not drawn over the total. */
export function commonBreakeven(products: readonly { hasData: boolean; breakeven: number | null }[]): number | null {
  const shown = products.filter((p) => p.hasData);
  if (!shown.length || shown.some((p) => p.breakeven === null)) return null;
  const first = shown[0]!.breakeven;
  return shown.every((p) => p.breakeven === first) ? first : null;
}

export async function loadCompare(opts: { now?: Date; period?: { p?: string | null; from?: string | null; to?: string | null }; series?: boolean; market?: string | null } = {}): Promise<CompareData> {
  const now = opts.now ?? new Date();
  const { period, ...range } = comparePeriod(opts.period ?? {}, now);
  const [numbers, series] = await Promise.all([
    loadNumbers({ d: "custom", from: range.from, to: range.to, ...(opts.market ? { market: opts.market } : {}) }, now),
    opts.series === false ? Promise.resolve({}) : loadSeriesMany(HOME_METRICS, { now, ...(opts.market ? { market: opts.market } : {}) }).catch(() => ({})),
  ]);
  const read = await loadSourceFacts({ now, products: numbers.products });
  const facts = numbers.missingRates?.length ? { ...read, fxMissing: numbers.missingRates } : read;
  const window = { days: range.days, toDay: range.to };
  const lines = series as Partial<Record<MetricKey, (number | null)[]>>;
  const tiles = homeTiles(numbers.totals.current, numbers.totals.prev, facts, window, lines);
  return {
    demo: numbers.demo,
    range,
    prev: previousRange(range),
    period,
    tiles,
    facts,
    freshness: freshness(facts),
    readiness: numbersReadiness(facts),
    allMissing: tiles.every((t) => t.now === null),
    products: productCompares(numbers.products, numbers.target, facts, window),
    funnel: funnelCompare(numbers.totals.current, numbers.totals.prev),
    series: lines,
    target: numbers.target,
    breakeven: commonBreakeven(numbers.products),
    market: numbers.market ?? null,
    missingRates: numbers.missingRates ?? [],
    unplacedPushed: numbers.unplacedPushed ?? [],
  };
}
