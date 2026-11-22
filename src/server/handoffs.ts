/**
 * THE HANDOFF QUEUE, the server side (v3 · F). A handoff is work the app hands to Claude (or a person): the owner's
 * «شغّل هلق», or a step that failed / timed out / waits on a connection. It carries what is needed to do it; taking it moves
 * the workflow's run to «running», answering it moves the run on (or ends it). Nothing here spends or approves anything —
 * the queue only hands work over and takes results back, and what the results say passes the same customer-data filter as
 * every number Claude sends.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Handoff, Prisma } from "@prisma/client";
import { HANDOFF_KINDS, KIND_AR, STATUS_AR, assigneeLabel, canMove, firstStep, newRunRef, runStatusAfter, waitingMinutes, type HandoffKind, type HandoffStatus } from "@/core/handoff";
import { refuseIfPrivate } from "@/core/push-rows";
import { GraphSchema } from "@/core/workflow";
import { audit, type Actor } from "./audit";
import { db } from "./db";
import { UnknownJob, ensureSeeded, logRun, type LogRunInputT, type RunView } from "./workflows";

const json = (v: unknown) => v as Prisma.InputJsonValue;

export class HandoffRefused extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const text = (n: number) => z.string().trim().min(1).max(n);
const Inputs = z.record(z.string(), z.union([z.string().max(200), z.number().finite()])).refine((o) => Object.keys(o).length <= 20, "حتى 20 مدخل");

export const HandoffCreate = z
  .object({
    workflow: text(60).describe("مفتاح الورك فلو (daily-check، night-round…)"),
    kind: z.enum(HANDOFF_KINDS).default("needs_input").describe("manual_run · node_failed · missing_connection · timeout · needs_input"),
    node: text(40).optional().describe("الخطوة اللي واقفة (id من خطوات الورك فلو)"),
    title: text(160).describe("سطر واحد: شو واقف"),
    need: text(500).optional().describe("شو لازم يصير بالضبط عشان تكمل"),
    last_error: text(500).optional(),
    prompt: text(2000).optional(),
    inputs: Inputs.optional().describe("المدخلات {الاسم: القيمة} — بلا بيانات زبائن"),
    assignee: text(40).optional().describe("claude (الافتراضي) · claude_desktop · hermes · muse · أو مفتاح شخص"),
    run_ref: text(80).optional().describe("معرّف التشغيل إذا الخطوة من تشغيل شغّال (نفس ref لـ log_run)"),
  })
  .strict();
export type HandoffCreateT = z.infer<typeof HandoffCreate>;

export const HandoffComplete = z
  .object({
    note: text(300).optional().describe("سطر: شو انعمل"),
    result: z.record(z.string(), z.union([z.string().max(80), z.number().finite()])).refine((o) => Object.keys(o).length <= 20, "حتى 20 رقم").optional().describe("النتيجة {الاسم: القيمة}"),
    run_status: z.enum(["running", "ok", "failed"]).optional().describe("كيف انتهى التشغيل: ok · failed · running (الافتراضي: ok لطلب المالك، running لخطوة واقفة)"),
  })
  .strict();
export type HandoffCompleteT = z.infer<typeof HandoffComplete>;

export interface HandoffView {
  id: string;
  workflowKey: string;
  workflowName: string | null;
  runRef: string | null;
  nodeId: string | null;
  kind: HandoffKind;
  kindLabel: string;
  title: string;
  context: { job?: string; need?: string; lastError?: string; prompt?: string; inputs?: Record<string, string | number>; steps?: { id: string; label: string }[]; how?: string };
  assignee: string;
  assigneeLabel: string;
  status: HandoffStatus;
  statusLabel: string;
  claimedBy: string | null;
  claimedAt: string | null;
  result: Record<string, string | number> | null;
  resultNote: string | null;
  doneBy: string | null;
  doneAt: string | null;
  createdAt: string;
  waitingMin: number;
}

function toView(h: Handoff, names: Map<string, string>, now = Date.now()): HandoffView {
  return {
    id: h.id,
    workflowKey: h.workflowKey,
    workflowName: names.get(h.workflowKey) ?? null,
    runRef: h.runRef,
    nodeId: h.nodeId,
    kind: h.kind as HandoffKind,
    kindLabel: KIND_AR[h.kind as HandoffKind] ?? h.kind,
    title: h.title,
    context: (h.context as HandoffView["context"]) ?? {},
    assignee: h.assignee,
    assigneeLabel: assigneeLabel(h.assignee),
    status: h.status as HandoffStatus,
    statusLabel: STATUS_AR[h.status as HandoffStatus] ?? h.status,
    claimedBy: h.claimedBy,
    claimedAt: h.claimedAt?.toISOString() ?? null,
    result: (h.result as HandoffView["result"]) ?? null,
    resultNote: h.resultNote,
    doneBy: h.doneBy,
    doneAt: h.doneAt?.toISOString() ?? null,
    createdAt: h.createdAt.toISOString(),
    waitingMin: waitingMinutes(h.createdAt.toISOString(), now),
  };
}

async function views(rows: Handoff[]): Promise<HandoffView[]> {
  const keys = [...new Set(rows.map((r) => r.workflowKey))];
  const names = new Map((await db.workflow.findMany({ where: { key: { in: keys } }, select: { key: true, name: true } })).map((w) => [w.key, w.name]));
  const now = Date.now();
  return rows.map((r) => toView(r, names, now));
}

const actorKey = (a: Actor) => (a.id ? `${a.type}:${a.id}` : a.type).slice(0, 60);

/**
 * Hands a piece of work over. The workflow's run is created (or updated) as «waiting» with the step marked «handoff», so
 * الورك فلو shows it at once. A «manual_run» request is one at a time per workflow: asking again returns the open one.
 */
