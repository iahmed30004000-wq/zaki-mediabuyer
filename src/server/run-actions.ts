/**
 * THE OWNER'S BUTTONS ON A RUN THAT STOPPED (docs/rebuild-v6/01-model.md §8): «أعد المحاولة من هون» · «تخطّى هالخطوة» · «ألغِ التشغيل» · «سلّمها لغيره».
 * The site never runs the steps (the agent does): a retry or a skip puts the run back in the queue as a «كمّل من الخطوة N» request for the job's own
 * agent, and the agent is told by the next `log_run` answer (`stop`, `disabled_steps`). Nothing here touches Meta, spends, or approves.
 */
import type { Prisma } from "@prisma/client";
import { isTerminalRun, resumePoint, retryNodeState, skipNodeState, stepAfter } from "@/core/run-state";
import { GraphSchema, type NodeStates } from "@/core/workflow";
import { audit, type Actor } from "./audit";
import { db } from "./db";
import { HandoffRefused, createHandoff, reassignHandoff, type HandoffView } from "./handoffs";
import { logRun, runView, type RunView } from "./workflows";

const json = (v: unknown) => v as Prisma.InputJsonValue;

export const RUN_ACTIONS = ["retry", "skip", "cancel", "reassign"] as const;
export type RunAction = (typeof RUN_ACTIONS)[number];

export interface RunActionResult {
  run: RunView;
  handoff?: HandoffView;
}

async function load(key: string, runId: string) {
  const wf = await db.workflow.findUnique({ where: { key } });
  if (!wf) throw new HandoffRefused("المهمة مش موجودة", 404);
  const run = await db.workflowRun.findFirst({ where: { id: runId, workflowId: wf.id } });
  if (!run) throw new HandoffRefused("التشغيل مش موجود", 404);
  return { wf, run, states: ((run.nodeStates as unknown as NodeStates) ?? {}) as NodeStates };
}

const ownerKey = (a: Actor) => (a.id ? `${a.type}:${a.id}` : a.type).slice(0, 60);

/** The owner took the run over: the requests still open for it have nothing left to ask. */
async function closeOpenRequests(wfKey: string, ref: string, actor: Actor, now: Date): Promise<number> {
  const r = await db.handoff.updateMany({ where: { workflowKey: wfKey, runRef: ref, status: { in: ["open", "claimed"] } }, data: { status: "cancelled", doneBy: ownerKey(actor), doneAt: now, resultNote: "المالك أخد التشغيل" } });
  return r.count;
}

/**
 * Puts a run that stopped (failed · lost, or waiting on a step that failed) back in the queue from where it stopped. The step goes back to
 * «بالانتظار» one try more, the run is `queued`, and a «كمّل من الخطوة N» request goes to the job's agent.
 */
export async function retryRun(key: string, runId: string, actor: Actor, now = new Date()): Promise<RunActionResult> {
  const { wf, run, states } = await load(key, runId);
  const stoppedWaiting = run.status === "waiting" && Object.values(states).some((s) => s.status === "failed");
  if (run.status !== "failed" && run.status !== "lost" && !stoppedWaiting) throw new HandoffRefused("التشغيل مش واقف — ما في شي تعيد محاولته", 409);
  if (run.endReason === "cancelled") throw new HandoffRefused("إنت لغيت هالتشغيل — شغّل واحد جديد", 409);
  const graph = GraphSchema.parse(wf.graph);
  const point = resumePoint(graph, states);
  if (!point) throw new HandoffRefused("كل الخطوات خلصت — ما في شي تكمّله", 409);

  const at = now.toISOString();
  const moved = await db.workflowRun.updateMany({
    where: { id: run.id, status: run.status },
    data: { status: "queued", finishedAt: null, endReason: null, nodeStates: json(retryNodeState(states, point.node.id, at)) },
  });
  if (!moved.count) throw new HandoffRefused("حدا غيّر التشغيل قبلك — حدّث الصفحة", 409);
  await closeOpenRequests(wf.key, run.ref, actor, now);
  const was = states[point.node.id];
  const r = await createHandoff({ workflow: wf.key, kind: "resume", node: point.node.id, title: `كمّل من الخطوة ${point.n}: ${point.node.label}`.slice(0, 160), ...(was?.error ? { last_error: was.error } : {}), run_ref: run.ref }, actor, now);
  await audit(actor, "run.retry", { type: "workflow_run", id: run.id }, { after: { job: wf.key, node: point.node.id, attempt: (was?.attempt ?? 1) + 1 } });
  return { run: runView(await db.workflowRun.findUniqueOrThrow({ where: { id: run.id } })), handoff: r.handoff };
}

