import type { ReactNode } from "react";
import { stretchAfter, type StripStep } from "@/core/light-strip";
import { cn } from "@/lib/utils";
import { Lamp } from "./lamp";
import { Diodes } from "./light-strip";

export interface RunStepRow extends StripStep {
  /** the step's number in the run, from 1 */
  n?: number;
  title: string;
  /** a line under the title (what the step did, who it waits on) */
  note?: string | null;
  /** when it happened, already written («09:12» · «قبل 4 دقايق») */
  time?: string | null;
  /** why it stopped, in a sentence — never a code */
  error?: string | null;
  /** extra content under the lines (a button that fixes it) */
  action?: ReactNode;
}

/**
 * THE VERTICAL ROPE (docs/rebuild-v6/03-look.md §6): for every step a lamp (18) and a strip of tape under it, and beside them the number, the title, the note,
 * the time and the error. The tape behind a finished step glows green, behind the running one the diodes chase; the last step has no tape under it.
 * A step that has not come yet (`off`) is quiet. It shows what the run did — it never guesses, and an inferred step has no halo.
 */
export function RunSteps({ steps, label, className }: { steps: readonly RunStepRow[]; label: string; className?: string }) {
  return (
    <ol aria-label={label} className={cn("m-0 flex list-none flex-col p-0", className)}>
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const quiet = s.lamp === "off";
        return (
          <li key={s.id} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
            <div aria-hidden className="flex flex-col items-center">
              <Lamp state={s.lamp} size={18} glow={!s.inferred} className="mt-1" />
              {last ? null : (
                <span className="my-[5px] flex min-h-7 w-2.5 flex-1 flex-col items-center justify-evenly rounded-[5px] bg-tape">
                  <Diodes stretch={stretchAfter(s)} vertical />
                </span>
              )}
            </div>
            <div className="min-w-0 pb-3.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                {s.n ? <span className="font-display text-base font-bold tabular-nums text-fg-muted">{s.n}</span> : null}
                <b className={cn("text-base", quiet ? "font-medium text-fg-muted" : "font-semibold text-fg")}>{s.title}</b>
                {s.time ? <span className="font-display text-sm tabular-nums text-fg-muted">{s.time}</span> : null}
              </div>
              {s.note ? <p className="text-sm text-fg-muted">{s.note}</p> : null}
              {s.error ? <p className="text-sm font-semibold text-danger">{s.error}</p> : null}
              {s.action ? <div className="mt-2">{s.action}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
