import { WorkflowBoard } from "@/components/workflow/workflow-board";
import { can } from "@/core/roles";
import { loadWorkflowCards } from "@/lib/workflow-view";
import { loadEntityCustom } from "@/lib/ui-view";
import { listHandoffs } from "@/server/handoffs";
import { currentCaller } from "@/server/auth";

export const metadata = { title: "الشغل" };
export const dynamic = "force-dynamic";

/** الشغل ← المجدولة: the work that runs — who does it, when, what came out — and, while Claude runs a job, the job moving. P5 rebuilds it as the map. */
export default async function WorkPage() {
  const [{ cards, demo }, me] = await Promise.all([loadWorkflowCards(), currentCaller()]);
  // the handoff queue is real data: on the demo there is nothing in it
  const handoffs = demo ? [] : await listHandoffs({ status: ["open", "claimed"] });
  const custom = await loadEntityCustom("workflow", cards.map((c) => c.key));
  return <WorkflowBoard initial={cards} initialHandoffs={handoffs} demo={demo} canEdit={!!me && can(me.role, "owner_only") && !me.demo} custom={custom} canCustom={!!me && !me.demo && can(me.role, "propose_change")} />;
}
