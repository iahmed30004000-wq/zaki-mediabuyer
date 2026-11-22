import { LiveRefresh } from "@/components/tasks/live";
import { NowLanes } from "@/components/tasks/now-lanes";
import { can } from "@/core/roles";
import { loadNow } from "@/lib/tasks-view";
import { currentCaller, requirePage } from "@/server/auth";
import { taskKeysFor } from "@/server/directory";

export const metadata = { title: "المهام" };
export const dynamic = "force-dynamic";

/**
 * المهام ← هلق: the lanes — what waits for somebody, what was missed, what is going, what comes today, what the team owes, what finished. An empty lane is not drawn. The page follows what
 * is going on by itself (the live answer every 5 seconds while a run is going) and reads itself again when a run moves.
 */
export default async function TasksPage() {
  await requirePage("work.view");
  const me = await currentCaller();
  const keys = me ? await taskKeysFor(me) : [];
  const data = await loadNow({ taskKeys: keys });
  return (
    <div className="space-y-5">
      <LiveRefresh />
      {data.needs > 0 ? (
        <p role="status" className="text-base font-bold text-warn">
          {data.needs === 1 ? "مهمة وحدة بدها حدا" : `${data.needs} مهام بدها حدا`}
        </p>
      ) : null}
      <NowLanes data={data} canControl={!!me && !me.demo && can(me.role, "work.control")} />
    </div>
  );
}
