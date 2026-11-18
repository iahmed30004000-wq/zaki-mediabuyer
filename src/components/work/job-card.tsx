import Link from "next/link";
import { Check, X } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { JobNumber } from "@/components/ui/job-number";
import { Pill } from "@/components/ui/pill";
import type { JobView } from "@/lib/jobs-view";
import { cn } from "@/lib/utils";

const when = (iso: string) => new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const MAX_CHIPS = 6;

/**
 * One job on the map: its number, its name and badge → when it runs and who runs it → its branches (the switched-off one struck) → ONE line:
 * the last result (✓/✗, when, the summary), or the next run, or the advice that waits for the owner's decision.
 */
export function JobCard({ job }: { job: JobView }) {
  const shown = job.branches.slice(0, MAX_CHIPS);
  const more = job.branches.length - shown.length;
  return (
    <Link href={`/work/job/${encodeURIComponent(job.key)}`} className={cn("block space-y-2.5 rounded-card border border-border bg-surface-1 p-4 transition-colors hover:border-fg-muted", !job.enabled && "opacity-70")} data-job={job.key}>
      <div className="flex items-center gap-3">
        <JobNumber n={job.number} />
        <h3 className="min-w-0 flex-1 text-base font-extrabold leading-6 text-fg">{job.name}</h3>
        <Pill tone={job.badge.tone}>{job.badge.label}</Pill>
      </div>
      <p className="text-sm text-fg-muted">
        {job.words} · {job.runner}
      </p>
      {shown.length ? (
        <div className="flex flex-wrap gap-1.5">
          {shown.map((b) => (
            <Chip key={b.id} off={b.disabled} className="max-w-full">
              {b.number ? <span dir="ltr">{b.number}</span> : null}
              <span className="truncate">{b.label}</span>
            </Chip>
          ))}
          {more > 0 ? <Chip>+{more}</Chip> : null}
        </div>
      ) : null}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {job.advice && !job.decision ? (
          <Pill tone="warn">توصية: {job.advice.label}</Pill>
        ) : job.last ? (
          <>
            {job.last.ok === true ? <Check aria-label="خلصت" className="size-4 text-ok" /> : job.last.ok === false ? <X aria-label="فشلت" className="size-4 text-danger" /> : null}
            <span className="text-xs text-fg-muted">{when(job.last.at)}</span>
            {job.last.summary ? <span className="min-w-0 truncate text-fg">{job.last.summary}</span> : null}
          </>
        ) : job.next ? (
          <span className="text-fg-muted">الجاي: {when(job.next)}</span>
        ) : (
          <span className="text-fg-muted">ما اشتغلت لسا</span>
        )}
      </p>
    </Link>
  );
}