/**
 * «تخطّى هالخطوة»: the step that failed (or waits for a decision) is set aside, and the run goes on from the step after it. When it was the last step,
 * the run ends `ok`.
 */
export async function skipRunStep(key: string, runId: string, actor: Actor, now = new Date(), nodeId?: string): Promise<RunActionResult> {
  const { wf, run, states } = await load(key, runId);
  if (run.status !== "failed" && run.status !== "lost" && run.status !== "waiting") throw new HandoffRefused("التشغيل مش واقف — ما في خطوة تتخطّاها", 409);
  if (run.endReason === "cancelled") throw new HandoffRefused("إنت لغيت هالتشغيل — شغّل واحد جديد", 409);
  const graph = GraphSchema.parse(wf.graph);
  const target = nodeId ? { id: nodeId } : (() => {
    const p = resumePoint(graph, states);
    return p ? { id: p.node.id } : null;
  })();
  if (!target || !graph.nodes.some((n) => n.id === target.id)) throw new HandoffRefused("ما لقيت الخطوة اللي بدك تتخطّاها", 404);
  const state = states[target.id];
  if (!state || (state.status !== "failed" && state.status !== "approval" && state.status !== "handoff" && state.status !== "running" && state.status !== "waiting")) throw new HandoffRefused("هالخطوة مش واقفة — ما بتنتخطّى", 409);

  const at = now.toISOString();
  const next = stepAfter(graph, target.id);
  const moved = await db.workflowRun.updateMany({
    where: { id: run.id, status: run.status },
    data: { status: next ? "queued" : "ok", finishedAt: next ? null : now, endReason: null, nodeStates: json(skipNodeState(states, target.id, at)) },
  });
  if (!moved.count) throw new HandoffRefused("حدا غيّر التشغيل قبلك — حدّث الصفحة", 409);
  await closeOpenRequests(wf.key, run.ref, actor, now);
  let handoff: HandoffView | undefined;
  if (next) handoff = (await createHandoff({ workflow: wf.key, kind: "resume", node: next.node.id, title: `كمّل من الخطوة ${next.n}: ${next.node.label}`.slice(0, 160), run_ref: run.ref }, actor, now)).handoff;
  await audit(actor, "run.skip_step", { type: "workflow_run", id: run.id }, { after: { job: wf.key, node: target.id, last: !next } });
  return { run: runView(await db.workflowRun.findUniqueOrThrow({ where: { id: run.id } })), handoff };
}

/** «ألغِ التشغيل»: any run that has not ended becomes `skipped` (cancelled): the agent is told to stop by its next answer, and every request for it is closed. */
export async function cancelRun(key: string, runId: string, actor: Actor, now = new Date()): Promise<RunActionResult> {
  const { wf, run } = await load(key, runId);
  if (isTerminalRun(run.status)) throw new HandoffRefused("التشغيل خلص من قبل", 409);
  await closeOpenRequests(wf.key, run.ref, actor, now);
  await logRun({ job: wf.key, ref: run.ref, status: "skipped", summary: "ألغاه المالك" }, actor, "ui", now, { site: true, endReason: "cancelled" });
  await audit(actor, "run.cancel", { type: "workflow_run", id: run.id }, { after: { job: wf.key } });
  return { run: runView(await db.workflowRun.findUniqueOrThrow({ where: { id: run.id } })) };
}

/** «سلّمها لغيره»: the request this run waits on goes to somebody else (for this run only). */
export async function reassignRun(key: string, runId: string, assignee: string, actor: Actor): Promise<RunActionResult> {
  const { wf, run } = await load(key, runId);
  if (run.status !== "queued" && run.status !== "waiting" && run.status !== "running") throw new HandoffRefused("التشغيل مش بانتظار حدا", 409);
  const open = await db.handoff.findFirst({ where: { workflowKey: wf.key, runRef: run.ref, status: { in: ["open", "claimed"] } }, orderBy: { createdAt: "desc" } });
  if (!open) throw new HandoffRefused("ما في طلب مفتوح لهالتشغيل — ما في شي تسلّمه", 409);
  const handoff = await reassignHandoff(open.id, assignee, actor);
  return { run: runView(run), handoff };
}
