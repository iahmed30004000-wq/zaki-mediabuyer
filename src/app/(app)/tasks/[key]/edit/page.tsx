import { notFound } from "next/navigation";
import { WorkflowEditor } from "@/components/workflow/editor/editor";
import { can } from "@/core/roles";
import { loadWorkflowCards } from "@/lib/workflow-view";
import { currentCaller, requirePage } from "@/server/auth";

export const metadata = { title: "تعديل الخطوات" };
export const dynamic = "force-dynamic";

/**
 * المهام ← مهمة ← تعديل الخطوات. Until the blocks editor is built (P4-1) this is the drawing board that was under the job («متقدّم»): the steps, how they join, a new version on save — at its
 * new address, so nothing links to the old one. The owner edits; everybody else may look.
 */
export default async function TaskEditPage({ params: paramsP }: { params: Promise<{ key: string }> }) {
  await requirePage("work.view");
  const params = await paramsP;
  const key = decodeURIComponent(params.key);
  const [{ cards, demo }, me] = await Promise.all([loadWorkflowCards(), currentCaller()]);
  const card = cards.find((c) => c.key === key);
  if (!card) notFound();
  return <WorkflowEditor card={card} demo={demo} canEdit={!!me && can(me.role, "owner_only")} />;
}
