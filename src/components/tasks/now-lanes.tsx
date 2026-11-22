import Link from "next/link";
import { EmptyState } from "@/components/ui/card";
import { Lamp } from "@/components/ui/lamp";
import type { NowData, NowLane } from "@/core/tasks-view";
import { RunCard } from "./run-card";

function Lines({ lane }: { lane: NowLane }) {
  return (
    <ul className="m-0 list-none divide-y divide-border rounded-2xl border border-border bg-surface-1 p-0 px-4">
      {lane.lines.map((l) => (
        <li key={l.id} className="grid grid-cols-[56px_minmax(0,1fr)] items-baseline gap-3 py-2.5">
          <time dir="ltr" className="text-end font-display text-lg font-bold tabular-nums text-fg">
            {l.time}
          </time>
          <Link href={l.href} className="min-w-0 text-base text-fg hover:underline">
            <b className="font-semibold">{l.name}</b>
            {l.line ? <span className="text-fg-muted"> — {l.line}</span> : l.who ? <span className="text-fg-muted"> · {l.who}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function TeamLines({ lane }: { lane: NowLane }) {
  return (
    <ul className="m-0 list-none divide-y divide-border rounded-2xl border border-border bg-surface-1 p-0 px-4">
      {lane.tasks.map((t) => (
        <li key={t.id} className="flex items-baseline justify-between gap-3 py-2.5">
          <span className="min-w-0 text-base text-fg">
            <b className="font-semibold">{t.title}</b>
            <span className="text-fg-muted"> · {t.who}</span>
          </span>
          <Link href={t.href} className="shrink-0 text-base font-semibold text-info hover:underline">
            {t.due === "late" ? "متأخرة — افتح" : "اليوم — افتح"}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * THE LANES (docs/rebuild-v6/02-screens.md §3.1): each with its lamp, its title and its count; an empty lane is not drawn. On a desktop they are columns, on a phone they stack in this
 * order — what needs somebody first, what is going next, then what is coming and what is done. The cards are drawn from the stored runs: the lamps and the words are the run's own.
 */
export function NowLanes({ data, canControl }: { data: NowData; canControl: boolean }) {
  if (!data.lanes.length) {
    return <EmptyState title="ما في شي واقف ولا شغّال هلق" hint="لما تنطلب مهمة أو يجي موعدها بتظهر هون، وبتتحدّث لحالها." action={{ label: "جدول اليوم", href: "/tasks/day" }} />;
  }
  return (
    <div className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3" data-tour="lanes">
      {data.lanes.map((lane) => (
        <section key={lane.key} aria-label={lane.title} className="space-y-3">
          <h2 className="flex items-center gap-2 font-display text-lg font-extrabold text-fg">
            <Lamp state={lane.lamp} size={14} />
            {lane.title}
            <span className="font-display text-base font-bold tabular-nums text-fg-muted">{lane.total}</span>
          </h2>
          {lane.cards.map((c) => (
            <RunCard key={c.id} card={c} canControl={canControl} />
          ))}
          {lane.lines.length ? <Lines lane={lane} /> : null}
          {lane.tasks.length ? <TeamLines lane={lane} /> : null}
          {lane.key === "done" && lane.total > lane.lines.length ? (
            <Link href="/tasks/day" className="inline-flex min-h-11 items-center text-base font-semibold text-info hover:underline">
              عرض الكل ({lane.total})
            </Link>
          ) : null}
          {lane.key === "upcoming" && lane.total > lane.lines.length ? (
            <Link href="/tasks/day" className="inline-flex min-h-11 items-center text-base font-semibold text-info hover:underline">
              جدول اليوم ({lane.total})
            </Link>
          ) : null}
          {lane.key === "team" && lane.total > lane.tasks.length ? (
            <Link href="/tasks/team" className="inline-flex min-h-11 items-center text-base font-semibold text-info hover:underline">
              كل مهام الفريق ({lane.total})
            </Link>
          ) : null}
        </section>
      ))}
    </div>
  );
}
