import { TasksBoard } from "@/components/tasks/tasks-board";
import { can } from "@/core/roles";
import { loadTasksCustom } from "@/lib/ui-view";
import { currentCaller, requirePage } from "@/server/auth";
import { taskKeysFor } from "@/server/directory";
import { listTasks } from "@/server/tasks";

export const metadata = { title: "مهام الفريق" };
export const dynamic = "force-dynamic";

/** المهام ← مهام الفريق: who does what and by when, on one line each — any task an agent asks for lands here too. Grouped by person (the late ones first), or the five columns. The same board as before, at its new address. */
export default async function TasksTeamPage({ searchParams: searchParamsP }: { searchParams: Promise<{ board?: string }> }) {
  await requirePage(["tasks.own", "tasks.manage"]);
  const searchParams = await searchParamsP;
  const now = new Date();
  const me = await currentCaller();
  const keys = me ? await taskKeysFor(me) : []; // no caller: no tasks
  const tasks = await listTasks({ limit: 300, doneWithinDays: 14, ...(keys ? { assigneeIn: keys } : {}) }, now);
  const custom = await loadTasksCustom(tasks.map((t) => t.id));
  return <TasksBoard initial={tasks} canEdit={!!me && can(me.role, "tasks.manage") && !me.demo} nowIso={now.toISOString()} custom={custom} initialBoard={/^[a-z0-9_-]{1,40}$/i.test(searchParams.board ?? "") ? searchParams.board : undefined} />;
}
