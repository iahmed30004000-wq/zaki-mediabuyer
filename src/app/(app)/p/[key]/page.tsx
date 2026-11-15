import { notFound, redirect } from "next/navigation";
import { TasksBoard } from "@/components/tasks/tasks-board";
import { effectivePages } from "@/core/customize";
import { can } from "@/core/roles";
import { BUILTIN_PAGES } from "@/lib/nav";
import { loadTasksCustom } from "@/lib/ui-view";
import { currentCaller } from "@/server/auth";
import { listTasks } from "@/server/tasks";
import { getUiConfig } from "@/server/ui-config";

export const dynamic = "force-dynamic";

async function pageOf(key: string) {
  const page = effectivePages(await getUiConfig(), BUILTIN_PAGES).find((p) => p.key === key && !p.builtin);
  return page && !page.archived ? page : null;
}

export async function generateMetadata({ params }: { params: { key: string } }) {
  return { title: (await pageOf(params.key))?.label ?? "صفحة" };
}

/**
 * A page the owner made in «وضع التعديل»: one board of tasks on its own (with its fields and buttons), or a link — which just goes
 * there. It lives at /p/<key>; the sidebar and the phone's bar point at it. Not a new place: it is the board, shown alone.
 */
export default async function CustomPage({ params }: { params: { key: string } }) {
  const page = await pageOf(params.key);
  if (!page) notFound();
  if (page.kind === "link") redirect(page.href);
  const board = page.board ?? "main";
  const now = new Date();
  const [tasks, me] = await Promise.all([listTasks({ board, limit: 300, doneWithinDays: 14 }, now), currentCaller()]);
  const custom = await loadTasksCustom(tasks.map((t) => t.id));
  return (
    <div className="space-y-4">
      <TasksBoard initial={tasks} canEdit={!!me && can(me.role, "propose_change") && !me.demo} nowIso={now.toISOString()} custom={custom} lockedBoard={board} />
    </div>
  );
}