export async function createHandoff(input: HandoffCreateT, actor: Actor, now = new Date(), opts: { card?: string } = {}): Promise<{ handoff: HandoffView; created: boolean }> {
  const refusal = refuseIfPrivate(input.title, input.need, input.last_error, input.prompt, ...Object.values(input.inputs ?? {}).map(String));
  if (refusal) throw new HandoffRefused(refusal);
  await ensureSeeded();
  const wf = await db.workflow.findUnique({ where: { key: input.workflow } });
  if (!wf || wf.archivedAt) throw new UnknownJob((await db.workflow.findMany({ where: { archivedAt: null }, select: { key: true }, orderBy: { key: "asc" } })).map((w) => w.key));
  const graph = GraphSchema.parse(wf.graph);

  if (input.kind === "manual_run") {
    // a run a button on a card asked for is one at a time per CARD (its inputs say which); «شغّل هلق» is one at a time per workflow
    const open = await db.handoff.findFirst({ where: { workflowKey: wf.key, kind: "manual_run", status: { in: ["open", "claimed"] }, ...(opts.card ? { context: { path: ["inputs", "card_id"], equals: opts.card } } : {}) } });
    if (open) return { handoff: (await views([open]))[0]!, created: false };
  }
  const node = input.node ?? (input.kind === "manual_run" ? firstStep(graph)?.id : undefined);
  if (node && !graph.nodes.some((n) => n.id === node)) throw new HandoffRefused(`node: «${node}» مش بخطوات ${wf.key} — الخطوات: ${graph.nodes.map((n) => n.id).join("، ")}`);

  const ref = input.run_ref ?? newRunRef(input.kind, now, randomBytes(3).toString("hex"));
  const steps = graph.nodes.filter((n) => n.type !== "trigger" && !n.disabled).map((n) => ({ id: n.id, label: n.label }));
  const row = await db.handoff.create({
    data: {
      workflowKey: wf.key,
      runRef: ref,
      nodeId: node ?? null,
      kind: input.kind,
      title: input.title,
      context: json({
        job: wf.key,
        ...(input.need ?? wf.description ? { need: input.need ?? wf.description } : {}),
        ...(input.last_error ? { lastError: input.last_error } : {}),
        ...(input.prompt ? { prompt: input.prompt } : {}),
        ...(input.inputs ? { inputs: input.inputs } : {}),
        steps,
        how: `نفّذ الخطوات وسجّلها بـ log_run (job=${wf.key}, ref=${ref})، وبعدها complete_handoff.`,
      }),
      assignee: input.assignee ?? "claude",
      createdBy: actorKey(actor),
    },
  });
  await logRun(
    { job: wf.key, ref, status: "waiting", ...(input.kind === "manual_run" ? { trigger: "manual" as const } : {}), summary: input.kind === "manual_run" ? "بانتظار Claude" : `بانتظار تسليم: ${input.title}`.slice(0, 300), ...(node ? { node: { id: node, status: "handoff" as const, note: input.title.slice(0, 200) } } : {}) },
    actor,
    "ui",
    now,
  );
  await audit(actor, "handoff.create", { type: "handoff", id: row.id }, { after: { workflow: wf.key, kind: input.kind, assignee: row.assignee } });
  return { handoff: (await views([row]))[0]!, created: true };
}

