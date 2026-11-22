import { notFound } from "next/navigation";
import { EditSteps } from "@/components/tasks/edit-steps";
import { BackLink } from "@/components/ui/back-link";
import { ButtonLink } from "@/components/ui/button-link";
import { graphToSteps, OLD_BOARD_NOTE, VERB_AR } from "@/core/job-draft";
import { can } from "@/core/roles";
import type { Executor, WfGraph } from "@/core/workflow";
import { TYPE_AR } from "@/core/workflow-edit";
import { loadWorkflowCards } from "@/lib/workflow-view";
import { currentCaller, requirePage } from "@/server/auth";

export const metadata = { title: "تعديل الخطوات" };
export const dynamic = "force-dynamic";

/** What a drawing says when it is not a plain line, one step per line in the order it was drawn: read only (the drawing board is gone — v6 · P8, Q4). */
function StepsList({ graph }: { graph: WfGraph }) {
  return (
    <ol className="list-decimal space-y-1 ps-5 text-base text-fg">
      {graph.nodes.map((n) => (
        <li key={n.id}>{`${TYPE_AR[n.type]}: ${n.label}`}</li>
      ))}
    </ol>
  );
}

/**
 * المهام ← مهمة ← تعديل الخطوات: the steps as blocks on top of each other (the same ones as «مهمة جديدة»), filled from the drawing the job has; a save is a new version. A drawing that is not
 * a plain line (a fork that meets again, a wait on a clock…) is not understood as blocks: the page says so and lists its steps, read only — the drawing board that used to open it was
 * removed (v6 · P8, Q4). The owner edits; everybody else may look.
 */
export default async function TaskEditPage({ params: paramsP }: { params: Promise<{ key: string }> }) {
  await requirePage("work.view");
  const params = await paramsP;
  const key = decodeURIComponent(params.key);
  const [{ cards, demo }, me] = await Promise.all([loadWorkflowCards(), currentCaller()]);
  const card = cards.find((c) => c.key === key);
  if (!card) notFound();
  const owner = !!me && can(me.role, "owner_only");
  const lineOf = graphToSteps(card.graph);
  const href = `/tasks/${encodeURIComponent(card.key)}`;

  // a recipe is the site's own: its three steps are written in code, so there are no blocks to edit — the page says so and shows what it does
  if (card.recipe) {
    return (
      <div className="space-y-4">
        <BackLink href={href}>{card.name}</BackLink>
        <section className="space-y-3 rounded-2xl border border-border bg-surface-1 p-4">
          <h2 className="font-display text-lg font-extrabold text-fg">هاي وصفة جاهزة — خطواتها ثابتة</h2>
          <p className="text-base leading-7 text-fg-muted">الموقع بينفّذها لحاله بأرقامه، فما في بلوكات تتعدّل. لو بدك غيرها، اعمل مهمة جديدة بوصفة تانية أو بنفس الوصفة وحدودك الجداد.</p>
          {lineOf.ok ? (
            <ol className="list-decimal space-y-1 ps-5 text-base text-fg">
              {lineOf.steps.map((s, i) => (
                <li key={i}>{`${VERB_AR[s.verb]}: ${s.text}`}</li>
              ))}
            </ol>
          ) : null}
          <ButtonLink href={href} variant="secondary" size="md">
            ارجع للمهمة
          </ButtonLink>
        </section>
      </div>
    );
  }
  // a drawing that is not a line, or a person who may only look: the steps, read only
  if (!lineOf.ok || !owner) {
    return (
      <div className="space-y-4">
        <BackLink href={href}>{card.name}</BackLink>
        <section className="space-y-3 rounded-2xl border border-border bg-surface-1 p-4">
          <h2 className="font-display text-lg font-extrabold text-fg">{lineOf.ok ? "خطوات المهمة" : OLD_BOARD_NOTE}</h2>
          {lineOf.ok ? null : <p className="text-base leading-7 text-fg-muted">رسمها مش خط واحد ({lineOf.reason})، فما بتتعدّل كخطوات فوق بعض. هاي خطواتها كما هي؛ بتقدر تطلب من المساعد يعدّلها، أو تعمل مهمة جديدة بدالها.</p>}
          <StepsList graph={card.graph} />
          <ButtonLink href={href} variant="secondary" size="md">
            ارجع للمهمة
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
