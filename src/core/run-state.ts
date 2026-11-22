/**
 * THE RUN, AS ONE PURE VOCABULARY (docs/rebuild-v6/01-model.md §4). One place says what a status means, which lamp it lights, what the
 * sentence under the rope says, and which moves between statuses are allowed. Every screen asks here, so «شغّالة» means one thing everywhere.
 * Nothing here reads a database or a clock but the `now` it is given.
 */
import { waitingText } from "./handoff";
import { RUN_STATUSES, TERMINAL_RUN_STATUSES, stepOrder, type NodeState, type NodeStates, type RunStatus, type WfGraph, type WfNode } from "./workflow";

/** off = not reached (or set aside) · run = going now · done · wait = held (orange) · fail = red · missed = dotted */
export type Lamp = "off" | "run" | "done" | "wait" | "fail" | "missed";

export const isRunStatus = (s: unknown): s is RunStatus => typeof s === "string" && (RUN_STATUSES as readonly string[]).includes(s);

/** The run has ended: nothing but the owner's retry button opens it again. */
export const isTerminalRun = (status: string): boolean => (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);

/** A run that is still going on (or still hoped for): queued · running · waiting. */
export const isLiveRun = (status: string): boolean => status === "queued" || status === "running" || status === "waiting";

export function stepLamp(s: NodeState | undefined): Lamp {
  switch (s?.status) {
    case "running":
      return "run";
    case "done":
      return "done";
    case "failed":
      return "fail";
    case "handoff":
    case "approval":
      return "wait";
    default:
      // waiting (not reached yet), skipped (set aside), or nothing at all
      return "off";
  }
}

export function runLamp(run: { status: string }): Lamp {
  switch (run.status) {
    case "queued":
    case "waiting":
      return "wait";
    case "running":
      return "run";
    case "ok":
      return "done";
    case "failed":
    case "lost":
      return "fail";
    case "missed":
      return "missed";
    default:
      return "off";
  }
}

/** What the one who reads a run needs: the run's own columns, as ISO strings. */
export interface RunView {
  status: string;
  startedAt: string;
  scheduledFor?: string | null;
  heartbeatAt?: string | null;
  finishedAt?: string | null;
  summary?: string | null;
  endReason?: string | null;
  nodeStates: NodeStates;
}

/** What the sentence needs to know of the job: its steps and the name of whoever carries it out. */
export interface JobSteps {
  graph: Pick<WfGraph, "nodes" | "edges">;
  /** «Claude الرئيسي» — for «بانتظار …» */
  assigneeName?: string | null;
}

/** The steps a run walks, in order: no trigger, nothing the owner switched off. */
export function runSteps(graph: JobSteps["graph"]): WfNode[] {
  return stepOrder({ nodes: graph.nodes, edges: graph.edges }).filter((n) => n.type !== "trigger" && !n.disabled);
}

/** The ids the owner switched off (what an agent is told in the answer of every `log_run`). */
export const disabledStepIds = (graph: Pick<WfGraph, "nodes">): string[] => graph.nodes.filter((n) => n.type !== "trigger" && n.disabled).map((n) => n.id);

/** When every state of the run was guessed by the site (the agent told only how it ended), the steps carry no real detail. */
export function stepsAreInferred(run: Pick<RunView, "nodeStates">): boolean {
  const states = Object.values(run.nodeStates ?? {});
  return states.length > 0 && states.every((s) => s.inferred === true);
}

const minutesBetween = (from: string | null | undefined, to: Date): number => (from ? Math.max(0, Math.round((to.getTime() - Date.parse(from)) / 60_000)) : 0);

const trim = (s: string | undefined | null, n = 120): string => (s ?? "").trim().slice(0, n);

/**
 * The line under the rope: «هلق عند الخطوة 4 من 7 — تكبير +20%» · «وقفت عند 6: ما قدرنا نقرا المخزون» · «فاتت: ما وصل أي تسجيل».
 * Said in the owner's words, from the run and its steps only — never from a model.
 */
