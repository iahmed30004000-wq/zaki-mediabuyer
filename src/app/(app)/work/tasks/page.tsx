import { TasksBoard } from "@/components/tasks/tasks-board";
import { can } from "@/core/roles";
import { loadTasksCustom } from "@/lib/ui-view";
import { currentCaller } from "@/server/auth";
import { listTasks } from "@/server/tasks";

export const metadata = { title: "مهام الفريق" };
export const dynamic = "force-dynamic";

/** الشغل ← مهام الفريق: who does what and by when, on one line each — any task Claude or Hermes asks for lands here too. P6 regroups it by person. */
export default async function WorkTasksPage() {
  const now = new Date();
  const [tasks, me] = await Promise.all([listTasks({ limit: 300, doneWithinDays: 14 }, now), currentCaller()]);
  const custom = await loadTasksCustom(tasks.map((t) => t.id));
  return <TasksBoard initial={tasks} canEdit={!!me && can(me.role, "propose_change") && !me.demo} nowIso={now.toISOString()} custom={custom} />;
}
