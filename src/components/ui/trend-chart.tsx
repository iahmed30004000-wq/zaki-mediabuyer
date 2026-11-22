"use client";

import { useEffect, useRef, useState } from "react";
import { areaOf, extent, linePoints, niceTicks, pathOf } from "@/core/chart";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface TrendEvent {
  /** the day's place in `values` (0 = the oldest) */
  index: number;
  /** what we did, in a sentence — listed under the chart with the same number */
  text?: string;
}

const PAD_START = 46; // room for the numbers of the axis (the right edge: the page is Arabic)
const PAD_END = 14;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

/**
 * THE BIG CHART (docs/rebuild-v6/03-look.md §7): a line, a light grid, the break-even line (red, dashed), the target line (green, dotted), numbered circles for what we did,
 * and a bigger end point. It is drawn at the container's REAL width in pixels, never scaled, so the text is always 12. The oldest day is at the right and today at the
 * left. Every position comes from `core/chart.ts`; a day with no number is a gap, never a zero. `label` is the accessible sentence («التكلفة الحقيقية آخر 30 يوم»).
 */
export function TrendChart({
  values,
  unit = "",
  breakEven,
  target,
  events = [],
  label,
  height = 220,
  xLabels,
  className,
}: {
  values: readonly (number | null | undefined)[];
  unit?: "$" | "%" | "x" | "";
  breakEven?: number | null;
  target?: number | null;
  events?: readonly TrendEvent[];
  label: string;
  height?: number;
  /** the words under the two ends of the line: «قبل 30 يوم» · «اليوم» */
  xLabels?: { oldest: string; newest: string };
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(200, Math.floor(el.getBoundingClientRect().width)));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const covered = extent([...values, breakEven, target]);
  const ticks = covered ? niceTicks(covered[0], covered[1], 4) : [];
  const domain: [number, number] | undefined = ticks.length ? [ticks[0]!, ticks[ticks.length - 1]!] : undefined;
  const { runs, yOf, xOf } = linePoints(values, { width, height, padX: { start: PAD_START, end: PAD_END }, padY: { top: PAD_TOP, bottom: PAD_BOTTOM }, rtl: true, ...(domain ? { domain } : {}) });
  const baseline = height - PAD_BOTTOM;
  const tickText = (v: number) => fmt(v, unit, ticks.every(Number.isInteger) ? 0 : 2);
  const drawn = runs.some((r) => r.length >= 2);
  const lastPoint = runs.flat().sort((a, b) => b.i - a.i)[0];
  const left = PAD_END;
  const right = width - PAD_START + 6;

  const marks = events
    .map((e, k) => ({ n: k + 1, e, v: values[e.index] }))
    .filter((m) => typeof m.v === "number" && Number.isFinite(m.v) && m.e.index >= 0 && m.e.index < values.length);

  return (
    <figure className={cn("m-0 min-w-0", className)}>
      <div ref={box} className="min-w-0">
        {drawn ? (
          <svg role="img" aria-label={label} width={width} height={height} viewBox={`0 0 ${width} ${height}`} direction="ltr" className="block max-w-full">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={left} x2={right} y1={yOf(t)} y2={yOf(t)} className="stroke-border" strokeWidth={1} />
                <text x={width - 2} y={yOf(t) + 4} textAnchor="end" className="fill-fg-muted font-sans text-xs">
                  {tickText(t)}
                </text>
              </g>
            ))}
            {typeof breakEven === "number" ? (
              <g>
                <line x1={left} x2={right} y1={yOf(breakEven)} y2={yOf(breakEven)} className="stroke-danger" strokeWidth={1.5} strokeDasharray="6 5" />
                <text x={left + 2} y={yOf(breakEven) - 6} textAnchor="start" className="fill-danger stroke-surface-1 font-sans text-xs font-semibold [paint-order:stroke]" strokeWidth={4} strokeLinejoin="round">
                  نقطة التعادل
                </text>
              </g>
            ) : null}
            {typeof target === "number" ? (
              <g>
                <line x1={left} x2={right} y1={yOf(target)} y2={yOf(target)} className="stroke-ok" strokeWidth={1.5} strokeDasharray="2 5" />
                <text x={left + 2} y={yOf(target) - 6} textAnchor="start" className="fill-ok stroke-surface-1 font-sans text-xs font-semibold [paint-order:stroke]" strokeWidth={4} strokeLinejoin="round">
                  الهدف
                </text>
              </g>
            ) : null}
            {runs.map((run, k) => (
              <g key={k}>
                {run.length > 1 ? <path d={areaOf(run, baseline)} className="fill-fg/10 stroke-none" /> : null}
                <path d={pathOf(run)} className="fill-none stroke-fg" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
              </g>
            ))}
            {marks.map((m) => {
              const x = xOf(m.e.index);
              const y = yOf(m.v as number);
              return (
                <g key={m.n}>
                  <line x1={x} x2={x} y1={y} y2={baseline} className="stroke-fg-muted" strokeWidth={1} strokeDasharray="2 3" />
                  <circle cx={x} cy={y} r={11} className="fill-surface-1 stroke-fg" strokeWidth={2} />
                  <text x={x} y={y + 4} textAnchor="middle" className="fill-fg font-display text-xs font-bold">
                    {m.n}
                  </text>
                </g>
              );
            })}
            {lastPoint ? <circle cx={lastPoint.x} cy={lastPoint.y} r={5} className="fill-fg stroke-surface-1" strokeWidth={2} /> : null}
            {xLabels ? (
              <>
                <text x={width - PAD_START + 6} y={height - 8} textAnchor="end" className="fill-fg-muted font-sans text-xs">
                  {xLabels.oldest}
                </text>
                <text x={left} y={height - 8} textAnchor="start" className="fill-fg-muted font-sans text-xs">
                  {xLabels.newest}
                </text>
              </>
            ) : null}
          </svg>
        ) : (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-base text-fg-muted">ما في أرقام كفاية لرسم الخط</p>
        )}
      </div>
      {marks.some((m) => m.e.text) ? (
        <ol className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0 text-sm">
          {marks
            .filter((m) => m.e.text)
            .map((m) => (
              <li key={m.n} className="flex items-baseline gap-2.5">
                <span aria-hidden className="inline-grid size-[22px] shrink-0 place-items-center rounded-full border-2 border-fg font-display text-xs font-bold">
                  {m.n}
                </span>
                <span className="min-w-0 text-fg">{m.e.text}</span>
              </li>
            ))}
        </ol>
      ) : null}
    </figure>
  );
}
