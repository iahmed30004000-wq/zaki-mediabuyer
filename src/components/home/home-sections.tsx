import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { InboxCard } from "@/components/inbox/inbox-card";
import { AlertStrip } from "@/components/home/alert-strip";
import { RunCard } from "@/components/tasks/run-card";
import { DayBoard } from "@/components/ui/day-board";
import { JobNumber } from "@/components/ui/job-number";
import { ReadinessCard } from "@/components/ui/readiness-card";
import { SectionTitle } from "@/components/ui/section-title";
import { Skeleton } from "@/components/ui/skeleton";
import { StateWord } from "@/components/ui/state-word";
import { WasNow } from "@/components/ui/was-now";
import { asksSomething, isUrgent, needsOf, type HomePlan } from "@/core/home";
import { canOpenPath, can } from "@/core/roles";
import { runWordState } from "@/core/state-word";
import type { TodayAlert } from "@/core/today";
import { loadCompare } from "@/lib/compare-view";
import { loadHomeTasks, loadResults } from "@/lib/tasks-view";
import { loadToday } from "@/lib/today-view";
import { currentCaller } from "@/server/auth";
import { taskKeysFor } from "@/server/directory";
import { loadInbox } from "@/server/inbox";

/** The loading shape of a section: a title line and a block, so a slow section never moves the others. */
export function SectionSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-5 w-32" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-20 w-full rounded-card" />
      ))}
    </div>
  );
}

const UNIT = { usd: "$", count: "", pct: "%" } as const;
const SOURCE = { real: "truth", meta: "meta", estimate: "estimate" } as const;
const linkClass = "inline-flex min-h-11 items-center text-base font-semibold text-info hover:underline";

/**
 * «بدّها منك» (section 1): everything that waits for him in ONE list — the decisions first, then the runs that stopped or were missed, then the alerts that ask something of him —
 * the first three shown, the rest counted behind «كل القرارات» and «كل اللي واقف». A red alert is never cut off by the three; the orange ones past the three are behind «كل التنبيهات (n)»;
 * the informational ones are a quiet «للعلم» line (the bell is not claimed until P7 writes alerts to it). With nothing waiting it says so in one line (never an empty block). The number beside the title is
 * everything that waits, shown or not. A decision is the same card as the inbox's, a run the same card as «هلق»: pressing is the same press.
 */
