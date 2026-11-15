/**
 * WORKFLOWS AND THEIR RUNS (v3 · F, v4 · A `log_run`, E). The jobs Claude runs are workflows the owner can see; when
 * Claude calls `log_run` the matching workflow moves — node by node — exactly as if a job runner reported it. The
 * workflow does not run anything here: it is the owner's window on the work, and the switch that can stop it (a disabled
 * workflow tells Claude so in the answer of every `log_run`).
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Prisma, Workflow, WorkflowRun } from "@prisma/client";
import { nextRuns, isValidCron } from "@/core/cron";
import { refuseIfPrivate } from "@/core/push-rows";
import { EXECUTORS, GraphSchema, NODE_STATUSES, PERMISSIONS, RUN_STATUSES, SEED_WORKFLOWS, mergeNodeStates, settleStates, type NodeStates, type RunStatus, type WfGraph } from "@/core/workflow";
import { diffText, ensureLayout, graphDiff, isChanged, templateOf } from "@/core/workflow-edit";
import { db } from "./db";
import { audit, type Actor } from "./audit";

const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Adds the seeded jobs that are missing. Never touches one that exists — what the owner edited stays his. */
export async function ensureSeeded(): Promise<number> {
  const r = await db.workflow.createMany({
    data: SEED_WORKFLOWS.map((s) => ({ key: s.key, name: s.name, description: s.description, schedule: s.schedule, executor: s.executor, dataSource: "mcp", permission: s.permission, graph: json(s.graph) })),
    skipDuplicates: true,
  });
  return r.count;
}

export interface RunView {
  id: string;
  ref: string;
  status: string;
  trigger: string;
  source: string;
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
  metrics: Record<string, unknown> | null;
  artifacts: { label: string; url?: string; text?: string }[] | null;
  nodeStates: NodeStates;
}

export const runView = (r: WorkflowRun): RunView => ({
  id: r.id,
  ref: r.ref,
  status: r.status,
  trigger: r.trigger,
  source: r.source,
  startedAt: r.startedAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
  summary: r.summary,
  metrics: (r.metrics as RunView["metrics"]) ?? null,
  artifacts: (r.artifacts as RunView["artifacts"]) ?? null,
  nodeStates: (r.nodeStates as unknown as NodeStates) ?? {},
});

const NodeUpdate = z.object({ id: z.string().trim().min(1).max(40), status: z.enum(NODE_STATUSES), note: z.string().trim().max(200).optional() }).strict();
const iso = z.string().trim().min(8).max(40);

export const LogRunInput = z
  .object({
    job: z.string().trim().min(1).max(60).describe("مفتاح الورك فلو، مثلاً daily-check أو night-round"),
    ref: z.string().trim().min(1).max(80).optional().describe("معرّف التشغيل من عندك — نفس المعرّف بيحدّث نفس التشغيل (استعمله لتحديثات الخطوات)"),
    status: z.enum(RUN_STATUSES).optional().describe("running · ok · failed · waiting · skipped — الافتراضي running"),
    trigger: z.enum(["schedule", "manual", "event"]).optional(),
    started_at: iso.optional(),
    finished_at: iso.optional(),
    summary: z.string().trim().max(300).optional().describe("سطر واحد: شو صار"),
    metrics: z.record(z.union([z.number().finite(), z.string().max(80)])).optional().describe("أرقام التشغيل {الاسم: القيمة} (حتى 30)"),
    artifacts: z.array(z.object({ label: z.string().trim().min(1).max(80), url: z.string().trim().max(300).optional(), text: z.string().trim().max(500).optional() }).strict()).max(10).optional(),
    node: NodeUpdate.optional().describe("حالة خطوة وحدة: {id, status: running|done|failed|waiting|handoff|approval, note}"),
    nodes: z.array(NodeUpdate).max(40).optional().describe("حالة عدّة خطوات مرة وحدة"),
    create_if_missing: z.boolean().optional().describe("أنشئ الورك فلو إذا المفتاح جديد (حروف صغيرة وشرطات)"),
  })
  .strict();
export type LogRunInputT = z.infer<typeof LogRunInput>;

export class UnknownJob extends Error {
  constructor(public known: string[]) {
    super("unknown job");
  }
}
export class RunRefused extends Error {}

function when(s: string | undefined, label: string): Date | undefined {
  if (!s) return undefined;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : new Date(s);
  if (Number.isNaN(d.getTime())) throw new RunRefused(`${label}: وقت مش صحيح`);
  return d;
}

