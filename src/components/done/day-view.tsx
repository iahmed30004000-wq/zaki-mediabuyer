import Link from "next/link";
import { Panel } from "@/components/mb/section";
import { EmptyState } from "@/components/ui/card";
import { lineTime, type DayGroup, type DayItem } from "@/core/day";
import type { DayData } from "@/lib/day-view";
import { cn } from "@/lib/utils";
import { DayControls } from "./day-controls";

function Line({ i }: { i: DayItem }) {
  const tone = i.tone === "danger" ? "text-danger" : i.tone === "warn" ? "text-warn" : "text-fg";
  return (
    <li className="flex items-start gap-3 py-2 text-sm">
      <span dir="ltr" className="w-11 shrink-0 pt-0.5 font-mono text-xs text-fg-muted">{lineTime(i)}</span>
      <span className="min-w-0 flex-1 leading-6">
        {i.href ? (
          <Link href={i.href} className={cn("hover:text-accent", tone)}>{i.text}</Link>
        ) : (
          <span className={tone}>{i.text}</span>
        )}
        {i.numbers?.length ? (
          <span className="mt-1 flex flex-wrap gap-1">
            {i.numbers.map((n) => (
              <span key={n} dir="ltr" className="rounded-md bg-surface-2 px-1.5 py-0.5 text-xs tabular-nums text-fg-muted">{n}</span>
            ))}
          </span>
        ) : null}
      </span>
    </li>
  );
}

function Groups({ groups }: { groups: DayGroup[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {groups.map((g) => (
        <Panel key={g.key} className="space-y-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
            {g.label}
            <span className="rounded-full bg-surface-2 px-2 text-xs text-fg-muted">{g.items.length}</span>
          </h3>
          <ul className="divide-y divide-border">
            {g.items.map((i, n) => (
              <Line key={`${i.at}-${n}`} i={i} />
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}

/**
 * الإنجاز, the day tab: what got done (any past day, and today so far) grouped by who did it, and what is planned
 * (today's rest and any day ahead): the scheduled runs, the tasks due, the decisions that will lapse. All written by
 * the code from rows that already exist.
 */
export function DayView({ data, hideControls = false }: { data: DayData; hideControls?: boolean }) {
  const showDone = data.state !== "future";
  const showPlan = data.state !== "past";
  return (
    <div className="space-y-5">
      {hideControls ? null : <DayControls day={data.day} today={data.today} />}
      <div>
        <h2 className="text-base font-bold text-fg">{data.title}</h2>
        <p className="text-xs text-fg-muted">
          {showDone ? `${data.counts.done} انعمل` : null}
          {showDone && showPlan ? " · " : null}
          {showPlan ? `${data.counts.planned} مخطّط` : null}
        </p>
      </div>

      {showDone ? (
        <section className="space-y-3" aria-label="اللي انعمل" data-tour="done">
          <h3 className="text-sm font-bold text-fg">اللي انعمل</h3>
          {data.done.length ? <Groups groups={data.done} /> : <EmptyState title="لسا ما في إنجاز مسجّل لهاليوم" hint="كل شي بينعمل — تشغيل، قرار، مهمة، فيديو — بيطلع هون لحاله." art="empty-decisions" />}
        </section>
      ) : null}

      {showPlan ? (
        <section className="space-y-3" aria-label="المخطّط" data-tour="planned">
          <h3 className="text-sm font-bold text-fg">{data.state === "today" ? "لسا اليوم" : "المخطّط"}</h3>
          {data.planned.length ? <Groups groups={data.planned} /> : <p className="rounded-lg border border-dashed border-border p-3 text-sm text-fg-muted">ما في شي مجدول ولا موعده هاليوم.</p>}
        </section>
      ) : null}
    </div>
  );
}
