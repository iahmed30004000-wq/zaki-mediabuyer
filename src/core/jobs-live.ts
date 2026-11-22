/**
 * THE LIVE ANSWER (docs/rebuild-v6/01-model.md §13), put together from plain rows — pure. The server asks four or five tables once each and hands the
 * rows here; the same function answers for one run or for fifty. The rope's lamps and the sentence under it come from `run-state.ts`, so «شغّالة» means one
 * thing everywhere.
 */
import { actorOwnsAssignee } from "./handoff";
import { runLamp, runSentence, runSteps, stepLamp, type Lamp } from "./run-state";
import type { NodeStates, WfGraph } from "./workflow";

/** An agent that spoke within this many minutes is «صاحي»; later it is «ساكت». */
export const AWAKE_WITHIN_MIN = 15;

export interface LiveActor {
  key: string;
  name: string;
  kind: string;
  active: boolean;
  lastSeenAt: Date | null;
}
export interface LiveJob {
  id: string;
  key: string;
  name: string;
  number: number | null;
  assigneeKey: string | null;
  version: number;
  graph: WfGraph;
}
export interface LiveRun {
  id: string;
  workflowId: string;
  ref: string;
  status: string;
  scheduledFor: Date | null;
  startedAt: Date;
  heartbeatAt: Date | null;
  finishedAt: Date | null;
  endReason: string | null;
  summary: string | null;
  doneBy: string | null;
  graphVersion: number | null;
  nodeStates: NodeStates;
}
export interface LiveRequest {
  id: string;
  workflowKey: string;
  assignee: string;
  kind: string;
  createdAt: Date;
}

export interface LiveStep {
  id: string;
  /** the step's place among the run's steps, from 1 */
  n: number;
  /** «3.2»: job number . place (null when the job has no number) */
  no: string | null;
  label: string;
  lamp: Lamp;
  note: string | null;
  startedAt: string | null;
  endedAt: string | null;
  error: string | null;
  inferred: boolean;
}
export interface LiveRunOut {
  id: string;
  jobKey: string;
  jobNumber: number | null;
  jobName: string;
  status: string;
  lamp: Lamp;
  scheduledFor: string | null;
  startedAt: string;
  heartbeatAt: string | null;
  sentence: string;
  steps: LiveStep[];
}
export interface LiveAgent {
  key: string;
  name: string;
  state: "running" | "awake" | "silent";
  lastSeenAt: string | null;
  queued: number;
}
export interface LiveOut {
  at: string;
  agents: LiveAgent[];
  runs: LiveRunOut[];
  queue: { id: string; jobKey: string; assignee: string; since: string; kind: string }[];
}

/** The graph a run is read against: the version it began with when the site kept it, else the job's current one. */
export function graphOfRun(run: Pick<LiveRun, "graphVersion">, job: Pick<LiveJob, "version" | "graph">, versions: ReadonlyMap<string, WfGraph>, jobId: string): WfGraph {
  if (run.graphVersion == null || run.graphVersion === job.version) return job.graph;
  return versions.get(`${jobId}:${run.graphVersion}`) ?? job.graph;
}

export function buildLive(input: { actors: LiveActor[]; jobs: LiveJob[]; runs: LiveRun[]; versions: ReadonlyMap<string, WfGraph>; requests: LiveRequest[]; now: Date }): LiveOut {
  const { now } = input;
  const nameOf = new Map(input.actors.map((a) => [a.key, a.name]));
  const jobById = new Map(input.jobs.map((j) => [j.id, j]));

  const runs: LiveRunOut[] = [];
  for (const r of input.runs) {
    const job = jobById.get(r.workflowId);
    if (!job) continue;
    const graph = graphOfRun(r, job, input.versions, job.id);
    const states = r.nodeStates ?? {};
    const sentence = runSentence(
      { graph, assigneeName: nameOf.get(job.assigneeKey ?? "claude") ?? null },
      { status: r.status, startedAt: r.startedAt.toISOString(), scheduledFor: r.scheduledFor?.toISOString() ?? null, heartbeatAt: r.heartbeatAt?.toISOString() ?? null, finishedAt: r.finishedAt?.toISOString() ?? null, summary: r.summary, endReason: r.endReason, nodeStates: states },
      now,
    );
    runs.push({
      id: r.id,
      jobKey: job.key,
      jobNumber: job.number,
      jobName: job.name,
      status: r.status,
      lamp: runLamp(r),
      scheduledFor: r.scheduledFor?.toISOString() ?? null,
      startedAt: r.startedAt.toISOString(),
      heartbeatAt: r.heartbeatAt?.toISOString() ?? null,
      sentence,
      steps: runSteps(graph).map((n, i) => {
        const s = states[n.id];
        return { id: n.id, n: i + 1, no: job.number === null ? null : `${job.number}.${i + 1}`, label: n.label, lamp: stepLamp(s), note: s?.note ?? null, startedAt: s?.startedAt ?? null, endedAt: s?.endedAt ?? null, error: s?.error ?? null, inferred: s?.inferred === true };
      }),
    });
  }

  const queue = input.requests.map((q) => ({ id: q.id, jobKey: q.workflowKey, assignee: q.assignee, since: q.createdAt.toISOString(), kind: q.kind }));
  const agents: LiveAgent[] = input.actors
    .filter((a) => a.kind === "agent" && a.active)
    .map((a) => {
      const going = input.runs.some((r) => {
        if (r.status !== "running") return false;
        const owner = r.doneBy ?? jobById.get(r.workflowId)?.assigneeKey ?? "claude";
        return actorOwnsAssignee(a.key, owner) && actorOwnsAssignee(owner, a.key);
      });
      const seen = a.lastSeenAt && now.getTime() - a.lastSeenAt.getTime() <= AWAKE_WITHIN_MIN * 60_000;
      return { key: a.key, name: a.name, state: going ? ("running" as const) : seen ? ("awake" as const) : ("silent" as const), lastSeenAt: a.lastSeenAt?.toISOString() ?? null, queued: input.requests.filter((q) => actorOwnsAssignee(a.key, q.assignee) && actorOwnsAssignee(q.assignee, a.key)).length };
    })
    .sort((x, y) => x.key.localeCompare(y.key));
  return { at: now.toISOString(), agents, runs, queue };
}
