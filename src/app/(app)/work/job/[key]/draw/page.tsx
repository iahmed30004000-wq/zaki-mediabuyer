import { notFound } from "next/navigation";
import { WorkflowEditor } from "@/components/workflow/editor/editor";
import { can } from "@/core/roles";
import { loadWorkflowCards } from "@/lib/workflow-view";
import { currentCaller, requirePage } from "@/server/auth";

export const metadata = { title: "رسم المهمة" };
export const dynamic = "force-dynamic";

/**
 * The drawing board of one job: drag its branches, join them, put one on a line, see the run that is going, save a new version.
 * (Advanced: it lives under the job's page.) The owner edits; everybody else may look.
 */
export default async function JobDrawPage({ params }: { params: { key: string } }) {
  await requirePage("work.view");
  const [{ cards, demo }, me] = await Promise.all([loadWorkflowCards(), currentCaller()]);
  const card = cards.find((c) => c.key === params.key);
  if (!card) notFound();
  return <WorkflowEditor card={card} demo={demo} canEdit={!!me && can(me.role, "owner_only")} />;
}
