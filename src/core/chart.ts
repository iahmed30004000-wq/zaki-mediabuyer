/**
 * THE MATHS OF THE DRAWINGS (docs/rebuild-v6/03-look.md §7): where a number lands on a picture. Pure and exact, no React, no DOM, no libraries —
 * `Sparkline` and `TrendChart` only turn what is returned here into SVG. The picture never decides what a number is, only where it sits.
 *
 * In an Arabic page the OLDEST day is at the right and today at the left: `linePoints` mirrors by default (`rtl: true`).
 */

/** The straight line that maps `domain` onto `range` (both can run backwards: a screen's y grows downwards). A flat domain maps to the middle of the range. */
export function scaleLinear(domain: readonly [number, number], range: readonly [number, number]): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  if (d0 === d1) return () => (r0 + r1) / 2;
  const k = (r1 - r0) / (d1 - d0);
  return (value) => r0 + (value - d0) * k;
}

/** A number that can be drawn (null, undefined and NaN are a gap, never a zero). */
export const isDrawable = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** The lowest and highest drawable value, or null when there is none. */
export function extent(values: readonly (number | null | undefined)[]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!isDrawable(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo === Infinity ? null : [lo, hi];
}

export interface LinePoint {
  /** the index of the value in the series (0 = the oldest) */
  i: number;
  v: number;
  x: number;
  y: number;
}

export interface LineOptions {
  width: number;
  height: number;
  /** space kept free on each side (so a round end point or a label is not cut) */
  padX?: number | { start: number; end: number };
  padY?: number | { top: number; bottom: number };
  /** the values the vertical axis must cover (default: the series itself); a break-even line outside the series stretches it */
  domain?: readonly [number, number];
  /** oldest at the right (an Arabic page). Default true. */
  rtl?: boolean;
}

const sidesX = (p: LineOptions["padX"]): [number, number] => (typeof p === "object" ? [p.start, p.end] : [p ?? 0, p ?? 0]);
const sidesY = (p: LineOptions["padY"]): [number, number] => (typeof p === "object" ? [p.top, p.bottom] : [p ?? 0, p ?? 0]);

/**
 * The points of a series, in pixels. A gap (null) splits the line into separate runs, so the picture never joins two days across a day with no number.
 * With `rtl` the first value is at the right edge and the last at the left. A single value is placed in the middle of the width.
 * `padX.start` is the space at the inline start (the right in RTL), `padX.end` at the inline end.
 */
export function linePoints(values: readonly (number | null | undefined)[], opts: LineOptions): { runs: LinePoint[][]; yOf: (v: number) => number; xOf: (i: number) => number; domain: [number, number] } {
  const { width, height, rtl = true } = opts;
  const [padStart, padEnd] = sidesX(opts.padX);
  const [padTop, padBottom] = sidesY(opts.padY);
  const found = opts.domain ? ([Math.min(...opts.domain), Math.max(...opts.domain)] as [number, number]) : (extent(values) ?? [0, 1]);
  const own = extent(values);
  const domain: [number, number] = opts.domain && own ? [Math.min(found[0], own[0]), Math.max(found[1], own[1])] : found;
  const yOf = scaleLinear(domain, [height - padBottom, padTop]);
  const n = values.length;
  // the inline start edge is the right in RTL
  const first = rtl ? width - padStart : padStart;
  const last = rtl ? padEnd : width - padEnd;
  const xOf = n <= 1 ? () => (first + last) / 2 : scaleLinear([0, n - 1], [first, last]);

  const runs: LinePoint[][] = [];
  let cur: LinePoint[] = [];
  values.forEach((v, i) => {
    if (isDrawable(v)) cur.push({ i, v, x: round(xOf(i)), y: round(yOf(v)) });
    else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  });
  if (cur.length) runs.push(cur);
  return { runs, yOf, xOf, domain };
}

const round = (n: number): number => Math.round(n * 100) / 100;

/** `M x y L x y …` for one run of points ("" for none). */
export function pathOf(run: readonly Pick<LinePoint, "x" | "y">[]): string {
  return run.map((p, k) => `${k === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
}

/** The filled area under a run, down to `baseline` (a y in pixels). A run of one point has no area. */
export function areaOf(run: readonly Pick<LinePoint, "x" | "y">[], baseline: number): string {
  if (run.length < 2) return "";
  const a = run[0]!;
  const z = run[run.length - 1]!;
  return `${pathOf(run)} L${z.x} ${baseline} L${a.x} ${baseline} Z`;
}

/**
 * «Nice» tick values covering [min, max]: 1, 2, 2.5 or 5 times a power of ten, about `count` of them (the classic algorithm). Always sorted
 * ascending, always covers the range (the first tick is <= min and the last >= max). A flat range (min = max) gets one step either side.
 */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (lo === hi) {
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1;
    lo -= pad;
    hi += pad;
  }
  const want = Math.max(2, Math.floor(count));
  const rough = (hi - lo) / (want - 1);
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(lo / step + 1e-9) * step;
  const end = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let t = start, k = 0; t <= end + step / 1e6 && k < 100; t += step, k++) ticks.push(clean(t, step));
  return ticks;
}

/** Floating-point dust off a tick (0.30000000000000004 → 0.3). */
function clean(t: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 2);
  return Number(t.toFixed(Math.min(decimals, 10)));
}

/** The last `n` values of a series (the sparkline draws 14). Fewer values than `n` are all kept, in order. */
export const lastN = <T>(values: readonly T[], n: number): T[] => (n >= values.length ? [...values] : values.slice(values.length - n));
