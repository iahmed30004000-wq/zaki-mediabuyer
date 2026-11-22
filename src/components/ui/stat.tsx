import type { ReactNode } from "react";
import { Num } from "@/components/mb/num";
import type { Source, TermKey } from "@/lib/glossary";
import { cn } from "@/lib/utils";

/**
 * A number tile: the label, the big number (28/800, Latin digits, with its source badge and its «ليش؟» when a `term` is given),
 * an optional change line and an optional bar. A missing number is «—», never 0 (`Num` does that).
 */
export function Stat({
  label,
  value,
  unit = "",
  term,
  source,
  tone,
  note,
  bar,
  className,
}: {
  label: string;
  value: number | null | undefined;
  unit?: "$" | "%" | "x" | "";
  term?: TermKey;
  source?: Source;
  tone?: "ok" | "warn" | "danger";
  /** The line under the number («أمس: 120$»). */
  note?: ReactNode;
  /** 0–100: a thin bar under the note. */
  bar?: number | null;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface-1 p-4", className)}>
      <span className="text-sm font-semibold text-fg-muted">{label}</span>
      <Num value={value} unit={unit} term={term} source={source} label={label} big tone={tone} />
      {note ? <span className="text-sm text-fg-muted">{note}</span> : null}
      {typeof bar === "number" ? (
        <span aria-hidden className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-2">
          <span className={cn("block h-full rounded-full", tone === "danger" ? "bg-danger" : tone === "warn" ? "bg-warn" : "bg-fg")} style={{ width: `${Math.max(0, Math.min(100, bar))}%` }} />
        </span>
      ) : null}
    </div>
  );
}
