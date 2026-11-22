import Link from "next/link";
import type { WordState } from "@/core/state-word";
import { cn } from "@/lib/utils";
import { StateWord } from "./state-word";

export interface DayBoardRow {
  id: string;
  /** the clock, written («06:00») */
  time: string;
  /** the job's name */
  title: string;
  /** who carries it out («Claude الرئيسي») */
  who?: string | null;
  state: WordState;
  /** one line under the name: the result, or why it is where it is */
  line?: string | null;
  /** the moment has passed: the line is quiet */
  past?: boolean;
  href?: string;
}

/**
 * THE DAY BOARD (docs/rebuild-v6/03-look.md §7): one line per job of the day — the clock (Changa 20, like the board of an airport), the job and who carries it,
 * and its state as a lamp and a word. A line whose time has passed is quiet. It lists; it does not decide anything: the state of each line comes from the code.
 */
export function DayBoard({ rows, label, className }: { rows: readonly DayBoardRow[]; label: string; className?: string }) {
  return (
    <ul aria-label={label} className={cn("m-0 flex list-none flex-col p-0", className)}>
      {rows.map((r) => (
        <li key={r.id} className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 sm:grid-cols-[56px_minmax(0,1fr)_auto] border-b border-border py-2.5 last:border-b-0">
          <time dir="ltr" className={cn("text-end font-display text-lg font-bold tabular-nums", r.past ? "text-fg-muted" : "text-fg")}>
            {r.time}
          </time>
          <div className="min-w-0">
            {r.href ? (
              <Link href={r.href} className={cn("block break-words text-base font-semibold hover:underline", r.past ? "text-fg-muted" : "text-fg")}>
                {r.title}
              </Link>
            ) : (
              <b className={cn("block break-words text-base font-semibold", r.past ? "text-fg-muted" : "text-fg")}>{r.title}</b>
            )}
            {r.who || r.line ? (
              <span className="block text-sm text-fg-muted">
                {r.who}
                {r.who && r.line ? " · " : ""}
                {r.line}
              </span>
            ) : null}
          </div>
          <div className="col-start-2 sm:col-start-3">
            <StateWord state={r.state} who={r.who} />
          </div>
        </li>
      ))}
    </ul>
  );
}
