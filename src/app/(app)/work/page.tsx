import { WorkMap } from "@/components/work/work-map";
import { ButtonLink } from "@/components/ui/button-link";
import { loadJobs } from "@/lib/jobs-view";

export const metadata = { title: "الشغل" };
export const dynamic = "force-dynamic";

/**
 * الشغل ← المجدولة: the map of the scheduled jobs — every job with its number, its badge, when it runs and who runs it, its branches, and its
 * last result. Claude sends the map (`push_jobs`, P6); until then these are the jobs the site was seeded with. A job nobody can finish is a
 * decision in «بانتظارك». The drawing of a job is under «متقدّم» on its page.
 */
export default async function WorkPage() {
  const { jobs, counters } = await loadJobs();
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ButtonLink href="/print/work" variant="secondary" size="sm" target="_blank">
          نسخة للطباعة
        </ButtonLink>
      </div>
      <WorkMap jobs={jobs} counters={counters} />
    </div>
  );
}
