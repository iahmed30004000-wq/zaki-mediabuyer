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
import { SEED_JOB_META } from "@/core/jobs";
import { refuseIfPrivate } from "@/core/push-rows";
import { isHttpsUrl } from "@/core/safe-url";
import { leaseUntil } from "@/core/handoff";
import { answerExtras, planRun } from "@/core/run-log";
import { isTerminalRun, type RunView as CoreRunView } from "@/core/run-state";
import { AGENT_RUN_STATUSES, EXECUTORS, assigneeOfExecutor, GraphSchema, NODE_STATUSES, PERMISSIONS, SEED_WORKFLOWS, type NodeStates, type RunStatus, type WfGraph } from "@/core/workflow";
import { diffText, ensureLayout, graphDiff, isChanged, templateOf } from "@/core/workflow-edit";
import { db } from "./db";
import { audit, type Actor } from "./audit";

const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Adds the seeded jobs that are missing. Never touches one that exists — what the owner edited stays his. */
export async function ensureSeeded(): Promise<number> {
  const r = await db.workflow.createMany({
    data: SEED_WORKFLOWS.map((s) => ({ key: s.key, name: s.name, description: s.description, schedule: s.schedule, executor: s.executor, assigneeKey: assigneeOfExecutor(s.executor), dataSource: "mcp", permission: s.permission, graph: json(s.graph), ...(SEED_JOB_META[s.key] ?? {}) })),
    skipDuplicates: true,
  });
  return r.count;
}

export interface RunView extends CoreRunView {
  id: string;
  ref: string;
  trigger: string;
  source: string;
  metrics: Record<string, unknown> | null;
  artifacts: { label: string; url?: string; text?: string }[] | null;
  summary: string | null;
  /** the full report, when the job sent one */
  report: string | null;
  doneBy: string | null;
  graphVersion: number | null;
}

export const runView = (r: WorkflowRun): RunView => ({
  id: r.id,
  ref: r.ref,
  status: r.status,
  trigger: r.trigger,
  source: r.source,
  startedAt: r.startedAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
  scheduledFor: r.scheduledFor?.toISOString() ?? null,
  heartbeatAt: r.heartbeatAt?.toISOString() ?? null,
  endReason: r.endReason,
  doneBy: r.doneBy,
  graphVersion: r.graphVersion,
  summary: r.summary,
  metrics: (r.metrics as RunView["metrics"]) ?? null,
  artifacts: (r.artifacts as RunView["artifacts"]) ?? null,
  nodeStates: (r.nodeStates as unknown as NodeStates) ?? {},
  report: r.report,
});

const NodeUpdate = z
  .object({
    id: z.string().trim().min(1).max(40),
    status: z.enum(NODE_STATUSES),
    note: z.string().trim().max(200).optional(),
    error: z.string().trim().max(300).optional().describe("ليش فشلت الخطوة (سطر، بلا بيانات زبائن)"),
  })
  .strict();
const iso = z.string().trim().min(8).max(40);