export function runSentence(job: JobSteps, run: RunView, now: Date): string {
  const steps = runSteps(job.graph);
  const total = steps.length;
  const states = run.nodeStates ?? {};
  const at = (pred: (s: NodeState) => boolean) => {
    const i = steps.findIndex((n) => states[n.id] && pred(states[n.id]!));
    return i === -1 ? null : { n: i + 1, node: steps[i]!, state: states[steps[i]!.id]! };
  };
  const place = (x: { n: number }) => (total ? `الخطوة ${x.n} من ${total}` : `الخطوة ${x.n}`);

  switch (run.status) {
    case "queued": {
      const who = job.assigneeName ? `بانتظار ${job.assigneeName}` : "بانتظار حدا ياخدها";
      return `${who} ${waitingText(minutesBetween(run.scheduledFor ?? run.startedAt, now))}`;
    }
    case "running": {
      const cur = at((s) => s.status === "running");
      if (!cur) return "شغّالة هلق";
      return `هلق عند ${place(cur)} — ${cur.node.label}`;
    }
    case "waiting": {
      const cur = at((s) => s.status === "approval" || s.status === "handoff");
      if (!cur) return "واقفة — بانتظار حدا يكمّلها";
      const why = cur.state.status === "approval" ? "بانتظار موافقتك" : trim(cur.state.note) || "بانتظار حدا يكمّلها";
      return `واقفة عند ${cur.n}: ${why}`;
    }
    case "failed": {
      const cur = at((s) => s.status === "failed");
      if (!cur) return trim(run.summary) ? `وقفت: ${trim(run.summary)}` : "وقفت بخطأ";
      return `وقفت عند ${cur.n}: ${trim(cur.state.error) || trim(cur.state.note) || cur.node.label}`;
    }
    case "lost": {
      const cur = at((s) => s.status === "failed") ?? at((s) => s.status === "running");
      const since = minutesBetween(run.heartbeatAt ?? run.startedAt, now);
      return cur ? `انقطعت عند ${cur.n}: آخر خبر ${waitingText(since)}` : `انقطعت: آخر خبر ${waitingText(since)}`;
    }
    case "missed":
      return "فاتت: ما وصل أي تسجيل";
    case "skipped":
      return run.endReason === "cancelled" ? "ألغيتها" : run.endReason === "owner_skipped" ? "تخطّيتها" : "انتخطّت";
    case "ok":
      if (stepsAreInferred(run)) return "خلصت — Claude سجّل النهاية بس، بلا تفاصيل الخطوات";
      return trim(run.summary) ? `خلصت — ${trim(run.summary)}` : "خلصت";
    default:
      return "";
  }
}

// ───────────────────────────── the moves between statuses ─────────────────────────────

export type Move = { ok: true } | { ok: false; reason: string };

/**
 * May an agent move a run from `from` to `to`? An agent never writes the site's statuses (queued · missed · lost). A run that has ended is not
 * opened again by a late «running» or «waiting» (a retry is the owner's button, which writes through the site, not through here). A run the
 * owner cancelled stays cancelled whatever the agent says.
 */
export function agentMove(from: string | undefined, to: string, opts: { cancelled?: boolean } = {}): Move {
  if (to === "queued" || to === "missed" || to === "lost") return { ok: false, reason: `الحالة «${to}» بيكتبها الموقع بس — ابعت running أو waiting أو ok أو failed` };
  if (!from) return { ok: true };
  if (opts.cancelled && to !== "skipped") return { ok: false, reason: "المالك لغى هالتشغيل — وقّف" };
  if (isTerminalRun(from) && (to === "running" || to === "waiting")) return { ok: false, reason: `التشغيل خلص (${from}) — ما بينفع تفتحه من جديد بـ ${to}. اعمل تشغيل جديد بـ ref جديد (أو المالك بيعيد المحاولة من الموقع)` };
  return { ok: true };
}

