import { notFound } from "next/navigation";
import { EditSteps } from "@/components/tasks/edit-steps";
import { WorkflowEditor } from "@/components/workflow/editor/editor";
import { BackLink } from "@/components/ui/back-link";
import { ButtonLink } from "@/components/ui/button-link";
import { graphToSteps, OLD_BOARD_NOTE } from "@/core/job-draft";
import { can } from "@/core/roles";
import type { Executor } from "@/core/workflow";
import { loadWorkflowCards } from "@/lib/workflow-view";
import { currentCaller, requirePage } from "@/server/auth";

export const metadata = { title: "تعديل الخطوات" };
export const dynamic = "force-dynamic";

/**
 * المهام ← مهمة ← تعديل الخطوات: the steps as blocks on top of each other (the same ones as «مهمة جديدة»), filled from the drawing the job has; a save is a new version. A drawing that is not
 * a plain line (a fork that meets again, a wait on a clock…) is not understood as blocks: the page says «هالمهمة معدّلة باللوحة القديمة» and opens it on the drawing board — which stays under
 * «متقدّم» (`?view=board`) until the old screens go. The owner edits; everybody else may look at the drawing.
 */
export default async function TaskEditPage({ params: paramsP, searchParams: searchP }: { params: Promise<{ key: string }>; searchParams: Promise<{ view?: string }> }) {
  await requirePage("work.view");
  const params = await paramsP;
  const key = decodeURIComponent(params.key);
  const { view } = await searchP;
  const [{ cards, demo }, me] = await Promise.all([loadWorkflowCards(), currentCaller()]);
  const card = cards.find((c) => c.key === key);
  if (!card) notFound();
  const owner = !!me && can(me.role, "owner_only");
  const lineOf = graphToSteps(card.graph);
  const href = `/tasks/${encodeURIComponent(card.key)}`;

  // the drawing board: for the owner who asked for it («متقدّم») or whose job is not a line, and for anybody else who only looks
  if (!owner || view === "board") {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <BackLink href={owner && lineOf.ok ? `${href}/edit` : href}>{owner && lineOf.ok ? "ارجع للخطوات" : card.name}</BackLink>
        </div>
        <WorkflowEditor card={card} demo={demo} canEdit={owner} />
      </div>
    );
  }
  if (!lineOf.ok) {
    return (
      <div className="space-y-4">
        <BackLink href={href}>{card.name}</BackLink>
        <section className="space-y-3 rounded-2xl border border-border bg-surface-1 p-4">
          <h2 className="font-display text-lg font-extrabold text-fg">{OLD_BOARD_NOTE}</h2>
          <p className="text-base leading-7 text-fg-muted">رسمها مش خط واحد ({lineOf.reason})، فما بينفهم كخطوات فوق بعض. افتحها باللوحة اللي بتعدّل أي رسم.</p>
          <ButtonLink href={`${href}/edit?view=board`} variant="secondary" size="md">
            افتحها باللوحة
          </ButtonLink>
        </section>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <BackLink href={href}>{card.name}</BackLink>
      <EditSteps jobKey={card.key} jobName={card.name} version={card.version} graph={card.graph} executor={card.executor as Executor} demo={demo} />
    </div>
  );
}
