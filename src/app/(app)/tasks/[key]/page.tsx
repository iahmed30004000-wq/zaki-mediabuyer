import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { JobSwitch, RunNowButton, StepSwitch } from "@/components/tasks/job-actions";
import { LiveRefresh } from "@/components/tasks/live";
import { RunButtons } from "@/components/tasks/run-buttons";
import { OrdersSection } from "@/components/work/orders-section";
import { BackLink } from "@/components/ui/back-link";
import { ButtonLink } from "@/components/ui/button-link";
import { Card, EmptyState } from "@/components/ui/card";
import { FactsTable } from "@/components/ui/facts-table";
import { JobNumber } from "@/components/ui/job-number";
import { LightStrip } from "@/components/ui/light-strip";
import { Pill } from "@/components/ui/pill";
import { SectionTitle } from "@/components/ui/section-title";
import { StateWord } from "@/components/ui/state-word";
import { timeOf } from "@/core/day";
import { can } from "@/core/roles";
import { loadJobPage } from "@/lib/tasks-view";
import { currentCaller, requirePage } from "@/server/auth";
import { loadJob } from "@/server/job-map";
import { listOrders } from "@/server/orders";
import { isDemo } from "@/core/readiness";

export const dynamic = "force-dynamic";
export const metadata = { title: "مهمة" };

const day = (iso: string) => new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));

/**
 * المهام ← مهمة: the header (the number, the name, who and when and what kind, the job's switch and «شغّلها هلق») → the light strip of the run that is going — or of the last one, with its date — and
 * the sentence under it with the buttons of its state → the last ten runs, each a small rope that opens its page → the steps (with their switches) → the standing orders on it → the details,
 * folded. The page follows a run that is going by itself.
 */
