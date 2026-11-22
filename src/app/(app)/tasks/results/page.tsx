import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { JobNumber } from "@/components/ui/job-number";
import { StateWord } from "@/components/ui/state-word";
import { isKey } from "@/core/dates";
import { DOMAIN_AR } from "@/core/jobs";
import { runWordState } from "@/core/state-word";
import { loadResults } from "@/lib/tasks-view";
import { cn } from "@/lib/utils";
import { requirePage } from "@/server/auth";

export const metadata = { title: "النتائج" };
export const dynamic = "force-dynamic";

const when = (iso: string) => new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

/**
 * المهام ← النتائج: what every run said when it finished, and the periodic reports — newest first; filter by job, area and day. A report with nothing in it is not listed: one line at the end
 * counts them and says why. The same result twice in a row is one line with a count. Never a bracket of JSON: a report of the code is read as sentences on its own page.
 */
export default async function TasksResultsPage({ searchParams: searchParamsP }: { searchParams: Promise<{ job?: string; domain?: string; day?: string }> }) {
  await requirePage("work.view");
  const sp = await searchParamsP;
  const domain = sp.domain === "ads" || sp.domain === "ops" ? sp.domain : undefined;
  const day = isKey(sp.day) ? sp.day : undefined;
  const job = /^[a-z0-9][a-z0-9_.-]{0,79}$/i.test(sp.job ?? "") ? sp.job : undefined;
  const view = await loadResults({ limit: 60, ...(domain ? { domain } : {}), ...(day ? { day } : {}), ...(job ? { jobKey: job } : {}) });
  const href = (d: string | undefined) => `/tasks/results?${[d ? `domain=${d}` : "", day ? `day=${day}` : "", job ? `job=${job}` : ""].filter(Boolean).join("&")}`;
  const chip = (on: boolean) => cn("h-10 max-md:h-11 px-3 text-sm", on && "border-accent bg-accent text-accent-fg");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="المجال">
        {([undefined, "ads", "ops"] as const).map((d) => (
          <Link key={d ?? "all"} href={href(d)} aria-current={d === domain ? "true" : undefined}>
            <Chip className={chip(d === domain)}>{d ? DOMAIN_AR[d] : "الكل"}</Chip>
          </Link>
        ))}
        <form method="get" action="/tasks/results" className="ms-auto flex flex-wrap items-center gap-2">
          {domain ? <Input type="hidden" name="domain" value={domain} readOnly /> : null}
          {job ? <Input type="hidden" name="job" value={job} readOnly /> : null}
          <label className="flex items-center gap-2 text-base text-fg-muted">
            يوم
            <Input type="date" name="day" dir="ltr" defaultValue={day} className="h-11 w-44" />
          </label>
          <Button type="submit" variant="secondary" size="sm">
            اعرض
          </Button>
          {day || job ? (
            <Link href={domain ? `/tasks/results?domain=${domain}` : "/tasks/results"} className="text-base font-semibold text-info hover:underline">
              الكل
            </Link>
          ) : null}
        </form>
      </div>
      {view.rows.length ? (
        <ul className="m-0 list-none divide-y divide-border rounded-2xl border border-border bg-surface-1 p-0">
          {view.rows.map((r) => (
            <li key={r.id}>
              <Link href={r.href} className="block space-y-1 px-4 py-3 hover:bg-surface-2">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {r.jobNumber ? <JobNumber n={r.jobNumber} className="size-8 text-sm" /> : null}
                  <b className="min-w-0 text-base font-bold text-fg">{r.title}</b>
                  {r.status ? <StateWord state={runWordState(r.status)} /> : <Chip>دوري</Chip>}
                  {r.count > 1 ? <Chip>× {r.count}</Chip> : null}
                  <span className="ms-auto text-sm text-fg-muted">{when(r.at)}</span>
                </span>
                {r.summary ? <span className="block text-base text-fg-muted">{r.summary}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="ما في نتائج" hint="لما تخلص مهمة وتنقل نتيجتها بتظهر هون." />
      )}
      {view.hidden > 0 ? (
        <p className="text-base text-fg-muted">
          {view.hidden} تقرير فاضي مخفيين{view.hiddenWhy ? ` — ${view.hiddenWhy}` : ""}
        </p>
      ) : null}
    </div>
  );
}
