/**
 * THE LIVE ANSWER, the server side (docs/rebuild-v6/01-model.md §13): the agents, the runs that are going (queued · running · waiting) and the ones that
 * changed since the page last asked, and the requests nobody has taken. A fixed number of queries — one per table, whatever the number of jobs or runs
 * (W-20) — and then `buildLive` (pure) puts the rows together.
 */
import { buildLive, type LiveOut } from "@/core/jobs-live";
import { GraphSchema, type WfGraph } from "@/core/workflow";
import { db } from "./db";

const MAX_RUNS = 100;

export async function loadLive(opts: { since?: Date | null; now?: Date } = {}): Promise<LiveOut> {
  const now = opts.now ?? new Date();
  const [actors, runs, requests] = await Promise.all([
    db.actor.findMany({ where: { active: true, kind: "agent" } }),
    db.workflowRun.findMany({ where: { OR: [{ status: { in: ["queued", "running", "waiting"] } }, ...(opts.since ? [{ updatedAt: { gt: opts.since } }] : [])] }, orderBy: { startedAt: "desc" }, take: MAX_RUNS }),
    db.handoff.findMany({ where: { status: "open", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, orderBy: { createdAt: "asc" }, take: 100 }),
  ]);
  const ids = [...new Set(runs.map((r) => r.workflowId))];
  const jobs = ids.length ? await db.workflow.findMany({ where: { id: { in: ids } } }) : [];
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  // a run is drawn from the steps it began with: its version, when it is not the job's current one (one query for all of them)
  const old = runs.filter((r) => r.graphVersion != null && jobById.get(r.workflowId) && r.graphVersion !== jobById.get(r.workflowId)!.version);
  const versions = new Map<string, WfGraph>();
  if (old.length) {
    const rows = await db.workflowVersion.findMany({ where: { OR: old.map((r) => ({ workflowId: r.workflowId, version: r.graphVersion as number })) } });
    for (const v of rows) {
      const g = GraphSchema.safeParse(v.graph);
      if (g.success) versions.set(`${v.workflowId}:${v.version}`, g.data);
    }
  }
  const empty: WfGraph = { nodes: [], edges: [] };
  return buildLive({
    now,
    actors: actors.map((a) => ({ key: a.key, name: a.name, kind: a.kind, active: a.active, lastSeenAt: a.lastSeenAt })),
    jobs: jobs.map((j) => ({ id: j.id, key: j.key, name: j.name, number: j.number, assigneeKey: j.assigneeKey, version: j.version, graph: GraphSchema.safeParse(j.graph).data ?? empty })),
    runs: runs.map((r) => ({ id: r.id, workflowId: r.workflowId, ref: r.ref, status: r.status, scheduledFor: r.scheduledFor, startedAt: r.startedAt, heartbeatAt: r.heartbeatAt, finishedAt: r.finishedAt, endReason: r.endReason, summary: r.summary, doneBy: r.doneBy, graphVersion: r.graphVersion, nodeStates: (r.nodeStates as never) ?? {} })),
    versions,
    requests: requests.map((q) => ({ id: q.id, workflowKey: q.workflowKey, assignee: q.assignee, kind: q.kind, createdAt: q.createdAt })),
  });
}