/** Records a run (or an update of one) and moves its workflow's nodes. Idempotent by (job, ref). */
export async function logRun(input: LogRunInputT, actor: Actor, source: "mcp" | "worker" | "ui" | "n8n", now = new Date()): Promise<{ run: RunView; workflow: { key: string; name: string; enabled: boolean }; created: boolean }> {
  const refusal = refuseIfPrivate(input.summary, ...Object.values(input.metrics ?? {}).map(String), ...(input.artifacts ?? []).flatMap((a) => [a.label, a.url, a.text]));
  if (refusal) throw new RunRefused(refusal);
  if ((input.metrics && Object.keys(input.metrics).length > 30) || false) throw new RunRefused("metrics: حتى 30 رقم");

  await ensureSeeded();
  let wf: Workflow | null = await db.workflow.findUnique({ where: { key: input.job } });
  if (!wf && input.create_if_missing) {
    if (!/^[a-z0-9][a-z0-9-]{1,59}$/.test(input.job)) throw new RunRefused("job: حروف إنجليزية صغيرة وأرقام وشرطات بس");
    const graph: WfGraph = { nodes: [{ id: "start", type: "trigger", label: "بداية", executor: "system", permission: "green" }, { id: "work", type: "step", label: input.job, executor: "claude_mcp", dataSource: "mcp", permission: "green" }], edges: [{ from: "start", to: "work" }] };
    wf = await db.workflow.create({ data: { key: input.job, name: input.job, executor: "claude_mcp", dataSource: "mcp", permission: "green", graph: json(graph) } });
    await audit(actor, "workflow.create", { type: "workflow", id: wf.id }, { after: { key: wf.key, via: "log_run" } });
  }
  if (!wf) throw new UnknownJob((await db.workflow.findMany({ where: { archivedAt: null }, select: { key: true }, orderBy: { key: "asc" } })).map((w) => w.key));

  const graph = GraphSchema.parse(wf.graph);
  const ref = input.ref ?? input.started_at ?? now.toISOString();
  const existing = await db.workflowRun.findUnique({ where: { workflowId_ref: { workflowId: wf.id, ref } } });
  const status: RunStatus = input.status ?? (existing?.status as RunStatus | undefined) ?? "running";
  const at = now.toISOString();
  const updates = [...(input.nodes ?? []), ...(input.node ? [input.node] : [])];
  const known = new Set(graph.nodes.map((n) => n.id));
  const unknownNode = updates.find((u) => !known.has(u.id));
  if (unknownNode) throw new RunRefused(`node: «${unknownNode.id}» مش بخطوات ${wf.key} — الخطوات: ${graph.nodes.map((n) => n.id).join("، ")}`);
  const states = settleStates(graph, mergeNodeStates((existing?.nodeStates as unknown as NodeStates) ?? {}, updates, at), status, at);
  const finished = status === "ok" || status === "failed" || status === "skipped";
  const startedAt = existing?.startedAt ?? when(input.started_at, "started_at") ?? now;
  const finishedAt = finished ? (when(input.finished_at, "finished_at") ?? existing?.finishedAt ?? now) : null;

  const data = {
    status,
    trigger: input.trigger ?? existing?.trigger ?? "schedule",
    startedAt,
    finishedAt,
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    ...(input.metrics ? { metrics: json(input.metrics) } : {}),
    ...(input.artifacts ? { artifacts: json(input.artifacts) } : {}),
    nodeStates: json(states),
  };
  const run = existing
    ? await db.workflowRun.update({ where: { id: existing.id }, data })
    : await db.workflowRun.create({ data: { workflowId: wf.id, ref, source, ...data } });
  await audit(actor, "workflow.log_run", { type: "workflow_run", id: run.id }, { after: { job: wf.key, status, summary: input.summary } });
  return { run: runView(run), workflow: { key: wf.key, name: wf.name, enabled: wf.enabled }, created: !existing };
}

// ───────────────────────────── what the screens read ─────────────────────────────

export interface WorkflowCard {
  id: string;
  key: string;
  name: string;
  description: string | null;
  schedule: string | null;
  executor: string;
  dataSource: string;
  permission: string;
  enabled: boolean;
  version: number;
  graph: WfGraph;
  nextRun: string | null;
  lastRun: RunView | null;
  /** a run that is going on right now (started in the last 6 hours and not finished) */
  live: RunView | null;
}

const LIVE_HOURS = 6;

