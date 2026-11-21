import { WorkMap } from "@/components/work/work-map";
import { can } from "@/core/roles";
import { loadJobs } from "@/lib/jobs-view";
import { currentCaller, requirePage } from "@/server/auth";

export const metadata = { title: "الشغل" };
export const dynamic = "force-dynamic";

/**
 * الشغل ← المجدولة: the map of the scheduled jobs — every job with its number, its badge, when it runs and who runs it, its branches, and its
 * last result. Claude sends the map (`push_jobs`); until then these are the jobs the site was seeded with. «ورقة القرار» (the owner's) turns
 * the map into one table where he keeps or cancels jobs and branches at once. The drawing of a job is under «متقدّم» on its page.
 */
export default async function WorkPage() {
  await requirePage("work.view");
  const [{ jobs, counters }, me] = await Promise.all([loadJobs(), currentCaller()]);
  return <WorkMap jobs={jobs} counters={counters} canDecide={!!me && !me.demo && can(me.role, "owner_only")} />;
}
