/**
 * WHAT A `log_run` DOES TO A RUN — pure (docs/rebuild-v6/01-model.md §4 · §11 · §14). The server reads the run and the steps, asks `planRun`
 * what the run becomes, and writes that in one transaction. Everything that decides is here, so it can be tested without a database:
 * which status moves are refused, how the times are written, what a step the workflow no longer has does, and what the agent is told back.
 */
import { agentMove, disabledStepIds, isTerminalRun } from "./run-state";
import { mergeNodeStates, settleStates, type NodeStates, type NodeStatus, type RunStatus, type WfGraph } from "./workflow";

export interface NodeUpdateIn {
  id: string;
  status: NodeStatus;
  note?: string;
  error?: string;
}

export interface ExistingRun {
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  trigger: string;
  scheduledFor: Date | null;
  heartbeatAt: Date | null;
  doneBy: string | null;
  endReason: string | null;
  graphVersion: number | null;
  nodeStates: NodeStates;
}

export interface RunInputIn {
  status?: string;
  trigger?: string;
  started_at?: string;
  finished_at?: string;
  scheduled_for?: string;
  heartbeat?: boolean;
  updates: NodeUpdateIn[];
}

export interface PlanArgs {
  existing: ExistingRun | null;
  input: RunInputIn;
  /** the steps this run began with (the version it was logged under); the current ones for a new run or a run from before versions were kept */
  runGraph: WfGraph;
  /** the steps the job has now */
  currentGraph: WfGraph;
  /** the job's version now (a new run keeps it as `graphVersion`) */
  version: number;
  now: Date;
  /** the Actor.key of whoever logged it (the token's agent; the owner when he did it from the site), if known */
  actorKey: string | null;
  /** the site writes (a claim, an answer, the owner's buttons): it may write any status, and it may reopen a run that has ended */
  site?: boolean;
  /** with `site`: why the run ended (cancelled · owner_skipped · missed · lost · error) */
  endReason?: string;
}

export interface RunPlan {
  ok: true;
  created: boolean;
  data: {
    status: RunStatus;
    trigger: string;
    startedAt: Date;
    finishedAt: Date | null;
    scheduledFor: Date | null;
    heartbeatAt: Date | null;
    doneBy: string | null;
    endReason: string | null;
    graphVersion: number | null;
    nodeStates: NodeStates;
  };
  /** the run ended with this write: every request that was still open for it is closed */
  closeRequests: boolean;
  /** the owner cancelled this run: the agent must stop */
  stop: boolean;
}
export type RunRefusal = { ok: false; error: string };

/** A time as an agent writes it: an ISO moment, or a bare date (the start of that day, UTC). */
export function parseWhen(s: string | undefined, label: string): { ok: true; at: Date | undefined } | { ok: false; error: string } {
  if (!s) return { ok: true, at: undefined };
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : new Date(s);
  return Number.isNaN(d.getTime()) ? { ok: false, error: `${label}: وقت مش صحيح` } : { ok: true, at: d };
}

const REMOVED_NOTE = "خطوة انشالت";

export function planRun(a: PlanArgs): RunPlan | RunRefusal {
  const { existing, input, now } = a;
  const at = now.toISOString();
  const cancelled = existing?.endReason === "cancelled";

  if (input.status !== undefined && !a.site) {
    const mv = agentMove(existing?.status, input.status, { cancelled });
    if (!mv.ok) return { ok: false, error: mv.reason };
  }

  const started = parseWhen(input.started_at, "started_at");
  if (!started.ok) return started;
  const finished = parseWhen(input.finished_at, "finished_at");
  if (!finished.ok) return finished;
  const scheduled = parseWhen(input.scheduled_for, "scheduled_for");
  if (!scheduled.ok) return scheduled;

  // a step of the run is known to the job now; one the job has dropped is accepted for a run that began under an older version, and marked
  const inCurrent = new Set(a.currentGraph.nodes.map((n) => n.id));
  const inRun = new Set(a.runGraph.nodes.map((n) => n.id));
  const updates: NodeUpdateIn[] = [];
  for (const u of input.updates) {
    if (inCurrent.has(u.id)) updates.push(u);
    else if (inRun.has(u.id) && existing) updates.push({ ...u, note: u.note ? `${REMOVED_NOTE} — ${u.note}` : REMOVED_NOTE });
    else return { ok: false, error: `node: «${u.id}» مش بخطوات هالمهمة — الخطوات: ${a.currentGraph.nodes.map((n) => n.id).join("، ")}` };
  }

  // only node updates on a run that waits in the queue: the agent has started it
  const requested = input.status as RunStatus | undefined;
  const status: RunStatus = requested ?? (existing?.status === "queued" ? "running" : ((existing?.status as RunStatus | undefined) ?? "running"));
  const wasEnded = !!existing && isTerminalRun(existing.status);
  const endedNow = isTerminalRun(status);

  const settleGraph: WfGraph = a.runGraph;
  const merged = mergeNodeStates(existing?.nodeStates ?? {}, updates, at);
  const nodeStates = settleStates(settleGraph, merged, status, at);

  const startedAt = existing && existing.status !== "queued" ? existing.startedAt : (started.at ?? now);
  const finishedAt = endedNow ? (finished.at ?? existing?.finishedAt ?? now) : null;
  const lateWord = wasEnded && status === existing!.status;
  const statusChanged = !!existing && status !== existing.status;

  return {
    ok: true,
    created: !existing,
    data: {
      status,
      trigger: input.trigger ?? existing?.trigger ?? "schedule",
      startedAt,
      finishedAt,
      scheduledFor: scheduled.at ?? existing?.scheduledFor ?? null,
      heartbeatAt: lateWord ? (existing?.heartbeatAt ?? now) : now,
      doneBy: a.actorKey ?? existing?.doneBy ?? null,
      endReason: a.site && a.endReason !== undefined ? a.endReason : statusChanged && !cancelled ? null : (existing?.endReason ?? null),
      graphVersion: existing?.graphVersion ?? a.version,
      nodeStates,
    },
    closeRequests: endedNow && requested !== undefined,
    stop: cancelled || (!!a.site && a.endReason === "cancelled"),
  };
}

/** What an agent is told besides the run: the steps the owner switched off (W-15) and whether it must stop. */
export const answerExtras = (graph: Pick<WfGraph, "nodes">, stop: boolean) => ({ disabled_steps: disabledStepIds(graph), stop });