/** The kinds of request that hold a step up: answering one only unblocks the run, whoever answered keeps going (the old default, kept). */
const STUCK_KINDS = ["node_failed", "missing_connection", "timeout", "needs_input"];

/**
 * What the run becomes when its request is answered (§7: «complete ما بيقلب الحالة»). The answer says how it ended: that (a run that has ended is
 * not opened by a late «running»). It does not: a run that has ended stays as it ended (a failure is never turned into a success by a polite
 * «done»); a request about a stuck step only unblocks the run (it goes on as `running`, as it always did); a run the owner asked for, or one
 * resumed from a step, is `ok` unless a step of it failed. `undefined` = leave the status as it is.
 */
export function statusOnComplete(kind: string, said: "running" | "ok" | "failed" | undefined, current: { status: string; nodeStates: NodeStates } | null): RunStatus | undefined {
  if (said) return said === "running" && current && isTerminalRun(current.status) ? undefined : said;
  if (!current) return undefined;
  if (isTerminalRun(current.status)) return undefined;
  if (STUCK_KINDS.includes(kind)) return "running";
  if (Object.values(current.nodeStates ?? {}).some((s) => s.status === "failed")) return undefined;
  return "ok";
}

/** The state the step the request held becomes when it is answered: failed if the run says failed, else done — and an ended step stays as it ended. */
export function nodeStatusOnComplete(runStatus: RunStatus | undefined, was: NodeState | undefined): "done" | "failed" | undefined {
  if (was && (was.status === "done" || was.status === "failed" || was.status === "skipped")) return undefined;
  return runStatus === "failed" ? "failed" : "done";
}

// ───────────────────────────── the owner's buttons on a run that stopped (§8) ─────────────────────────────

export interface ResumePoint {
  node: WfNode;
  /** the step's place among the run's steps, from 1 */
  n: number;
}

/**
 * Where a run that stopped picks up from: the first step that failed; else the first one that waits on somebody (a gate, a handoff) or was
 * running when the news stopped; else the first one that was never finished. `null` when every step is done or set aside.
 */
export function resumePoint(graph: JobSteps["graph"], states: NodeStates): ResumePoint | null {
  const steps = runSteps(graph);
  const pick = (pred: (s: NodeState | undefined) => boolean) => {
    const i = steps.findIndex((n) => pred(states[n.id]));
    return i === -1 ? null : { node: steps[i]!, n: i + 1 };
  };
  return pick((s) => s?.status === "failed") ?? pick((s) => s?.status === "approval" || s?.status === "handoff" || s?.status === "running") ?? pick((s) => !s || s.status === "waiting");
}

/** The step after this one (the next the run walks), or null when it was the last. */
export function stepAfter(graph: JobSteps["graph"], nodeId: string): ResumePoint | null {
  const steps = runSteps(graph);
  const i = steps.findIndex((n) => n.id === nodeId);
  return i === -1 || i === steps.length - 1 ? null : { node: steps[i + 1]!, n: i + 2 };
}

/** «أعد المحاولة»: the step goes back to waiting for its turn, one try more; its old error and times are gone. */
export function retryNodeState(states: NodeStates, nodeId: string, at: string): NodeStates {
  const was = states[nodeId];
  return { ...states, [nodeId]: { status: "waiting", at, note: "إعادة المحاولة", attempt: (was?.attempt ?? 1) + 1 } };
}

/** «تخطّى هالخطوة»: the step is set aside, with a line saying who did it. */
export function skipNodeState(states: NodeStates, nodeId: string, at: string): NodeStates {
  const was = states[nodeId];
  return { ...states, [nodeId]: { status: "skipped", at, endedAt: at, note: "المالك تخطّاها", ...(was?.startedAt ? { startedAt: was.startedAt } : {}), ...(was?.attempt ? { attempt: was.attempt } : {}) } };
}
