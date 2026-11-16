import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Pill } from "@/components/ui/pill";
import { isKey } from "@/core/dates";
import { DOMAIN_AR } from "@/core/jobs";
import { loadReports } from "@/server/reports";
import { cn } from "@/lib/utils";

export const metadata = { title: "التقارير" };
export const dynamic = "force-dynamic";

const when = (iso: string) => new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const STATE: Record<string, { label: string; tone: "ok" | "danger" | "info" | "neutral" }> = { ok: { label: "خلصت", tone: "ok" }, failed: { label: "فشلت", tone: "danger" }, running: { label: "شغّالة", tone: "info" }, waiting: { label: "منتظرة", tone: "info" }, skipped: { label: "انتخطت", tone: "neutral" } };

/** الشغل ← التقارير: every run's report and the periodic ones, newest first; filter by domain and by day. The old `?r=<id>` opens that report. */
export default async function WorkReportsPage({ searchParams }: { searchParams: { r?: string; domain?: string; day?: string } }) {
  if (searchParams.r) redirect(`/work/reports/${encodeURIComponent(`report:${searchParams.r}`)}`);
  const domain = searchParams.domain === "ads" || searchParams.domain === "ops" ? searchParams.domain : undefined;
  const day = isKey(searchParams.day) ? searchParams.day : undefined;
  const rows = await loadReports({ limit: 60, ...(domain ? { domain } : {}), ...(day ? { day } : {}) });
  const href = (d: string | undefined) => `/work/reports${d ? `?domain=${d}${day ? `&day=${day}` : ""}` : day ? `?day=${day}` : ""}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="المجال">
        {([undefined, "ads", "ops"] as const).map((d) => (
          <Link key={d ?? "all"} href={href(d)} aria-current={d === domain ? "true" : undefined}>
            <Chip className={cn("h-8 px-3 text-sm", d === domain && "border-accent bg-accent text-accent-fg")}>{d ? DOMAIN_AR[d] : "الكل"}</Chip>
          </Link>
        ))}
        <form method="get" className="ms-auto flex items-center gap-2 text-sm">
          {domain ? <input type="hidden" name="domain" value={domain} /> : null}
          <label className="flex items-center gap-2 text-fg-muted">
            يوم
            <input type="date" name="day" defaultValue={day} className="h-10 rounded-lg border border-border bg-surface-1 px-2 text-sm text-fg" />
          </label>
          <Button type="submit" variant="secondary">
            اعرض
          </Button>
          {day ? (
            <Link href={href(domain)} className="text-sm font-semibold text-info hover:underline">
              الكل
            </Link>
          ) : null}
        </form>
      </div>
      {rows.length ? (
        <ul className="divide-y divide-border rounded-card border border-border bg-surface-1">
          {rows.map((r) => {
            const s = r.status ? (STATE[r.status] ?? { label: r.status, tone: "neutral" as const }) : null;
            return (
              <li key={r.id}>
                <Link href={r.href} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-2">
                  {r.jobNumber ? <span dir="ltr" className="text-sm font-extrabold tabular-nums text-fg-muted">{r.jobNumber}</span> : null}
                  <span className="text-sm font-bold text-fg">{r.title}</span>
                  {s ? <Pill tone={s.tone}>{s.label}</Pill> : <Chip>دوري</Chip>}
                  {r.hasFull ? <Chip>تقرير كامل</Chip> : null}
                  <span className="ms-auto text-xs text-fg-muted">{when(r.at)}</span>
                  {r.summary ? <span className="basis-full text-sm text-fg-muted">{r.summary}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title="ما في تقارير" hint="لما Claude يخلّص تشغيل وينقل نتيجته بـ log_run، بيطلع تقريره هون." />
      )}
    </div>
  );
}