export async function NeedsSection({ plan }: { plan: HomePlan }) {
  const me = await currentCaller();
  const keys = me && plan.tasks ? await taskKeysFor(me) : [];
  const [decisions, tasks, today] = await Promise.all([me && plan.decisions ? loadInbox(me) : Promise.resolve([]), plan.tasks ? loadHomeTasks(keys) : Promise.resolve(null), loadToday()]);
  const urgent: TodayAlert[] = today.alerts.filter(isUrgent);
  const warns: TodayAlert[] = today.alerts.filter((a) => a.tone === "warn");
  const told: TodayAlert[] = today.alerts.filter((a) => !asksSomething(a));
  const needs = needsOf({ decisions, stuck: tasks?.stuck.cards ?? [], alerts: warns, urgent });
  const canControl = !!me && !me.demo && can(me.role, "work.control");
  const shownAlerts = needs.shown.flatMap((n) => (n.kind === "alert" ? [n.item] : []));
  return (
    <section className="space-y-3" data-tour="needs" aria-label="بدّها منك">
      <SectionTitle {...(plan.decisions ? { href: "/inbox", linkLabel: "كل القرارات" } : {})}>
        بدّها منك
        {needs.total > 0 ? <span className="ms-2 rounded-full bg-warn px-2.5 py-0.5 align-middle font-display text-base font-bold tabular-nums text-warn-fg">{needs.total}</span> : null}
      </SectionTitle>
      {needs.total === 0 ? (
        <p className="flex items-center gap-2 rounded-card border border-border bg-surface-1 p-4 text-base text-fg-muted">
          <CheckCircle2 className="size-5 text-ok" aria-hidden /> ما في شي بدّه منك ✓
        </p>
      ) : (
        <div className="space-y-3">
          {needs.shown.map((n) =>
            n.kind === "decision" ? (
              <InboxCard key={n.item.id} item={n.item} compact />
            ) : n.kind === "stuck" ? (
              <RunCard key={n.item.id} card={n.item} canControl={canControl} />
            ) : null,
          )}
          {shownAlerts.length ? <AlertStrip alerts={shownAlerts} /> : null}
          {needs.left.decisions > 0 || needs.left.stuck > 0 ? (
            <p className="flex flex-wrap items-center gap-x-4 text-base text-fg-muted">
              {needs.left.decisions > 0 ? (
                <Link href="/inbox" className={linkClass}>
                  كل القرارات ({needs.counts.decisions})
                </Link>
              ) : null}
              {needs.left.stuck > 0 ? (
                <Link href="/tasks" className={linkClass}>
                  كل اللي واقف ({needs.counts.stuck})
                </Link>
              ) : null}
            </p>
          ) : null}
          {needs.leftAlerts.length > 0 ? (
            <details className="rounded-card border border-border bg-surface-1 p-3">
              <summary className="min-h-11 cursor-pointer text-base font-semibold text-info">كل التنبيهات ({needs.counts.alerts})</summary>
              <div className="pt-2">
                <AlertStrip alerts={needs.leftAlerts} />
              </div>
            </details>
          ) : null}
        </div>
      )}
      {told.length > 0 ? (
        <ul className="m-0 list-none space-y-1 p-0 text-sm text-fg-muted" aria-label="للعلم">
          {told.map((a) => (
            <li key={a.key}>
              <Link href={a.href} className="hover:underline">
                للعلم: {a.text}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * «وين كنا وكيف صرنا» (section 4): four tiles — the last seven complete days against the seven before. A tile whose number is missing says WHY in a sentence; when all four are missing
 * the card «شو ناقص لتطلع الأرقام» stands in place of four dashes, each missing thing with the button that fixes it (a button the role cannot open is not drawn).
 */
export async function NumbersSection({ plan }: { plan: HomePlan }) {
  const me = await currentCaller();
  const c = await loadCompare();
  const rows = c.readiness.map((r) => ({ ...r, action: r.action && me && canOpenPath(me.role, r.action.href) ? r.action : null }));
  return (
    <section className="space-y-3" data-tour="numbers" aria-label="وين كنا وكيف صرنا">
      <SectionTitle hint="آخر 7 أيام مقابل الـ7 اللي قبلهم" {...(plan.numbersHref ? { href: plan.numbersHref, linkLabel: "كل الأرقام" } : {})}>
        وين كنا وكيف صرنا
      </SectionTitle>
      {c.allMissing ? (
        <ReadinessCard rows={rows} />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {c.tiles.map((t) => (
            <WasNow
              key={t.key}
              label={t.label}
              now={t.now}
              was={t.was}
              unit={UNIT[t.unit]}
              term={t.term}
              source={SOURCE[t.source]}
              delta={t.words ? { words: t.words, tone: t.tone } : null}
              series={t.series}
              missing={t.missing}
              provisional={t.provisional}
              digits={t.digits}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** «الجاي اليوم» (section 5): the first four moments still to come, as the board of an airport, and the link to the whole day. Nothing to come: not drawn. */
export async function UpcomingSection() {
  const me = await currentCaller();
  const tasks = await loadHomeTasks(me ? await taskKeysFor(me) : []);
  if (!tasks.upcoming.lines.length) return null;
  const rows = tasks.upcoming.lines.slice(0, 4).map((l) => ({ id: l.id, time: l.time, title: l.name, who: l.who, state: "next" as const, href: l.href }));
  return (
    <section className="space-y-3" aria-label="الجاي اليوم">
      <SectionTitle href="/tasks/day" linkLabel={tasks.upcoming.total > rows.length ? `جدول اليوم (${tasks.upcoming.total})` : "جدول اليوم"}>
        الجاي اليوم
      </SectionTitle>
      <div className="rounded-card border border-border bg-surface-1 px-4">
        <DayBoard rows={rows} label="الجاي اليوم" />
      </div>
    </section>
  );
}

const when = (iso: string) => new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

/** «آخر النتائج» (section 6): the last three results, each as ONE sentence with its word; «الكل» opens them all. Empty ones are not listed; with nothing to show it is not drawn. */
export async function ResultsSection() {
  const view = await loadResults({ limit: 12 });
  const rows = view.rows.slice(0, 3);
  if (!rows.length) return null;
  return (
    <section className="space-y-3" aria-label="آخر النتائج">
      <SectionTitle href="/tasks/results" linkLabel="الكل">
        آخر النتائج
      </SectionTitle>
      <ul className="m-0 list-none divide-y divide-border rounded-card border border-border bg-surface-1 p-0">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={r.href} className="block space-y-1 px-4 py-3 hover:bg-surface-2">
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {r.jobNumber ? <JobNumber n={r.jobNumber} className="size-8 text-sm" /> : null}
                <b className="min-w-0 text-base font-bold text-fg">{r.title}</b>
                {r.status ? <StateWord state={runWordState(r.status)} /> : null}
                <span className="ms-auto text-sm text-fg-muted">{when(r.at)}</span>
              </span>
              {r.summary ? <span className="block text-base text-fg-muted">{r.summary}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

