import Link from "next/link";
import { JobNumber } from "@/components/ui/job-number";
import { LightStrip } from "@/components/ui/light-strip";
import { StateWord } from "@/components/ui/state-word";
import type { NowCard } from "@/core/tasks-view";
import { cn } from "@/lib/utils";
import { RunButtons } from "./run-buttons";

/**
 * A run as a card (docs/rebuild-v6/02-screens.md §3.1): the number and the name, the ONE word of its state with who it waits on, the light strip (a lamp for every step, as the run
 * stored them), the sentence under the rope and the buttons of its state. The head is a link to the run's page; the buttons are beside it, not inside it.
 */
export function RunCard({ card, canControl }: { card: NowCard; canControl: boolean }) {
  const quiet = card.state === "done" || card.state === "skipped";
  return (
    <article className={cn("space-y-3 rounded-2xl border border-border bg-surface-1 p-4", card.state === "fail" || card.state === "lost" ? "border-danger/45" : card.state === "stuck" || card.state === "approval" || card.state === "queued" ? "border-warn/45" : "")} data-job={card.jobKey} data-state={card.state}>
      <Link href={card.href} className="block space-y-3 rounded-lg">
        <span className="flex items-center gap-3">
          <JobNumber n={card.number} />
          <b className={cn("min-w-0 flex-1 text-base font-extrabold leading-6", quiet ? "text-fg-muted" : "text-fg")}>{card.name}</b>
          <StateWord state={card.state} who={card.who} />
        </span>
        {card.steps.length ? <LightStrip steps={card.steps} label={card.sentence} /> : null}
        <span className="block text-base text-fg">
          {card.sentence}
          {card.more > 0 ? <span className="text-fg-muted"> · و {card.more} قبلها</span> : null}
        </span>
      </Link>
      <RunButtons jobKey={card.jobKey} runId={card.runId} actions={card.actions} canControl={canControl} />
    </article>
  );
}
