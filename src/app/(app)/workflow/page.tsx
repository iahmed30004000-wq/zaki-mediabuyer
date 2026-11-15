import { WorkflowBoard } from "@/components/workflow/workflow-board";
import { can } from "@/core/roles";
import { loadWorkflowCards } from "@/lib/workflow-view";
import { listHandoffs } from "@/server/handoffs";
import { currentCaller } from "@/server/auth";

export const metadata = { title: "الورك فلو" };
export const dynamic = "force-dynamic";

/** الورك فلو: the work that runs — who does it, when, what came out — and, while Claude runs a job, the job moving. */
export default async function WorkflowPage() {
  const [{ cards, demo }, me] = await Promise.all([loadWorkflowCards(), currentCaller()]);
  // the handoff queue is real data: on the demo there is nothing in it
  const handoffs = demo ? [] : await listHandoffs({ status: ["open", "claimed"] });
  return <WorkflowBoard initial={cards} initialHandoffs={handoffs} demo={demo} canEdit={!!me && can(me.role, "owner_only") && !me.demo} />;
}
