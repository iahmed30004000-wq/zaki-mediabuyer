import { notFound } from "next/navigation";
import { ReportView } from "@/components/tasks/report-view";
import { BackLink } from "@/components/ui/back-link";
import { ButtonLink } from "@/components/ui/button-link";
import { JobNumber } from "@/components/ui/job-number";
import { StateWord } from "@/components/ui/state-word";
import { runWordState } from "@/core/state-word";
import { runHref } from "@/core/tasks-view";
import { getReport } from "@/server/reports";
import { requirePage } from "@/server/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "نتيجة" };

const when = (iso: string) => new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

/** One result: the sentence the run ended with, its report as sentences and a table, the numbers with the owner's names, the links it left — and a copy for paper. */
export default async function TasksResultPage({ params: paramsP }: { params: Promise<{ id: string }> }) {
  await requirePage("work.view");
  const params = await paramsP;
  const id = decodeURIComponent(params.id);
  const r = await getReport(id);
  if (!r) notFound();
  const runId = id.startsWith("run:") ? id.slice(4) : null;
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <BackLink href="/tasks/results">النتائج</BackLink>
      <header className="space-y-3 rounded-2xl border border-border bg-surface-1 p-4">
        <div className="flex flex-wrap items-center gap-3">
          {r.jobKey ? <JobNumber n={r.jobNumber} /> : null}
          <h2 className="min-w-0 flex-1 font-display text-lg font-extrabold text-fg">{r.title}</h2>
          {r.status ? <StateWord state={runWordState(r.status)} /> : null}
        </div>
        <p className="text-base text-fg-muted">{when(r.at)}</p>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/print/report/${encodeURIComponent(r.id)}`} variant="secondary" size="sm" target="_blank">
            نسخة للطباعة
          </ButtonLink>
          {r.jobKey && runId ? (
            <ButtonLink href={runHref(r.jobKey, runId)} variant="ghost" size="sm">
              شوف التشغيل
            </ButtonLink>
          ) : null}
          {r.jobKey ? (
            <ButtonLink href={`/tasks/${encodeURIComponent(r.jobKey)}`} variant="ghost" size="sm">
              صفحة المهمة
            </ButtonLink>
          ) : null}
        </div>
      </header>
      {r.summary ? <p className="text-base font-semibold leading-7 text-fg">{r.summary}</p> : null}
      {r.text || r.metrics.length || r.artifacts.length ? (
        <ReportView text={r.text} metrics={Object.fromEntries(r.metrics.map((m) => [m.label, m.value]))} artifacts={r.artifacts.map((a) => ({ label: a.label, ...(a.url ? { url: a.url } : {}), ...(a.text ? { text: a.text } : {}) }))} />
      ) : (
        <p className="rounded-2xl border border-dashed border-border p-4 text-base text-fg-muted">هالتشغيل ما بعت تقرير كامل — بس السطر فوق.</p>
      )}
    </div>
  );
}
