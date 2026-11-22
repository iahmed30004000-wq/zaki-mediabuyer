import { areaOf, lastN, linePoints, pathOf } from "@/core/chart";
import { cn } from "@/lib/utils";

/** How many points the small line draws. */
export const SPARK_POINTS = 14;

/**
 * A small line of the last 14 values, with a light fill (docs/rebuild-v6/03-look.md §7). No library: the maths is `core/chart.ts`. The oldest value is at the
 * right (an Arabic page). A day with no number is a gap in the line, never a zero; fewer than two numbers draw nothing (the tile says why, in words).
 * It is decoration for the eye only: the number beside it is the fact, so the picture is hidden from a screen reader unless `label` is given.
 */
export function Sparkline({ values, label, className }: { values: readonly (number | null | undefined)[]; label?: string; className?: string }) {
  const W = 100;
  const H = 34;
  const series = lastN(values, SPARK_POINTS);
  const { runs } = linePoints(series, { width: W, height: H, padX: 2, padY: 3, rtl: true });
  // nothing to join: no line (a lone point is not a trend)
  if (!runs.some((r) => r.length >= 2)) return null;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn("block h-[34px] w-full", className)}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      focusable="false"
    >
      {runs
        .filter((run) => run.length >= 2)
        .map((run, k) => (
          <g key={k}>
            <path d={areaOf(run, H)} className="fill-fg/10 stroke-none" />
            <path d={pathOf(run)} className="fill-none stroke-fg" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </g>
        ))}
    </svg>
  );
}
