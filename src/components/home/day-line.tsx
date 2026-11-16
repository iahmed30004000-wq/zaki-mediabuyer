import Link from "next/link";
import { DOT_AR, type DayDot, type DayLine as DayLineData, type DotState } from "@/core/timeline";
import { cn } from "@/lib/utils";

const DOT: Record<DotState, string> = {
  done: "bg-ok",
  failed: "bg-danger",
  running: "bg-info",
  missed: "bg-warn",
  coming: "border-2 border-border bg-surface-1",
  manual: "bg-fg-muted",
};

const clock = (iso: string) => new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

/** The place of an instant on the working day, 0..100 (RTL: the day starts at the right edge). */
const pct = (iso: string, line: DayLineData) => Math.min(100, Math.max(0, ((Date.parse(iso) - Date.parse(line.from)) / (Date.parse(line.to) - Date.parse(line.from))) * 100));

/**
 * The day on one line (docs/rebuild/04-work.md): a dot for every run — done · failed · running · missed · coming · manual — in the
 * order of the clock, from 06:00 to 06:00. A state is a word in the title and the legend, not a colour alone.
 */
export function DayLineMini({ line, now = new Date() }: { line: DayLineData; now?: Date }) {
  const here = pct(now.toISOString(), line);
  return (
    <div className="space-y-3">
      <div className="relative h-8" role="img" aria-label={`اليوم على الخط: ${line.dots.length} تشغيلة`}>
        <span aria-hidden className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-border" />
        <span aria-hidden className="absolute top-0 h-full w-0.5 rounded-full bg-accent-2" style={{ insetInlineStart: `${here}%` }} title="هلأ" />
        {line.dots.map((d: DayDot, i) => (
          <Link
            key={`${d.jobKey}:${d.at}:${i}`}
            href={d.runId ? `/work/job/${encodeURIComponent(d.jobKey)}` : "/work/today"}
            title={`${d.name} · ${clock(d.at)} · ${DOT_AR[d.state]}`}
            className={cn("absolute top-1/2 block size-3 -translate-y-1/2 rounded-full", DOT[d.state])}
            style={{ insetInlineStart: `calc(${pct(d.at, line)}% - 6px)` }}
          >
            <span className="sr-only">
              {d.name} {clock(d.at)} {DOT_AR[d.state]}
            </span>
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
        {(["done", "failed", "running", "missed", "coming", "manual"] as const)
          .filter((s) => line.counts[s] > 0)
          .map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn("size-2.5 rounded-full", DOT[s])} />
              {DOT_AR[s]} {line.counts[s]}
            </span>
          ))}
        {line.next ? (
          <span className="ms-auto font-semibold text-fg">
            الجاي: {line.next.name} الساعة <span dir="ltr">{clock(line.next.at)}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
