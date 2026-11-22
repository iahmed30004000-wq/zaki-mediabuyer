import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/button-link";
import { Card, CardBody } from "@/components/ui/card";
import { FactsTable } from "@/components/ui/facts-table";
import { JobNumber } from "@/components/ui/job-number";
import { Pill } from "@/components/ui/pill";
import { SectionTitle } from "@/components/ui/section-title";
import { getReport } from "@/server/reports";
import { requirePage } from "@/server/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "تقرير" };

const when = (iso: string) => new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const STATE: Record<string, { label: string; tone: "ok" | "danger" | "info" | "neutral" }> = { ok: { label: "خلصت", tone: "ok" }, failed: { label: "فشلت", tone: "danger" }, running: { label: "شغّالة", tone: "info" }, waiting: { label: "منتظرة", tone: "info" }, skipped: { label: "انتخطت", tone: "neutral" } };

/** One report: the full text, the run's numbers as a table, the links it left, and a copy for paper. */
export default async function ReportPage({ params: paramsP }: { params: Promise<{ id: string }> }) {
  await requirePage("work.view");
  const params = await paramsP;
  const id = decodeURIComponent(params.id);
  const r = await getReport(id);
  if (!r) notFound();
  const s = r.status ? (STATE[r.status] ?? { label: r.status, tone: "neutral" as const }) : null;
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/work/reports" className="text-sm font-semibold text-info hover:underline">
        ← التقارير
      </Link>
      <header className="space-y-3 rounded-card border border-border bg-surface-1 p-4">
        <div className="flex flex-wrap items-center gap-3">
          {r.jobKey ? <JobNumber n={r.jobNumber} /> : null}
          <h2 className="min-w-0 flex-1 text-xl font-extrabold text-fg">{r.title}</h2>
          {s ? <Pill tone={s.tone}>{s.label}</Pill> : null}
        </div>
        <p className="text-sm text-fg-muted">{when(r.at)}</p>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/print/report/${encodeURIComponent(r.id)}`} variant="secondary" size="sm" target="_blank">
            نسخة للطباعة
          </ButtonLink>
          {r.jobKey ? (
            <ButtonLink href={`/work/job/${encodeURIComponent(r.jobKey)}`} variant="ghost" size="sm">
              صفحة المهمة
            </ButtonLink>
          ) : null}
        </div>
      </header>

      {r.summary ? <p className="text-base font-semibold leading-7 text-fg">{r.summary}</p> : null}

      {r.text ? (
        <Card>
          <CardBody>
            <p className="whitespace-pre-wrap text-sm leading-7 text-fg">{r.text}</p>
          </CardBody>
        </Card>
      ) : (
        <p className="rounded-card border border-dashed border-border p-4 text-sm text-fg-muted">هالتشغيل ما بعت تقرير كامل — بس السطر فوق.</p>
      )}

      {r.metrics.length ? (
        <section className="space-y-2">
          <SectionTitle>أرقام التشغيل</SectionTitle>
          <FactsTable facts={r.metrics.map((m) => ({ label: m.label, value: <span dir="ltr">{m.value}</span> }))} />
        </section>
      ) : null}

      {r.artifacts.length ? (
        <section className="space-y-2">
          <SectionTitle>الروابط</SectionTitle>
          <ul className="space-y-1.5 text-sm">
            {r.artifacts.map((a, i) => (
              <li key={`${a.label}-${i}`}>
                {a.url ? (
                  <a href={a.url} target="_blank" rel="noreferrer noopener" className="font-semibold text-info hover:underline">
                    {a.label}
                  </a>
                ) : (
                  <span className="font-semibold text-fg">{a.label}</span>
                )}
                {a.text ? <span className="text-fg-muted"> — {a.text}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