/** Every workflow with its last run, the run that is moving now, and when it runs next (the Amman clock). */
export async function listWorkflows(now = new Date()): Promise<WorkflowCard[]> {
  await ensureSeeded();
  const rows = await db.workflow.findMany({ where: { archivedAt: null }, orderBy: [{ enabled: "desc" }, { name: "asc" }] });
  const since = new Date(now.getTime() - LIVE_HOURS * 3_600_000);
  const cards: WorkflowCard[] = [];
  for (const w of rows) {
    const [last, live] = await Promise.all([
      db.workflowRun.findFirst({ where: { workflowId: w.id }, orderBy: { startedAt: "desc" } }),
      db.workflowRun.findFirst({ where: { workflowId: w.id, status: { in: ["running", "waiting"] }, startedAt: { gte: since } }, orderBy: { startedAt: "desc" } }),
    ]);
    const graph = GraphSchema.safeParse(w.graph);
    cards.push({
      id: w.id,
      key: w.key,
      name: w.name,
      description: w.description,
      schedule: w.schedule,
      executor: w.executor,
      dataSource: w.dataSource,
      permission: w.permission,
      enabled: w.enabled,
      version: w.version,
      graph: graph.success ? graph.data : { nodes: [], edges: [] },
      nextRun: w.enabled && w.schedule && isValidCron(w.schedule) ? (nextRuns(w.schedule, now, 1)[0]?.toISOString() ?? null) : null,
      lastRun: last ? runView(last) : null,
      live: live ? runView(live) : null,
    });
  }
  return cards;
}

export async function runsOf(key: string, f: { status?: string; limit?: number } = {}): Promise<RunView[]> {
  const rows = await db.workflowRun.findMany({ where: { workflow: { key }, ...(f.status ? { status: f.status } : {}) }, orderBy: { startedAt: "desc" }, take: Math.min(f.limit ?? 30, 100) });
  return rows.map(runView);
}

export const WorkflowPatch = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    schedule: z.string().trim().max(60).nullable().optional(),
    executor: z.enum(EXECUTORS).optional(),
    permission: z.enum(PERMISSIONS).optional(),
    enabled: z.boolean().optional(),
    graph: GraphSchema.optional(),
    archived: z.boolean().optional(),
    /** the owner's words for the version a graph change makes (else the change is counted for him) */
    note: z.string().trim().max(200).optional(),
  })
  .strict();
export type WorkflowPatchT = z.infer<typeof WorkflowPatch>;

export const graphTexts = (g: WfGraph) => g.nodes.flatMap((n) => [n.label, n.assignee, n.prompt, n.inputs, n.outputs, n.destination, n.fallback, n.target]);

/**
 * Edits a workflow (or its kill switch). A change to the graph is a new version (a graph that says nothing new is not: saving
 * twice is saving once), and the version it replaces is kept; nothing is deleted — archive hides it. No text of the drawing may
 * carry a customer's number or a key: the drawing is read by Claude.
 */
export async function updateWorkflow(key: string, patch: WorkflowPatchT, actor: Actor): Promise<WorkflowCard | null> {
  const before = await db.workflow.findUnique({ where: { key } });
  if (!before) return null;
  if (patch.schedule && !isValidCron(patch.schedule)) throw new RunRefused("schedule: الجدولة لازم cron من 5 خانات (دقيقة ساعة يوم شهر يوم-بالأسبوع)");
  const refusal = refuseIfPrivate(patch.name, patch.description ?? undefined, patch.note, ...(patch.graph ? graphTexts(patch.graph) : []));
  if (refusal) throw new RunRefused(refusal);
  const prev = GraphSchema.safeParse(before.graph);
  const diff = patch.graph && prev.success ? graphDiff(prev.data, patch.graph) : null;
  const newVersion = !!patch.graph && (!diff || isChanged(diff));
  if (newVersion) {
    // the version being replaced is kept, once (a workflow made before versions existed has none)
    await db.workflowVersion.upsert({
      where: { workflowId_version: { workflowId: before.id, version: before.version } },
      create: { workflowId: before.id, version: before.version, graph: json(before.graph), note: before.version === 1 ? "النسخة الأولى" : null },
      update: {},
    });
  }
  const after = await db.workflow.update({
    where: { key },
    data: {
      ...(patch.name ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.schedule !== undefined ? { schedule: patch.schedule } : {}),
      ...(patch.executor ? { executor: patch.executor } : {}),
      ...(patch.permission ? { permission: patch.permission } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(newVersion ? { graph: json(patch.graph), version: { increment: 1 } } : {}),
      ...(patch.archived === undefined ? {} : { archivedAt: patch.archived ? new Date() : null }),
    },
  });
  if (newVersion) await db.workflowVersion.create({ data: { workflowId: after.id, version: after.version, graph: json(patch.graph), note: patch.note ?? (diff ? diffText(diff) : null), createdBy: actor.id ?? actor.type } });
  await audit(actor, "workflow.update", { type: "workflow", id: after.id }, { before: { enabled: before.enabled, schedule: before.schedule, permission: before.permission, version: before.version }, after: { enabled: after.enabled, schedule: after.schedule, permission: after.permission, version: after.version } });
  return (await listWorkflows()).find((c) => c.key === key) ?? null;
}

// ───────────────────────────── making one, and its versions (v3 · F) ─────────────────────────────

export const WorkflowCreate = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
    template: z.string().trim().max(30).optional().describe("blank · daily · approval · person"),
    copy_of: z.string().trim().max(60).optional().describe("مفتاح ورك فلو بدك تنسخه"),
    /** a drawing that is ready (the assistant's draft) instead of a template or a copy */
    graph: GraphSchema.optional(),
    /** false: made switched off — a draft stays asleep until the owner turns it on */
    enabled: z.boolean().optional(),
    note: z.string().trim().max(200).optional(),
  })
  .strict();
