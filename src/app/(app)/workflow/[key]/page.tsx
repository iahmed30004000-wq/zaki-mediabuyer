import { notFound } from "next/navigation";
import { WorkflowEditor } from "@/components/workflow/editor/editor";
import { can } from "@/core/roles";
import { loadWorkflowCards } from "@/lib/workflow-view";
import { currentCaller } from "@/server/auth";

export const metadata = { title: "رسم الورك فلو" };
export const dynamic = "force-dynamic";

/**
 * The drawing board of one workflow: drag its steps, join them, put a step on a line, see the run that is going, save a new
 * version. It lives inside الورك فلو (not a place of its own). The owner edits; everybody else may look.
 */
export default async function WorkflowEditPage({ params }: { params: { key: string } }) {
  const [{ cards, demo }, me] = await Promise.all([loadWorkflowCards(), currentCaller()]);
  const card = cards.find((c) => c.key === params.key);
  if (!card) notFound();
  return <WorkflowEditor card={card} demo={demo} canEdit={!!me && can(me.role, "owner_only")} />;
}