export default async function TaskPage({ params: paramsP }: { params: Promise<{ key: string }> }) {
  await requirePage("work.view");
  const params = await paramsP;
  const key = decodeURIComponent(params.key);
  // a job that was merged into another leads there
  if (!isDemo(process.env)) {
    const row = await loadJob(key);
    if (row && row.key !== key) redirect(`/tasks/${encodeURIComponent(row.key)}`);
  }
  const [data, me] = await Promise.all([loadJobPage(key), currentCaller()]);
  if (!data) notFound();
  const { job, live, last, runs } = data;
  const owner = !!me && !me.demo && can(me.role, "owner_only");
  const canControl = !!me && !me.demo && can(me.role, "work.control");
  const orders = isDemo(process.env) ? [] : await listOrders({ job: { key: job.key, domain: job.domain } });
  return (
    <div className="space-y-6">
      <LiveRefresh jobKey={job.key} />
      <BackLink href="/tasks/all">كل المهام</BackLink>

      <header className="space-y-3 rounded-2xl border border-border bg-surface-1 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <JobNumber n={job.number} />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-extrabold text-fg">{job.name}</h2>
            <p className="text-base text-fg-muted">
              {job.assigneeName} · {job.words} · {job.kindLabel}
            </p>
          </div>
          <Pill tone={job.badge.tone}>{job.badge.label}</Pill>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canControl ? <RunNowButton jobKey={job.key} /> : null}
          <JobSwitch jobKey={job.key} enabled={job.enabled} canSwitch={owner} />
          {owner ? (
            <ButtonLink href={`/tasks/${encodeURIComponent(job.key)}/edit`} variant="secondary" size="md">
              عدّل الخطوات
            </ButtonLink>
          ) : null}
        </div>
      </header>

      <section className="space-y-3 rounded-2xl border border-border bg-surface-1 p-4" data-tour="rope">
        {live ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <SectionTitle>شغّالة هلق</SectionTitle>
              <StateWord state={live.state} who={job.assigneeName} />
            </div>
            {live.steps.length ? <LightStrip big steps={live.steps} label={live.sentence} /> : null}
            <p className="text-base font-semibold text-fg">{live.sentence}</p>
            <RunButtons jobKey={job.key} runId={live.id} actions={live.actions.length ? live.actions : [{ key: "open", label: "شوف التشغيل", variant: "secondary" }]} canControl={canControl} />
          </>
        ) : last ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <SectionTitle>آخر تشغيل</SectionTitle>
              <StateWord state={last.state} who={job.assigneeName} />
              <span className="text-base text-fg-muted">
                {day(last.startedAt)} · <time dir="ltr">{timeOf(last.startedAt)}</time>
                {last.duration ? ` (${last.duration})` : ""}
              </span>
            </div>
            {last.steps.length ? <LightStrip big steps={last.steps} label={last.line ?? last.word} /> : null}
            {last.line ? <p className="text-base text-fg">{last.line}</p> : null}
            <ButtonLink href={last.href} variant="secondary" size="sm">
              شوف التشغيل
            </ButtonLink>
          </>
        ) : (
          <p className="text-base text-fg-muted">ما اشتغلت لسا. أول ما يبدأ تشغيلها بيظهر هون حبل الضو.</p>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle>آخر التشغيلات</SectionTitle>
        {runs.length ? (
          <Card>
            <ul className="m-0 list-none divide-y divide-border p-0">
              {runs.map((r) => (
                <li key={r.id}>
                  <Link href={r.href} className="block space-y-1.5 px-4 py-3 hover:bg-surface-2">
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <StateWord state={r.state} who={job.assigneeName} />
                      <span className="text-sm text-fg-muted">
                        {day(r.startedAt)} · <time dir="ltr">{timeOf(r.startedAt)}</time>
                        {r.duration ? ` · ${r.duration}` : ""}
                      </span>
                    </span>
                    {r.steps.length ? <LightStrip steps={r.steps} label={r.line ?? r.word} className="max-w-md" /> : null}
                    {r.line ? <span className="block text-base text-fg-muted">{r.line}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <EmptyState title="ما اشتغلت لسا" hint="أول ما تشتغل بتظهر تشغيلاتها هون، كل واحد بحبل ضو." />
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle hint="كل خطوة إلها رقم ومفتاح. الإطفاء بيحفظ نسخة جديدة من الخطوات.">الخطوات</SectionTitle>
        <Card>
          <ul className="m-0 list-none divide-y divide-border p-0">
            {job.branches.map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-4 py-3">
                <span dir="ltr" className="w-12 shrink-0 text-base font-extrabold tabular-nums text-fg-muted">
                  {b.number ?? "·"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={b.disabled ? "block text-base font-semibold text-fg-muted line-through" : "block text-base font-semibold text-fg"}>{b.label}</span>
                  {b.desc ? <span className="block text-base text-fg-muted">{b.desc}</span> : null}
                </span>
                {owner ? <StepSwitch jobKey={job.key} stepId={b.id} enabled={!b.disabled} /> : null}
              </li>
            ))}
            {!job.branches.length ? <li className="px-4 py-3 text-base text-fg-muted">ما في خطوات مرسومة.</li> : null}
          </ul>
        </Card>
      </section>

      <OrdersSection orders={orders} scope={{ domain: job.domain, jobKeys: [job.key] }} canCreate={canControl} canEnd={owner} />

      <details className="rounded-2xl border border-border bg-surface-1 px-4 py-3">
        <summary className="min-h-11 cursor-pointer text-base font-bold text-fg">تفاصيل</summary>
        <div className="mt-3 space-y-4">
          {job.description ? <p className="text-base leading-7 text-fg">{job.description}</p> : null}
          <FactsTable
            facts={[
              { label: "الموعد", value: job.words },
              { label: "بتشتغل من", value: job.facts.runsFrom ?? job.assigneeName },
              { label: "من وين إجت", value: job.facts.origin },
              { label: "بتلمس", value: job.facts.touches.join("، ") },
              { label: "بتحكي مع", value: job.facts.talksTo.join("، ") },
              { label: "مهلة التأخير", value: `${job.graceMin} دقيقة` },
            ]}
          />
          <p className="text-base leading-7 text-fg-muted">القواعد اللي بتقراها من الإعدادات: السقوف وتوزيع الميزانية، ونقطة التعادل لكل منتج، ومستوى كل حساب. ما بتغيّرها هي.</p>
          {owner ? (
            <Link href="/settings/rules" className="inline-flex min-h-11 items-center text-base font-semibold text-info hover:underline">
              عدّل القواعد
            </Link>
          ) : null}
          {job.note ? <p className="text-base leading-7 text-fg">{job.note}</p> : null}
        </div>
      </details>
    </div>
  );
}
