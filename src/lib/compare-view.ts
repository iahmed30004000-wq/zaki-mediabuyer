/**
 * «وين كنا وكيف صرنا» as the home reads it (v6 · P5, docs/rebuild-v6/04-numbers.md §4): the last seven COMPLETE days against the seven before them. The window ends at yesterday — an
 * unfinished day never takes part in a comparison — and every number is the one `computeSet` already computed (`loadNumbers`): this file gathers and hands over, `src/core/compare.ts`
 * decides the words and the colours.
 *
 * `loadNumbers` returns the window AND the window before it of the same length (`totals.current` / `totals.prev`), so one call is enough — it is not called twice.
 * The tiles carry no day-by-day line yet (`series` is empty): `loadSeries` is the numbers phase (P6).
 */
import { addDays, ammanKey, parseRange, previousRange, type Range } from "@/core/dates";
import { homeTiles, type WasNow } from "@/core/compare";
import { numbersReadiness, type ReadinessItem, type SourceFacts } from "@/core/numbers-readiness";
import { loadNumbers } from "./numbers-view";
import { loadSourceFacts } from "./source-facts";

export interface CompareData {
  demo: boolean;
  /** the window and the one before it */
  range: Range;
  prev: { from: string; to: string };
  tiles: WasNow[];
  facts: SourceFacts;
  /** what the numbers need, and which of it is missing */
  readiness: ReadinessItem[];
  /** none of the four tiles has a number: the home draws the readiness card instead of four dashes */
  allMissing: boolean;
}

/** The window of the home: seven days ending yesterday. */
export function homeRange(now: Date): Range {
  const today = ammanKey(now);
  return parseRange({ d: "custom", from: addDays(today, -7), to: addDays(today, -1) }, now);
}

export async function loadCompare(opts: { now?: Date } = {}): Promise<CompareData> {
  const now = opts.now ?? new Date();
  const range = homeRange(now);
  const numbers = await loadNumbers({ d: "custom", from: range.from, to: range.to }, now);
  const facts = await loadSourceFacts({ now, products: numbers.products });
  const tiles = homeTiles(numbers.totals.current, numbers.totals.prev, facts, { days: range.days, toDay: range.to });
  return { demo: numbers.demo, range, prev: previousRange(range), tiles, facts, readiness: numbersReadiness(facts), allMissing: tiles.every((t) => t.now === null) };
}
