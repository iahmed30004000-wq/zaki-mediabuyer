import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Num } from "@/components/mb/num";
import { change, type DayNumbers } from "@/core/today";
import type { TermKey } from "@/lib/glossary";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Which way is good for this number: more orders is good, a higher cost per order is not, spend is neither. */
export type Good = "up" | "down" | "none";

export function Delta({ now, base, good }: { now: number | null; base: number | null; good: Good }) {
  const c = change(now, base);
  if (c.pct === null) return <span className="text-fg-muted">—</span>;
  const bad = c.dir !== "flat" && good !== "none" && (good === "up" ? c.dir === "down" : c.dir === "up");
  const fine = c.dir !== "flat" && good !== "none" && !bad;
  const Icon = c.dir === "up" ? ArrowUp : c.dir === "down" ? ArrowDown : Minus;
  return (
    <span dir="ltr" className={cn("inline-flex items-center text-xs font-semibold tabular-nums", bad ? "text-danger" : fine ? "text-ok" : "text-fg-muted")}>
      <Icon className="size-3" />
      {Math.abs(c.pct)}%
    </span>
  );
}

/** One of the four numbers: today big, and beside it yesterday and the 7-day average, each with how far today moved from it. */
export function NumberCard({ label, term, unit, field, today, yesterday, avg7, good, tone }: { label: string; term: TermKey; unit: "$" | ""; field: keyof DayNumbers; today: DayNumbers; yesterday: DayNumbers; avg7: DayNumbers; good: Good; tone?: "ok" | "warn" | "danger" }) {
  const now = today[field];
  return (
    <div className="rounded-card border border-border bg-surface-1 p-4 shadow-card">
      <p className="text-xs text-fg-muted">{label}</p>
      <div className="mt-1">
        <Num value={now} unit={unit} term={term} big tone={tone} />
      </div>
      <dl className="mt-3 space-y-1 text-xs">
        {[
          ["أمس", yesterday[field]],
          ["معدّل 7 أيام", avg7[field]],
        ].map(([k, v]) => (
          <div key={String(k)} className="flex items-center justify-between gap-2">
            <dt className="text-fg-muted">{k}</dt>
            <dd className="flex items-center gap-2">
              <span dir="ltr" className="tabular-nums text-fg">{fmt(v as number | null, unit, unit === "$" ? 2 : 0)}</span>
              <Delta now={now} base={v as number | null} good={good} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
