import { TasksBoard } from "@/components/tasks/tasks-board";
import { can } from "@/core/roles";
import { loadTasksCustom } from "@/lib/ui-view";
import { currentCaller } from "@/server/auth";
import { taskKeysFor } from "@/server/directory";
import { listTasks } from "@/server/tasks";

export const metadata = { title: "مهام الفريق" };
export const dynamic = "force-dynamic";

/** الشغل ← مهام الفريق: who does what and by when, on one line each — any task Claude or Hermes asks for lands here too. Grouped by person (the late ones first), or the five columns. */
export default async function WorkTasksPage() {
  const now = new Date();
  const me = await currentCaller();
  const keys = me ? await taskKeysFor(me) : null;
  const tasks = await listTasks({ limit: 300, doneWithinDays: 14, ...(keys ? { assigneeIn: keys } : {}) }, now);
  const custom = await loadTasksCustom(tasks.map((t) => t.id));
  return <TasksBoard initial={tasks} canEdit={!!me && can(me.role, "tasks.manage") && !me.demo} nowIso={now.toISOString()} custom={custom} />;
}