export type WorkflowCreateT = z.infer<typeof WorkflowCreate>;

/** A new workflow from a template (or a copy of another), laid out, with its first version. Claude can log runs against its key at once. */
export async function createWorkflow(input: WorkflowCreateT, actor: Actor): Promise<WorkflowCard> {
  const refusal = refuseIfPrivate(input.name, input.description);
  if (refusal) throw new RunRefused(refusal);
  await ensureSeeded();
  let graph: WfGraph;
  let executor = "claude_mcp";
  let permission = "green";
  let note: string;
  if (input.graph) {
    if (input.copy_of || input.template) throw new RunRefused("رسم جاهز أو قالب أو نسخة — واحد منهم بس");
    const bad = refuseIfPrivate(...graphTexts(input.graph), input.note);
    if (bad) throw new RunRefused(bad);
    graph = input.graph;
    note = input.note ?? "مسودة من المساعد";
  } else if (input.copy_of) {
    const src = await db.workflow.findUnique({ where: { key: input.copy_of } });
    if (!src) throw new RunRefused("الورك فلو اللي بدك تنسخه مش موجود");
    graph = GraphSchema.parse(src.graph);
    executor = src.executor;
    permission = src.permission;
    note = `نسخة من «${src.name}»`;
  } else {
    const t = templateOf(input.template ?? "blank");
    if (!t) throw new RunRefused(`القالب «${input.template}» مش معروف`);
    graph = t.graph;
    note = `من قالب «${t.name}»`;
  }
  graph = ensureLayout(graph);
  let key = "";
  for (let i = 0; i < 10; i++) {
    key = `wf-${randomBytes(4).toString("hex").slice(0, 6)}`;
    if (!(await db.workflow.findUnique({ where: { key } }))) break;
  }
  const row = await db.workflow.create({ data: { key, name: input.name, description: input.description ?? null, executor, dataSource: "mcp", permission, graph: json(graph), ...(input.enabled === undefined ? {} : { enabled: input.enabled }) } });
  await db.workflowVersion.create({ data: { workflowId: row.id, version: 1, graph: json(graph), note, createdBy: actor.id ?? actor.type } });
  await audit(actor, "workflow.create", { type: "workflow", id: row.id }, { after: { key, name: input.name, from: input.copy_of ?? input.template ?? "blank" } });
  return (await listWorkflows()).find((c) => c.key === key)!;
}

export interface VersionView {
  version: number;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  graph: WfGraph;
  /** the one the workflow is on now */
  current: boolean;
}

/** The versions of a workflow's drawing, newest first, with each graph (so the editor can open one as a draft). Null: no such workflow. */
export async function listVersions(key: string, limit = 30): Promise<VersionView[] | null> {
  const w = await db.workflow.findUnique({ where: { key }, select: { id: true, version: true, graph: true, updatedAt: true } });
  if (!w) return null;
  const rows = await db.workflowVersion.findMany({ where: { workflowId: w.id }, orderBy: { version: "desc" }, take: Math.min(limit, 100) });
  const empty: WfGraph = { nodes: [], edges: [] };
  const out: VersionView[] = rows.map((r) => ({ version: r.version, note: r.note, createdBy: r.createdBy, createdAt: r.createdAt.toISOString(), graph: GraphSchema.safeParse(r.graph).data ?? empty, current: r.version === w.version }));
  // a workflow never saved through the editor has no row for the version it is on: the list still starts with «now»
  if (!out.some((v) => v.version === w.version)) out.unshift({ version: w.version, note: w.version === 1 ? "النسخة الأولى" : null, createdBy: null, createdAt: w.updatedAt.toISOString(), graph: GraphSchema.safeParse(w.graph).data ?? empty, current: true });
  return out;
}
