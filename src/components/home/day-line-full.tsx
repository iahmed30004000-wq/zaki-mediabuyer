import Link from "next/link";
import { DOT_AR, busiestSlot, type DayDot, type DayLine, type DotState } from "@/core/timeline";
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
const pct = (iso: string, line: DayLine) => Math.min(100, Math.max(0, ((Date.parse(iso) - Date.parse(line.from)) / (Date.parse(line.to) - Date.parse(line.from))) * 100));
/** 06 · 09 · 12 · 15 · 18 · 21 · 00 · 03 — the working day, three hours apart. */
const TICKS = Array.from({ length: 8 }, (_, i) => ({ at: (6 + i * 3) % 24, left: (i / 8) * 100 }));
/** the night is shaded from 22:00 to 06:00: 16 of the day's 24 hours have passed at 22:00 */
const NIGHT_FROM = (16 / 24) * 100;

export interface LineRow {
  key: string;
  number: number | null;
  name: string;
}

/**
 * The whole working day (06:00 → 06:00, Amman): a row per job and its dots across 24 hours, the night shaded from 22:00. The dot of a run opens
 * its job. «أزحم وقت» is the half hour with the most dots. Rows are the jobs that have at least one dot, in the order of their numbers.
 */
export function DayLineFull({ line, rows, now = new Date() }: { line: DayLine; rows: readonly LineRow[]; now?: Date }) {
  const by = new Map<string, DayDot[]>();
  for (const d of line.dots) by.set(d.jobKey, [...(by.get(d.jobKey) ?? []), d]);
  const shown = rows.filter((r) => by.has(r.key));
  const busy = busiestSlot(line.dots);
  const here = pct(now.toISOString(), line);
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-card border border-border bg-surface-1 p-3">
        <div className="min-w-[640px] space-y-1.5">
          <div className="relative ms-[9.5rem] h-5 text-xs text-fg-muted" aria-hidden>
            {TICKS.map((t) => (
              <span key={t.at} className="absolute translate-x-1/2 tabular-nums" style={{ insetInlineStart: `${t.left}%` }}>
                <span dir="ltr">{String(t.at).padStart(2, "0")}</span>
              </span>
            ))}
          </div>
          {shown.map((r) => (
            <div key={r.key} className="flex items-center gap-3">
              <Link href={`/work/job/${encodeURIComponent(r.key)}`} className="inline-flex min-h-10 w-36 shrink-0 items-center truncate text-sm font-bold text-fg hover:underline max-md:min-h-[44px]">
                {r.number ? <span dir="ltr" className="me-1.5 tabular-nums text-fg-muted">{r.number}</span> : null}
                {r.name}
              </Link>
              <div className="relative h-7 flex-1 rounded-md bg-surface-2/40">
                <span aria-hidden className="absolute inset-y-0 rounded-md bg-surface-2" style={{ insetInlineStart: `${NIGHT_FROM}%`, insetInlineEnd: 0 }} />
                <span aria-hidden className="absolute top-0 h-full w-0.5 bg-accent-2" style={{ insetInlineStart: `${here}%` }} />
                {(by.get(r.key) ?? []).map((d, i) => (
                  <span
                    key={`${d.at}-${i}`}
                    role="img"
                    aria-label={`${d.name} ${clock(d.at)} ${DOT_AR[d.state]}`}
                    title={`${d.name} · ${clock(d.at)} · ${DOT_AR[d.state]}`}
                    className={cn("absolute top-1/2 block size-3.5 -translate-y-1/2 rounded-full", DOT[d.state])}
                    style={{ insetInlineStart: `calc(${pct(d.at, line)}% - 7px)` }}
                  />
                ))}
              </div>
            </div>
          ))}
          {!shown.length ? <p className="py-6 text-center text-sm text-fg-muted">ولا مهمة اشتغلت أو إلها موعد باليوم هاد.</p> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-fg-muted">
        {(["done", "failed", "running", "missed", "coming", "manual"] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2.5 rounded-full", DOT[s])} />
            {DOT_AR[s]} {line.counts[s]}
          </span>
        ))}
        {busy ? (
          <span className="ms-auto font-semibold text-fg">
            أزحم وقت: <span dir="ltr">{clock(busy.from)}</span> ({busy.count} مواعيد)
          </span>
        ) : null}
      </div>
    </div>
  );
}