export interface HandoffFilter {
  status?: HandoffStatus[];
  /** «claude» means every kind of Claude (claude · claude_desktop · claude_task) */
  assignee?: string;
  workflow?: string;
  limit?: number;
}

export async function listHandoffs(f: HandoffFilter = {}): Promise<HandoffView[]> {
  const status = f.status?.length ? f.status : (["open", "claimed"] as HandoffStatus[]);
  const rows = await db.handoff.findMany({
    where: {
      status: { in: status },
      ...(f.workflow ? { workflowKey: f.workflow } : {}),
      ...(f.assignee ? (f.assignee === "claude" ? { assignee: { startsWith: "claude" } } : { assignee: f.assignee }) : {}),
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(f.limit ?? 50, 200),
  });
  return views(rows);
}

async function mustFind(id: string): Promise<Handoff> {
  const row = await db.handoff.findUnique({ where: { id } });
  if (!row) throw new HandoffRefused("التسليم مش موجود", 404);
  return row;
}

/** Moves the run the handoff holds up; a workflow that is gone since must not stop the answer from being recorded. */
async function moveRun(h: Handoff, change: Omit<LogRunInputT, "job" | "ref">, actor: Actor, now: Date): Promise<RunView | null> {
  if (!h.runRef) return null;
  try {
    return (await logRun({ job: h.workflowKey, ref: h.runRef, ...change }, actor, "ui", now)).run;
  } catch (e) {
    if (e instanceof UnknownJob) return null;
    throw e;
  }
}

/** Takes it: from now on the run is «running» and the step shows who has it. A second taker is told. */
export async function claimHandoff(id: string, by: string, actor: Actor, now = new Date()): Promise<HandoffView> {
  const row = await mustFind(id);
  if (row.status === "claimed" && row.claimedBy === by) return (await views([row]))[0]!;
  if (!canMove(row.status as HandoffStatus, "claimed")) throw new HandoffRefused(`هالتسليم ${STATUS_AR[row.status as HandoffStatus] ?? row.status} — ما بينفع تاخده`, 409);
  const r = await db.handoff.updateMany({ where: { id, status: "open" }, data: { status: "claimed", claimedBy: by, claimedAt: now } });
  if (r.count === 0) throw new HandoffRefused("حدا تاني أخدها قبلك", 409);
  const taken = await mustFind(id);
  await moveRun(taken, { status: "running", ...(taken.nodeId ? { node: { id: taken.nodeId, status: "running" as const, note: `عند ${by}`.slice(0, 200) } } : {}) }, actor, now);
  await audit(actor, "handoff.claim", { type: "handoff", id }, { after: { by } });
  return (await views([taken]))[0]!;
}

/** Answers it. The run ends (or goes on) as `runStatusAfter` says; the step becomes done, or failed when the answer says so. */
export async function completeHandoff(id: string, input: HandoffCompleteT, by: string, actor: Actor, now = new Date()): Promise<{ handoff: HandoffView; run: RunView | null }> {
  const refusal = refuseIfPrivate(input.note, ...Object.values(input.result ?? {}).map(String));
  if (refusal) throw new HandoffRefused(refusal);
  const row = await mustFind(id);
  if (!canMove(row.status as HandoffStatus, "done")) throw new HandoffRefused(`هالتسليم ${STATUS_AR[row.status as HandoffStatus] ?? row.status} — ما بينفع تجاوبه`, 409);
  const r = await db.handoff.updateMany({ where: { id, status: { in: ["open", "claimed"] } }, data: { status: "done", doneBy: by, doneAt: now, resultNote: input.note ?? null, ...(input.result ? { result: json(input.result) } : {}) } });
  if (r.count === 0) throw new HandoffRefused("انجاوبت قبل شوي", 409);
  const done = await mustFind(id);
  const status = runStatusAfter(done.kind as HandoffKind, input.run_status);
  const run = await moveRun(
    done,
    {
      status,
      ...(input.note ? { summary: input.note } : {}),
      ...(input.result ? { metrics: input.result } : {}),
      ...(done.nodeId ? { node: { id: done.nodeId, status: status === "failed" ? ("failed" as const) : ("done" as const), ...(input.note ? { note: input.note.slice(0, 200) } : {}) } } : {}),
    },
    actor,
    now,
  );
  await audit(actor, "handoff.complete", { type: "handoff", id }, { after: { by, runStatus: status } });
  return { handoff: (await views([done]))[0]!, run };
}

/** «شغّل هلق»: asks Claude to run a workflow now — one request at a time per workflow (asking again returns the open one). */
export async function requestRun(key: string, actor: Actor, now = new Date()): Promise<{ handoff: HandoffView; created: boolean }> {
  await ensureSeeded();
  const wf = await db.workflow.findUnique({ where: { key } });
  if (!wf || wf.archivedAt) throw new HandoffRefused("الورك فلو مش موجود", 404);
  if (!wf.enabled) throw new HandoffRefused("هالورك فلو مطفي — شغّله أول", 409);
  return createHandoff({ workflow: key, kind: "manual_run", title: `شغّل «${wf.name}» هلق`.slice(0, 160), assignee: "claude" }, actor, now);
}

/** The owner gives it to someone else: back to «open», for that assignee. */
export async function reassignHandoff(id: string, assignee: string, actor: Actor): Promise<HandoffView> {
  const to = z.string().trim().min(1).max(40).safeParse(assignee);
  if (!to.success) throw new HandoffRefused("لمين؟ اكتب مفتاح الشخص أو الوكيل");
  const row = await mustFind(id);
  if (row.status !== "open" && !canMove(row.status as HandoffStatus, "open")) throw new HandoffRefused(`هالتسليم ${STATUS_AR[row.status as HandoffStatus] ?? row.status} — ما بينفع تغيّر مين عليه`, 409);
  const updated = await db.handoff.update({ where: { id }, data: { assignee: to.data, status: "open", claimedBy: null, claimedAt: null } });
  await audit(actor, "handoff.reassign", { type: "handoff", id }, { before: { assignee: row.assignee }, after: { assignee: updated.assignee } });
  return (await views([updated]))[0]!;
}

/** The owner drops it: the run it held up is marked skipped. Nothing is deleted. */
export async function cancelHandoff(id: string, actor: Actor, now = new Date()): Promise<HandoffView> {
  const row = await mustFind(id);
  if (!canMove(row.status as HandoffStatus, "cancelled")) throw new HandoffRefused(`هالتسليم ${STATUS_AR[row.status as HandoffStatus] ?? row.status}`, 409);
  const updated = await db.handoff.update({ where: { id }, data: { status: "cancelled", doneBy: actorKey(actor), doneAt: now } });
  await moveRun(updated, { status: "skipped", summary: "الغاها المالك" }, actor, now);
  await audit(actor, "handoff.cancel", { type: "handoff", id });
  return (await views([updated]))[0]!;
}
