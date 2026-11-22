import Link from "next/link";
import { notFound } from "next/navigation";
import { BranchSwitch, JobControls } from "@/components/work/job-controls";
import { ButtonLink } from "@/components/ui/button-link";
import { Card, CardBody, EmptyState } from "@/components/ui/card";
import { FactsTable } from "@/components/ui/facts-table";
import { JobNumber } from "@/components/ui/job-number";
import { Pill } from "@/components/ui/pill";
import { SectionTitle } from "@/components/ui/section-title";
import { can } from "@/core/roles";
import { loadJobs } from "@/lib/jobs-view";
import { currentCaller, requirePage } from "@/server/auth";
import { listOrders } from "@/server/orders";
import { OrdersSection } from "@/components/work/orders-section";
import { runsOf } from "@/server/workflows";

export const dynamic = "force-dynamic";
export const metadata = { title: "مهمة" };

const when = (iso: string) => new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const STATUS: Record<string, { label: string; tone: "ok" | "danger" | "info" | "neutral" }> = { ok: { label: "خلصت", tone: "ok" }, failed: { label: "فشلت", tone: "danger" }, running: { label: "شغّالة", tone: "info" }, waiting: { label: "منتظرة", tone: "info" }, skipped: { label: "انتخطت", tone: "neutral" } };

/**
 * صفحة المهمة: the header (number · name · domain and kind · badge · its switch) → the facts (when, who runs it, where it came from, what it
 * touches, who it talks to — an empty one is not shown) → what it is → its branches with their switches → the rules it reads → its last
 * ten runs → the agent's note and advice → «شغّلها هلأ» and «متقدّم». The standing orders that touch it are under its description.
 */
export default async function JobPage({ params }: { params: { key: string } }) {
  await requirePage("work.view");
  const key = decodeURIComponent(params.key);
  const [{ jobs }, me, runs] = await Promise.all([loadJobs(), currentCaller(), runsOf(key, { limit: 10 })]);
  const job = jobs.find((j) => j.key === key);
  if (!job) notFound();
  const orders = await listOrders({ job: { key: job.key, domain: job.domain } });
  const owner = !!me && !me.demo && can(me.role, "owner_only");
  const canRun = !!me && !me.demo && can(me.role, "work.control");
  return (
    <div className="space-y-6">
      <Link href="/work" className="text-sm font-semibold text-info hover:underline">
        ← الشغل
      </Link>

      <header className="space-y-3 rounded-card border border-border bg-surface-1 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <JobNumber n={job.number} />
          <h2 className="min-w-0 flex-1 text-xl font-extrabold text-fg">{job.name}</h2>
          <Pill tone={job.badge.tone}>{job.badge.label}</Pill>
        </div>
        <p className="text-sm text-fg-muted">
          {job.domainLabel} · {job.kindLabel}
        </p>
        <JobControls jobKey={job.key} enabled={job.enabled} canSwitch={owner} canRun={canRun} />
      </header>

      <FactsTable
        facts={[
          { label: "الموعد", value: job.words },
          { label: "بتشتغل من", value: job.facts.runsFrom ?? job.runner },
          { label: "من وين إجت", value: job.facts.origin },
          { label: "بتلمس", value: job.facts.touches.join("، ") },
          { label: "بتحكي مع", value: job.facts.talksTo.join("، ") },
        ]}
      />

      {job.description ? (
        <section className="space-y-2">
          <SectionTitle>شو بتعمل</SectionTitle>
          <p className="text-sm leading-7 text-fg">{job.description}</p>
        </section>
      ) : null}

      <OrdersSection orders={orders} scope={{ domain: job.domain, jobKeys: [job.key] }} canCreate={canRun} canEnd={owner} />

      <section className="space-y-3">
        <SectionTitle hint="كل فرع إله رقم ومفتاح. الإطفاء بيحفظ نسخة جديدة من الرسم.">الفروع</SectionTitle>
        <Card>
          <ul className="divide-y divide-border">
            {job.branches.map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-4 py-3">
                <span dir="ltr" className="w-10 shrink-0 text-sm font-extrabold tabular-nums text-fg-muted">
                  {b.number ?? "·"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={b.disabled ? "text-sm font-semibold text-fg-muted line-through" : "text-sm font-semibold text-fg"}>{b.label}</span>
                  {b.desc ? <span className="block text-xs text-fg-muted">{b.desc}</span> : null}
                </span>
                {owner ? <BranchSwitch jobKey={job.key} graph={job.graph} nodeId={b.id} disabled={b.disabled} /> : null}
              </li>
            ))}
            {!job.branches.length ? <li className="px-4 py-3 text-sm text-fg-muted">ما في فروع مرسومة.</li> : null}
          </ul>
        </Card>
      </section>

      <section className="space-y-2">
        <SectionTitle>القواعد اللي بتقراها</SectionTitle>
        <p className="text-sm leading-7 text-fg-muted">بتقرا قواعدك من الإعدادات: السقوف وتوزيع الميزانية، ونقطة التعادل لكل منتج، ومستوى كل حساب، وأحكام الحملات. ما بتغيّرها هي.</p>
        {owner ? (
          <Link href="/settings/rules" className="text-sm font-semibold text-info hover:underline">
            عدّل القواعد
          </Link>
        ) : null}
      </section>

      <section className="space-y-3">
        <SectionTitle>آخر التشغيلات</SectionTitle>
        {runs.length ? (
          <Card>
            <ul className="divide-y divide-border">
              {runs.map((r) => {
                const s = STATUS[r.status] ?? { label: r.status, tone: "neutral" as const };
                return (
                  <li key={r.id} className="space-y-1.5 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Pill tone={s.tone}>{s.label}</Pill>
                      <span className="text-xs text-fg-muted">{when(r.startedAt)}</span>
                      {r.summary ? <span className="min-w-0 flex-1 text-sm text-fg">{r.summary}</span> : null}
                    </div>
                    {r.report ? (
                      <details className="text-sm">
                        <summary className="cursor-pointer font-semibold text-info">التقرير</summary>
                        <p className="mt-2 whitespace-pre-wrap leading-7 text-fg">{r.report}</p>
                      </details>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : (
          <EmptyState title="ما اشتغلت لسا" hint="أول ما Claude يشغّلها وينقل نتيجتها بـ log_run بتظهر هون." />
        )}
      </section>

      {job.note || job.advice ? (
        <section className="space-y-2">
          <SectionTitle>ملاحظة الوكيل</SectionTitle>
          <Card>
            <CardBody className="space-y-2">
              {job.note ? <p className="text-sm leading-7 text-fg">{job.note}</p> : null}
              {job.advice ? (
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <Pill tone="warn">توصيته: {job.advice.label}</Pill>
                  {job.advice.text ? <span className="text-fg">{job.advice.text}</span> : null}
                </p>
              ) : null}
            </CardBody>
          </Card>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <ButtonLink href={`/work/job/${encodeURIComponent(job.key)}/draw`} variant="secondary">
          افتح رسم المهمة
        </ButtonLink>
        <span className="text-sm text-fg-muted">{owner ? "الفروع وكيف بتتوصّل، وبتعدّلها وبترجع لأي نسخة." : "الفروع وكيف بتتوصّل (قراءة)."}</span>
      </div>
    </div>
  );
}
