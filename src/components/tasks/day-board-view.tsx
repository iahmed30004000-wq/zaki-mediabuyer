import Link from "next/link";
import { DayBoard, type DayBoardRow } from "@/components/ui/day-board";
import { EmptyState } from "@/components/ui/card";
import { JobNumber } from "@/components/ui/job-number";
import type { CollapsedLine } from "@/core/day-collapse";
import { lineTime } from "@/core/day";
import type { BoardEntry, BoardRow } from "@/core/tasks-view";
import { cn } from "@/lib/utils";

const toRow = (r: BoardRow): DayBoardRow => ({ id: r.id, time: r.time, title: r.name, who: r.who, state: r.state, line: r.line, past: r.past, href: r.href });

/**
 * THE BOARD OF THE DAY (docs/rebuild-v6/02-screens.md §3.2): a line for every moment — the clock (big), the job and who carries it, the ONE word of its state with its lamp, and the result line.
 * A job with more than four moments in the day is one folded line («جولة الفريق — 13 موعد: 9 خلصت · 1 فاتت · 3 جاية») that opens with a press to show them.
 */
export function DayBoardView({ entries, label }: { entries: readonly BoardEntry[]; label: string }) {
  if (!entries.length) return <EmptyState title="ما في مواعيد باليوم هاد" hint="المهام اللي إلها موعد بتظهر هون، وكل موعد بكلمة وحدة: خلصت · شغّالة · واقفة · فاتت · جاية." action={{ label: "كل المهام", href: "/tasks/all" }} />;
  // the lines that follow one another stand in ONE list (so the rule between them is drawn); a folded job breaks the list
  const blocks: ({ kind: "rows"; rows: BoardRow[] } | Extract<BoardEntry, { kind: "group" }>)[] = [];
  for (const e of entries) {
    const last = blocks[blocks.length - 1];
    if (e.kind === "group") blocks.push(e);
    else if (last?.kind === "rows") last.rows.push(e.row);
    else blocks.push({ kind: "rows", rows: [e.row] });
  }
  return (
    <div className="rounded-2xl border border-border bg-surface-1 px-4" data-tour="board">
      {blocks.map((e, i) =>
        e.kind === "rows" ? (
          <DayBoard key={`rows-${i}`} label={label} rows={e.rows.map(toRow)} />
        ) : (
          <details key={e.jobKey} className="group border-b border-border py-2.5 last:border-b-0">
            <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
              <JobNumber n={e.number} className="size-8 text-sm" />
              <b className="text-base font-semibold text-fg">{e.name}</b>
              <span className="text-base text-fg-muted">
                — {e.total} موعد: {e.summary}
              </span>
              <span aria-hidden className="ms-auto text-fg-muted transition-transform group-open:rotate-180">
                ▾
              </span>
            </summary>
            <DayBoard label={`${e.name} — كل المواعيد`} rows={e.rows.map(toRow)} />
          </details>
        ),
      )}
    </div>
  );
}

/** What was done in the same hours, the same line said once: «104 فيديو انرفعوا لميتا» is one line that opens to show them (U-11). */
export function DoneLines({ lines }: { lines: readonly CollapsedLine[] }) {
  if (!lines.length) return <p className="text-base text-fg-muted">ما في شي تاني انعمل باليوم هاد.</p>;
  return (
    <ul className="m-0 list-none divide-y divide-border rounded-2xl border border-border bg-surface-1 p-0 px-4">
      {lines.map((l) => (
        <li key={l.key} className="py-2.5">
          {l.count > 1 ? (
            <details className="group">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3">
                <time dir="ltr" className="w-14 shrink-0 text-end font-display text-lg font-bold tabular-nums text-fg">
                  {lineTime(l.items[0]!)}
                </time>
                <b className={cn("min-w-0 flex-1 text-base font-semibold", l.tone === "danger" ? "text-danger" : "text-fg")}>{l.text}</b>
                <span aria-hidden className="text-fg-muted transition-transform group-open:rotate-180">
                  ▾
                </span>
              </summary>
              <ul className="m-0 mt-2 list-none space-y-1 p-0 ps-[68px]">
                {l.items.map((i, n) => (
                  <li key={`${i.at}-${n}`} className="text-base text-fg-muted">
                    {i.href ? <Link href={i.href} className="hover:underline">{i.text}</Link> : i.text}
                  </li>
                ))}
              </ul>
            </details>
          ) : (
            <div className="flex min-h-11 items-center gap-3">
              <time dir="ltr" className="w-14 shrink-0 text-end font-display text-lg font-bold tabular-nums text-fg">
                {lineTime(l.items[0]!)}
              </time>
              <span className={cn("min-w-0 flex-1 text-base", l.tone === "danger" ? "text-danger" : l.tone === "warn" ? "text-warn" : "text-fg")}>
                {l.href ? <Link href={l.href} className="hover:underline">{l.text}</Link> : l.text}
              </span>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