export const LogRunInput = z
  .object({
    job: z.string().trim().min(1).max(60).describe("مفتاح الورك فلو، مثلاً daily-check أو night-round"),
    ref: z.string().trim().min(1).max(80).optional().describe("معرّف التشغيل من عندك — لازم، ونفس المعرّف بيحدّث نفس التشغيل (استعمله لتحديثات الخطوات). بلا ref التسجيل بينرفض"),
    status: z.enum(AGENT_RUN_STATUSES).optional().describe("running · ok · failed · waiting · skipped — الافتراضي running. تشغيل خلص (ok/failed/skipped) ما بينفتح من جديد بـ running"),
    trigger: z.enum(["schedule", "manual", "event"]).optional(),
    started_at: iso.optional(),
    finished_at: iso.optional(),
    scheduled_for: iso.optional().describe("الموعد اللي هالتشغيل جواب عليه (ISO) — بيربط التشغيل بموعده"),
    heartbeat: z.boolean().optional().describe("true: لسا شغّال — للتشغيل الطويل، كل 20 دقيقة"),
    summary: z.string().trim().max(300).optional().describe("سطر واحد: شو صار"),
    report: z.string().trim().max(6000).optional().describe("نص التقرير الكامل للتشغيل (لحد 6000 حرف) — بيظهر بصفحة التقرير"),
    metrics: z.record(z.string(), z.union([z.number().finite(), z.string().max(80)])).optional().describe("أرقام التشغيل {الاسم: القيمة} (حتى 30)"),
    artifacts: z.array(z.object({ label: z.string().trim().min(1).max(80), url: z.string().trim().max(300).regex(/^https:\/\//i, "الرابط لازم يبدأ بـ https://").optional(), text: z.string().trim().max(500).optional() }).strict()).max(10).optional(),
    node: NodeUpdate.optional().describe("حالة خطوة وحدة: {id, status: running|done|failed|waiting|handoff|approval|skipped, note, error}"),
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

/** Who to write as the one who logged: the token's agent when it has one; the owner when he did it from the site; the site for its own writes. */
export const doneByOf = (actor: Actor, actorKey?: string | null): string | null => actorKey ?? (actor.type === "system" ? "site" : actor.type === "user" ? "owner" : null);

export interface LogRunResult {
  run: RunView;
  workflow: { key: string; name: string; enabled: boolean };
  created: boolean;
  /** the steps the owner switched off: the agent skips them (W-15) */
  disabled_steps: string[];
  /** the owner cancelled this run: the agent stops */
  stop: boolean;
  /** when the owner last changed a standing order (the agent re-reads its orders when this is newer than what it knows) */
  orders_changed_at: string | null;
}

/**
 * Records a run (or an update of one) and moves its workflow's steps. Idempotent by (job, ref), in ONE transaction that takes a lock on the
 * run, so two calls at the same moment are written one after the other and neither is lost. A call without `ref` is refused (every call used to
 * open a run of its own). What the run may become is `planRun`'s (src/core/run-log.ts); this writes it, and — when the run ended — closes
 * every request that was still open for it.
 */
export type LogRunCall = Omit<LogRunInputT, "status"> & { status?: RunStatus };

export async function logRun(input: LogRunCall, actor: Actor, source: "mcp" | "worker" | "ui" | "n8n", now = new Date(), opts: { actorKey?: string | null; site?: boolean; endReason?: string } = {}): Promise<LogRunResult> {
  if (!input.ref) throw new RunRefused("ref: لازم ref ثابت لكل تشغيل (نفس الـ ref بيحدّث نفس التشغيل). ابعته بأول نداء، وكرّره بكل تحديث.");
  const updates = [...(input.nodes ?? []), ...(input.node ? [input.node] : [])];
  const refusal = refuseIfPrivate(input.summary, input.report, ...Object.values(input.metrics ?? {}).map(String), ...(input.artifacts ?? []).flatMap((a) => [a.label, a.url, a.text]), ...updates.flatMap((u) => [u.note, u.error]));
  if (refusal) throw new RunRefused(refusal);
  if (input.metrics && Object.keys(input.metrics).length > 30) throw new RunRefused("metrics: حتى 30 رقم");
  for (const a of input.artifacts ?? []) if (a.url && !isHttpsUrl(a.url)) throw new RunRefused("artifacts: الرابط لازم https:// صريح (بلا اسم مستخدم)");

  const ref = input.ref;
  await ensureSeeded();
  const out = await db.$transaction(
    async (tx) => {
      // one run at a time: a second call for the same (job, ref) waits here until the first is written
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`run:${input.job}:${ref}`}))`;
      let wf: Workflow | null = await tx.workflow.findUnique({ where: { key: input.job } });
      let createdWorkflow = false;
      if (!wf && input.create_if_missing) {
        if (!/^[a-z0-9][a-z0-9-]{1,59}$/.test(input.job)) throw new RunRefused("job: حروف إنجليزية صغيرة وأرقام وشرطات بس");
        const graph: WfGraph = { nodes: [{ id: "start", type: "trigger", label: "بداية", executor: "system", permission: "green" }, { id: "work", type: "step", label: input.job, executor: "claude_mcp", dataSource: "mcp", permission: "green" }], edges: [{ from: "start", to: "work" }] };
        wf = await tx.workflow.create({ data: { key: input.job, name: input.job, executor: "claude_mcp", dataSource: "mcp", permission: "green", assigneeKey: "claude", graph: json(graph) } });
        createdWorkflow = true;
      }
      if (!wf) throw new UnknownJob((await tx.workflow.findMany({ where: { archivedAt: null }, select: { key: true }, orderBy: { key: "asc" } })).map((w) => w.key));

      const currentGraph = GraphSchema.parse(wf.graph);
      const existing = await tx.workflowRun.findUnique({ where: { workflowId_ref: { workflowId: wf.id, ref } } });
      // a run is drawn from the steps it began with: an older run keeps reading its own
      let runGraph = currentGraph;
      if (existing?.graphVersion != null && existing.graphVersion !== wf.version) {
        const v = await tx.workflowVersion.findUnique({ where: { workflowId_version: { workflowId: wf.id, version: existing.graphVersion } } });
        const parsed = v ? GraphSchema.safeParse(v.graph) : null;
        if (parsed?.success) runGraph = parsed.data;
      }

      const plan = planRun({
        existing: existing
          ? { status: existing.status, startedAt: existing.startedAt, finishedAt: existing.finishedAt, trigger: existing.trigger, scheduledFor: existing.scheduledFor, heartbeatAt: existing.heartbeatAt, doneBy: existing.doneBy, endReason: existing.endReason, graphVersion: existing.graphVersion, nodeStates: (existing.nodeStates as unknown as NodeStates) ?? {} }
          : null,
        input: { status: input.status, trigger: input.trigger, started_at: input.started_at, finished_at: input.finished_at, scheduled_for: input.scheduled_for, heartbeat: input.heartbeat, updates },
        runGraph,
        currentGraph,
        version: wf.version,
        now,
        actorKey: doneByOf(actor, opts.actorKey),
        site: opts.site,
        endReason: opts.endReason,
      });
      if (!plan.ok) throw new RunRefused(plan.error);

      const data = {
        ...plan.data,
        nodeStates: json(plan.data.nodeStates),
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
        ...(input.report !== undefined ? { report: input.report } : {}),
        ...(input.metrics ? { metrics: json(input.metrics) } : {}),
        ...(input.artifacts ? { artifacts: json(input.artifacts) } : {}),
      };
      const run = existing ? await tx.workflowRun.update({ where: { id: existing.id }, data }) : await tx.workflowRun.create({ data: { workflowId: wf.id, ref, source, ...data } });

      if (plan.closeRequests) {
        // the run ended: a request for it that is still open has nothing left to ask
        await tx.handoff.updateMany({ where: { workflowKey: wf.key, runRef: ref, status: { in: ["open", "claimed"] } }, data: { status: "done", doneBy: "auto", doneAt: now, resultNote: "انتهى التشغيل" } });
      } else if (!isTerminalRun(run.status)) {
        // the one who took it has spoken: its lease starts again
        await tx.handoff.updateMany({ where: { workflowKey: wf.key, runRef: ref, status: "claimed" }, data: { leaseUntil: leaseUntil(now, wf.maxRunMin) } });
      }
      const orders = await tx.standingOrder.aggregate({ _max: { updatedAt: true } });
      return { run, wf, created: plan.created, stop: plan.stop, createdWorkflow, currentGraph, ordersAt: orders._max.updatedAt };
    },
    { timeout: 15_000 },
  );

  if (out.createdWorkflow) await audit(actor, "workflow.create", { type: "workflow", id: out.wf.id }, { after: { key: out.wf.key, via: "log_run" } });
  await audit(actor, "workflow.log_run", { type: "workflow_run", id: out.run.id }, { after: { job: out.wf.key, status: out.run.status, summary: input.summary } });
  return {
    run: runView(out.run),
    workflow: { key: out.wf.key, name: out.wf.name, enabled: out.wf.enabled },
    created: out.created,
    ...answerExtras(out.currentGraph, out.stop),
    orders_changed_at: out.ordersAt?.toISOString() ?? null,
  };
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
  /** when it was last saved (ISO) — a page sends it back as `baseUpdatedAt` */
  updatedAt: string;
  graph: WfGraph;
  nextRun: string | null;
  lastRun: RunView | null;
  /** a run that is going on right now (started in the last 6 hours and not finished) */
  live: RunView | null;
  /** the place on the map (docs/rebuild/04-work.md §2) */
  number: number | null;
  domain: string;
  kind: string;
  scheduleText: string | null;
  runsAt: string | null;
  endsAt: string | null;
  finishedAt: string | null;
  runsFrom: string | null;
  origin: string | null;
  touches: string[];
  talksTo: string[];
  note: string | null;
  advice: string | null;
  adviceText: string | null;
  decision: string | null;
  decidedAt: string | null;
  source: string;
}

const LIVE_HOURS = 6;

/** Every workflow with its last run, the run that is moving now, and when it runs next (the Amman clock). */
export async function listWorkflows(now = new Date()): Promise<WorkflowCard[]> {
  await ensureSeeded();
  const rows = await db.workflow.findMany({ where: { archivedAt: null }, orderBy: [{ enabled: "desc" }, { name: "asc" }] });
  rows.sort((a, b) => Number(b.enabled) - Number(a.enabled) || (a.number ?? 9999) - (b.number ?? 9999) || a.name.localeCompare(b.name));
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
      updatedAt: w.updatedAt.toISOString(),
      graph: graph.success ? graph.data : { nodes: [], edges: [] },
      nextRun: w.enabled && w.schedule && isValidCron(w.schedule) ? (nextRuns(w.schedule, now, 1)[0]?.toISOString() ?? null) : null,
      lastRun: last ? runView(last) : null,
      live: live ? runView(live) : null,
      number: w.number,
      domain: w.domain,
      kind: w.kind,
      scheduleText: w.scheduleText,
      runsAt: w.runsAt?.toISOString() ?? null,
      endsAt: w.endsAt?.toISOString() ?? null,
      finishedAt: w.finishedAt?.toISOString() ?? null,
      runsFrom: w.runsFrom,
      origin: w.origin,
      touches: w.touches,
      talksTo: w.talksTo,
      note: w.note,
      advice: w.advice,
      adviceText: w.adviceText,
      decision: w.decision,
      decidedAt: w.decidedAt?.toISOString() ?? null,
      source: w.source,
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
    /** the version of the drawing the page was loaded with: if it moved since, the save is refused (409) — nobody's change is written over (W-11) */
    baseVersion: z.number().int().min(1).optional(),
    /** when the workflow was last saved (ISO) as the page knew it: for a change that is not the drawing (the switch, the name, the schedule) */
    baseUpdatedAt: z.string().trim().min(8).max(40).optional(),
  })
  .strict();
export type WorkflowPatchT = z.infer<typeof WorkflowPatch>;

/** Somebody saved it after the page loaded it. The owner is told to refresh; nothing is written. */
export class WorkflowConflict extends Error {
  constructor() {
    super("حدا عدّلها قبلك — حدّث الصفحة");
  }
}

export const graphTexts = (g: WfGraph) => g.nodes.flatMap((n) => [n.label, n.assignee, n.prompt, n.inputs, n.outputs, n.destination, n.fallback, n.target, n.desc]);

/**
 * Edits a workflow (or its kill switch). A change to the graph is a new version (a graph that says nothing new is not: saving
 * twice is saving once), and the version it replaces is kept; nothing is deleted — archive hides it. No text of the drawing may
 * carry a customer's number or a key: the drawing is read by Claude.
 */
export async function updateWorkflow(key: string, patch: WorkflowPatchT, actor: Actor, now = new Date()): Promise<WorkflowCard | null> {
  if (patch.schedule && !isValidCron(patch.schedule)) throw new RunRefused("schedule: الجدولة لازم cron من 5 خانات (دقيقة ساعة يوم شهر يوم-بالأسبوع)");
  const refusal = refuseIfPrivate(patch.name, patch.description ?? undefined, patch.note, ...(patch.graph ? graphTexts(patch.graph) : []));
  if (refusal) throw new RunRefused(refusal);

  // one write to a job at a time: the lock makes the check of the base, the version row and the write one step (two saves at once cannot both win)
  const done = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wf:${key}`}))`;
      const before = await tx.workflow.findUnique({ where: { key } });
      if (!before) return null;
      // a page that loaded an older version (or an older save) does not write over what was saved since
      if (patch.baseVersion !== undefined && patch.baseVersion !== before.version) throw new WorkflowConflict();
      if (patch.baseUpdatedAt !== undefined && Date.parse(patch.baseUpdatedAt) !== before.updatedAt.getTime()) throw new WorkflowConflict();
      const prev = GraphSchema.safeParse(before.graph);
      const diff = patch.graph && prev.success ? graphDiff(prev.data, patch.graph) : null;
      const newVersion = !!patch.graph && (!diff || isChanged(diff));
      if (newVersion) {
        // the version being replaced is kept, once (a workflow made before versions existed has none)
        await tx.workflowVersion.upsert({
          where: { workflowId_version: { workflowId: before.id, version: before.version } },
          create: { workflowId: before.id, version: before.version, graph: json(before.graph), note: before.version === 1 ? "النسخة الأولى" : null },
          update: {},
        });
      }
      const after = await tx.workflow.update({
        where: { key },
        data: {
          ...(patch.name ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.schedule !== undefined ? { schedule: patch.schedule } : {}),
          ...(patch.schedule !== undefined && patch.schedule !== before.schedule ? { scheduleChangedAt: now } : {}),
          ...(patch.executor ? { executor: patch.executor } : {}),
          // who carries it out follows the executor — unless somebody chose a key by hand (it no longer matches what the old executor gave)
          ...(patch.executor && (before.assigneeKey === null || before.assigneeKey === assigneeOfExecutor(before.executor)) ? { assigneeKey: assigneeOfExecutor(patch.executor) } : {}),
          ...(patch.permission ? { permission: patch.permission } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(newVersion ? { graph: json(patch.graph), version: { increment: 1 } } : {}),
          ...(patch.archived === undefined ? {} : { archivedAt: patch.archived ? new Date() : null }),
        },
      });
      if (newVersion) await tx.workflowVersion.create({ data: { workflowId: after.id, version: after.version, graph: json(patch.graph), note: patch.note ?? (diff ? diffText(diff) : null), createdBy: actor.id ?? actor.type } });
      return { before, after };
    },
    { timeout: 15_000 },
  );
  if (!done) return null;
  const { before, after } = done;
  await audit(actor, "workflow.update", { type: "workflow", id: after.id }, { before: { enabled: before.enabled, schedule: before.schedule, permission: before.permission, version: before.version }, after: { enabled: after.enabled, schedule: after.schedule, permission: after.permission, version: after.version } });
  return (await listWorkflows()).find((c) => c.key === key) ?? null;
}

/**
 * Switches ONE step of a job on or off, on the drawing as it is now (docs/rebuild-v6/01-model.md §14): the page sends «this step, on/off», not the
 * whole drawing, so two quick switches (or a switch from a stale tab) cannot undo each other. It is a new version of the drawing like any change
 * to it; the agent is told by every `log_run` answer (`disabled_steps`). Null: no such job. A step the job does not have is refused.
 */
export async function setStepEnabled(key: string, stepId: string, enabled: boolean, actor: Actor): Promise<{ card: WorkflowCard; changed: boolean } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const wf = await db.workflow.findUnique({ where: { key } });
    if (!wf) return null;
    const graph = GraphSchema.parse(wf.graph);
    const node = graph.nodes.find((n) => n.id === stepId);
    if (!node || node.type === "trigger") throw new RunRefused(`الخطوة «${stepId}» مش بخطوات هالمهمة`);
    if (!!node.disabled === !enabled) return { card: (await listWorkflows()).find((c) => c.key === key)!, changed: false };
    const next: WfGraph = { ...graph, nodes: graph.nodes.map((n) => (n.id === stepId ? { ...n, disabled: !enabled } : n)) };
    try {
      const card = await updateWorkflow(key, { graph: next, baseVersion: wf.version, note: enabled ? `شغّلت خطوة ${node.label}` : `طفّيت خطوة ${node.label}` }, actor);
      return card ? { card, changed: true } : null;
    } catch (e) {
      if (!(e instanceof WorkflowConflict)) throw e;
    }
  }
  throw new WorkflowConflict();
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
  const row = await db.workflow.create({ data: { key, name: input.name, description: input.description ?? null, executor, assigneeKey: assigneeOfExecutor(executor), dataSource: "mcp", permission, graph: json(graph), ...(input.enabled === undefined ? {} : { enabled: input.enabled }) } });
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
