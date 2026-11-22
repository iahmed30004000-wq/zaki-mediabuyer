import { notFound } from "next/navigation";
import { InboxCard } from "@/components/inbox/inbox-card";
import { LiveRefresh } from "@/components/tasks/live";
import { ReportView } from "@/components/tasks/report-view";
import { ReassignControl, RunButtons } from "@/components/tasks/run-buttons";
import { BackLink } from "@/components/ui/back-link";
import { ButtonLink } from "@/components/ui/button-link";
import { JobNumber } from "@/components/ui/job-number";
import { RunSteps } from "@/components/ui/run-steps";
import { SectionTitle } from "@/components/ui/section-title";
import { StateWord } from "@/components/ui/state-word";
import { timeOf } from "@/core/day";
import { fromApproval } from "@/core/inbox";
import { can } from "@/core/roles";
import { loadRunPage } from "@/lib/tasks-view";
import { currentCaller, requirePage } from "@/server/auth";
import { loadDirectory } from "@/server/directory";

export const dynamic = "force-dynamic";
export const metadata = { title: "تشغيل" };

/**
 * المهام ← مهمة ← تشغيل: the big rope — a lamp for every step as the run stored it, with the number, the title, the note, «من 00:35 لـ 00:37 (دقيقتين)» and the error in plain words. The decision that
 * waits on a step is drawn inside that step. When the agent only logged the end, a line says so above the rope (the steps are then drawn without a halo: they were inferred, not seen).
 * The buttons are the ones of the state. The report, the numbers and the links come below.
 */
export default async function TaskRunPage({ params: paramsP }: { params: Promise<{ key: string; id: string }> }) {
  await requirePage("work.view");
  const params = await paramsP;
  const key = decodeURIComponent(params.key);
  const id = decodeURIComponent(params.id);
  const [data, me, directory] = await Promise.all([loadRunPage(key, id), currentCaller(), loadDirectory().catch(() => [])]);
  if (!data) notFound();
  const { job, run } = data;
  const canControl = !!me && !me.demo && can(me.role, "work.control");
  const approvals = new Map(data.approvals.map((a) => [a.nodeId, a]));
  const rows = data.steps.map((s) => {
    const a = s.approvalId ? approvals.get(s.id) : null;
    return {
      id: s.id,
      lamp: s.lamp,
      ...(s.inferred ? { inferred: true } : {}),
      n: s.n,
      title: s.title,
      note: s.note,
      time: s.time,
      error: s.error,
      action: a ? <InboxCard item={fromApproval({ ...a, analysis: a.analysis as { text?: string } | null })} compact /> : undefined,
    };
  });
  const agents = directory.filter((d) => d.active).map((d) => ({ key: d.key, label: d.name }));
  const canHand = canControl && (run.status === "queued" || run.status === "waiting" || run.status === "running");
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {data.live ? <LiveRefresh runId={run.id} /> : null}
      <BackLink href={`/tasks/${encodeURIComponent(job.key)}`}>{job.name}</BackLink>

      <header className="space-y-3 rounded-2xl border border-border bg-surface-1 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <JobNumber n={job.number} />
          <h2 className="min-w-0 flex-1 font-display text-lg font-extrabold text-fg">{job.name}</h2>
          <StateWord state={data.state} who={data.who} />
        </div>
        <p className="text-base text-fg-muted">
          {data.who} · من <time dir="ltr">{timeOf(run.startedAt)}</time>
          {data.duration ? ` (${data.duration})` : ""}
        </p>
      </header>

      <section className="space-y-3 rounded-2xl border border-border bg-surface-1 p-4" data-tour="rope">
        {data.inferred ? <p className="rounded-xl bg-surface-2 px-3 py-2 text-base text-fg">{data.who} سجّل النهاية بس، بلا تفاصيل الخطوات.</p> : null}
        <p className="text-base font-semibold text-fg">{data.sentence}</p>
        {rows.length ? <RunSteps steps={rows} label={data.sentence} /> : <p className="text-base text-fg-muted">هالمهمة ما إلها خطوات مرسومة.</p>}
        <RunButtons jobKey={job.key} runId={run.id} actions={data.actions.filter((a) => a.key !== "open")} canControl={canControl} />
        {canHand ? <ReassignControl jobKey={job.key} runId={run.id} options={agents} /> : null}
      </section>

      {run.report || run.metrics || run.artifacts.length ? (
        <section className="space-y-3">
          <SectionTitle>النتيجة</SectionTitle>
          {run.summary ? <p className="text-base font-semibold leading-7 text-fg">{run.summary}</p> : null}
          <ReportView text={run.report} metrics={run.metrics} artifacts={run.artifacts} />
        </section>
      ) : run.summary ? (
        <p className="text-base font-semibold leading-7 text-fg">{run.summary}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <ButtonLink href={`/print/report/${encodeURIComponent(`run:${run.id}`)}`} variant="secondary" size="sm" target="_blank">
          نسخة للطباعة
        </ButtonLink>
        <ButtonLink href={`/tasks/${encodeURIComponent(job.key)}`} variant="ghost" size="sm">
          صفحة المهمة
        </ButtonLink>
      </div>
    </div>
  );
}
