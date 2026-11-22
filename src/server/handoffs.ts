/**
 * THE HANDOFF QUEUE, the server side (v3 · F, v6 · P1-1). A handoff is work the app hands to Claude (or a person): the owner's
 * «شغّل هلق», or a step that failed / timed out / waits on a connection, or «كمّل من هون» after the owner's decision. It carries what is
 * needed to do it; taking it moves the workflow's run to «running», answering it moves the run on (or leaves it as it ended). Nothing here
 * spends or approves anything — the queue only hands work over and takes results back, and what the results say passes the same
 * customer-data filter as every number Claude sends.
 *
 * v6 (docs/rebuild-v6/01-model.md §7): a request has an end (`expiresAt`), a taker has a lease (`leaseUntil`) and a code (`claimNonce`), the
 * request goes to the job's own agent (`Workflow.assigneeKey`), only that agent takes or answers it, and an answer does not turn a failure
 * into a success.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Handoff, Prisma } from "@prisma/client";
import { AGENT_HANDOFF_KINDS, KIND_AR, STATUS_AR, assigneeLabel, canMove, claimGate, completeGate, expiryFor, firstStep, isExpired, leaseUntil, newRunRef, queueAssignee, waitingMinutes, type HandoffKind, type HandoffStatus } from "@/core/handoff";
import { refuseIfPrivate } from "@/core/push-rows";
import { isTerminalRun, nodeStatusOnComplete, statusOnComplete } from "@/core/run-state";
import { GraphSchema, type NodeStates } from "@/core/workflow";
import { audit, type Actor } from "./audit";
import { db } from "./db";
import { loadJob } from "./job-map";
import { UnknownJob, logRun, type LogRunCall, type RunView } from "./workflows";

const json = (v: unknown) => v as Prisma.InputJsonValue;

export class HandoffRefused extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Who is asking: the token's agent (null for an old token that is tied to nobody), or the owner signed in on the site. */
export interface HandoffWho {
  actorKey?: string | null;
  owner?: boolean;
}

const text = (n: number) => z.string().trim().min(1).max(n);
const Inputs = z.record(z.string(), z.union([z.string().max(200), z.number().finite()])).refine((o) => Object.keys(o).length <= 20, "حتى 20 مدخل");

export const HandoffCreate = z
  .object({
    workflow: text(60).describe("مفتاح الورك فلو (daily-check، night-round…)"),
    kind: z.enum(AGENT_HANDOFF_KINDS).default("needs_input").describe("manual_run · node_failed · missing_connection · timeout · needs_input"),
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
export type HandoffCreateT = z.infer<typeof HandoffCreate> | (Omit<z.infer<typeof HandoffCreate>, "kind"> & { kind: HandoffKind });

export const HandoffComplete = z
  .object({
    note: text(300).optional().describe("سطر: شو انعمل"),
    result: z.record(z.string(), z.union([z.string().max(80), z.number().finite()])).refine((o) => Object.keys(o).length <= 20, "حتى 20 رقم").optional().describe("النتيجة {الاسم: القيمة}"),
    run_status: z.enum(["running", "ok", "failed"]).optional().describe("كيف انتهى التشغيل: ok · failed · running. بلا run_status التشغيل بيضل على حالته (تشغيل فشل ما بينقلب نجاح)؛ تشغيل طلبه المالك ما فشلت خطوة منه بيصير ok"),
    claim: z.string().trim().min(1).max(80).optional().describe("رمز الاستلام اللي إجاك بـ claim_handoff — بلاه بيطلب إنك تكون المكلّف"),
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
  /** nobody took it by then: it ends */
  expiresAt: string | null;
  /** taken but silent after this: it reopens */
  leaseUntil: string | null;
  scheduledFor: string | null;
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
    expiresAt: h.expiresAt?.toISOString() ?? null,
    leaseUntil: h.leaseUntil?.toISOString() ?? null,
    scheduledFor: h.scheduledFor?.toISOString() ?? null,
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
 * One request whose time is up ends here (nobody took it by `expiresAt`), and the run it held up is `missed`: it never started. Conditional on the
 * request still being open, so two callers (the watchdog and a reader) end it once. Returns the run it missed, when there was one.
 */
export async function expireHandoff(id: string, now = new Date()): Promise<{ ended: boolean; runId: string | null; jobKey: string | null }> {
  const h = await db.handoff.findUnique({ where: { id }, select: { id: true, workflowKey: true, runRef: true } });
  if (!h) return { ended: false, runId: null, jobKey: null };
  const r = await db.handoff.updateMany({ where: { id, status: "open", expiresAt: { lte: now } }, data: { status: "cancelled", doneBy: "auto", doneAt: now, resultNote: "انتهت مهلتها — ما حدا أخدها" } });
  if (!r.count) return { ended: false, runId: null, jobKey: h.workflowKey };
  let runId: string | null = null;
  if (h.runRef) {
    const wf = await db.workflow.findUnique({ where: { key: h.workflowKey }, select: { id: true } });
    if (wf) {
      const run = await db.workflowRun.findUnique({ where: { workflowId_ref: { workflowId: wf.id, ref: h.runRef } }, select: { id: true, status: true } });
      const m = await db.workflowRun.updateMany({ where: { workflowId: wf.id, ref: h.runRef, status: { in: ["queued", "waiting"] } }, data: { status: "missed", endReason: "missed", finishedAt: now } });
      if (m.count && run) runId = run.id;
    }
  }
  return { ended: true, runId, jobKey: h.workflowKey };
}

/**
 * The requests whose time is up (nobody took them by `expiresAt`) end here, and the run each held up is `missed`: it never started. Cheap —
 * one read when there is nothing to end — and safe to call from anywhere (the watchdog ends them too, once a minute, and says so).
 */
export async function endExpired(now = new Date(), key?: string): Promise<number> {
  const stale = await db.handoff.findMany({ where: { status: "open", expiresAt: { lte: now }, ...(key ? { workflowKey: key } : {}) }, select: { id: true } });
  let n = 0;
  for (const h of stale) if ((await expireHandoff(h.id, now)).ended) n += 1;
  return n;
}

/**
 * Hands a piece of work over, to the job's own agent. A «manual_run» (or «resume») is one run waiting in the queue (`queued`): it ends 6 hours
 * after it was asked (a scheduled one: its slot + graceMin) if nobody takes it. Asking again while one is open returns the open one, with how
 * long it has been waiting. A stuck step shows the run as «waiting» with the step marked «handoff».
 */
export async function createHandoff(input: HandoffCreateT, actor: Actor, now = new Date(), opts: { card?: string; scheduledFor?: Date | null; trigger?: "schedule" | "manual" | "event" } = {}): Promise<{ handoff: HandoffView; created: boolean; since?: string }> {
  const refusal = refuseIfPrivate(input.title, input.need, input.last_error, input.prompt, ...Object.values(input.inputs ?? {}).map(String));
  if (refusal) throw new HandoffRefused(refusal);
  const wf = await loadJob(input.workflow);
  if (!wf || wf.archivedAt) throw new UnknownJob((await db.workflow.findMany({ where: { archivedAt: null }, select: { key: true }, orderBy: { key: "asc" } })).map((w) => w.key));
  const graph = GraphSchema.parse(wf.graph);
  const kind = input.kind as HandoffKind;
  const queued = kind === "manual_run" || kind === "resume";

  if (queued) await endExpired(now, wf.key);
  if (kind === "manual_run" && opts.scheduledFor && input.run_ref) {
    // a slot's own request (the watchdog asks for it): one per slot, whatever else is open — the run it makes carries the slot's ref
    const had = await db.workflowRun.findUnique({ where: { workflowId_ref: { workflowId: wf.id, ref: input.run_ref } }, select: { id: true } });
    if (had) throw new HandoffRefused("هالموعد إله تشغيل من قبل", 409);
  } else if (kind === "manual_run") {
    // a run a button on a card asked for is one at a time per CARD (its inputs say which); «شغّل هلق» is one at a time per workflow
    const open = await db.handoff.findFirst({ where: { workflowKey: wf.key, kind: "manual_run", status: { in: ["open", "claimed"] }, ...(opts.card ? { context: { path: ["inputs", "card_id"], equals: opts.card } } : {}) } });
    if (open) return { handoff: (await views([open]))[0]!, created: false, since: open.createdAt.toISOString() };
  }
  const node = input.node ?? (kind === "manual_run" ? firstStep(graph)?.id : undefined);
  if (node && !graph.nodes.some((n) => n.id === node)) throw new HandoffRefused(`node: «${node}» مش بخطوات ${wf.key} — الخطوات: ${graph.nodes.map((n) => n.id).join("، ")}`);

  // an agent's request (a stuck step, a timeout…) never reopens a run that ended or that the owner cancelled: only the site's own queued requests may write the run
  if (!queued && input.run_ref) {
    const known = await db.workflowRun.findUnique({ where: { workflowId_ref: { workflowId: wf.id, ref: input.run_ref } }, select: { status: true, endReason: true } });
    if (known && (isTerminalRun(known.status) || known.endReason === "cancelled")) throw new HandoffRefused("التشغيل خلص / ألغاه المالك — ما بينفع تفتح تسليم عليه. اعمل تشغيل جديد بـ ref جديد", 409);
  }
  const ref = input.run_ref ?? newRunRef(kind, now, randomBytes(3).toString("hex"));
  const steps = graph.nodes.filter((n) => n.type !== "trigger" && !n.disabled).map((n) => ({ id: n.id, label: n.label }));
  const assignee = input.assignee ?? queueAssignee(wf.assigneeKey);
  const row = await db.handoff.create({
    data: {
      workflowKey: wf.key,
      runRef: ref,
      nodeId: node ?? null,
      kind,
      title: input.title,
      context: json({
        job: wf.key,
        ...(input.need ?? wf.description ? { need: input.need ?? wf.description } : {}),
        ...(input.last_error ? { lastError: input.last_error } : {}),
        ...(input.prompt ? { prompt: input.prompt } : {}),
        ...(input.inputs ? { inputs: input.inputs } : {}),
        steps,
        how: `خذها بـ claim_handoff (بيرجّعلك رمز claim)، نفّذ الخطوات وسجّلها بـ log_run (job=${wf.key}, ref=${ref})، وبعدها complete_handoff مع الرمز.`,
      }),
      assignee,
      createdBy: actorKey(actor),
      createdAt: now,
      ...(opts.scheduledFor ? { scheduledFor: opts.scheduledFor } : {}),
      ...(queued ? { expiresAt: expiryFor({ scheduledFor: opts.scheduledFor, graceMin: wf.graceMin, now }) } : {}),
    },
  });
  const waitingOn = `بانتظار ${assigneeLabel(assignee)}`;
  await logRun(
    {
      job: wf.key,
      ref,
      status: queued ? "queued" : "waiting",
      ...(opts.trigger ? { trigger: opts.trigger } : kind === "manual_run" ? { trigger: "manual" as const } : {}),
      ...(opts.scheduledFor ? { scheduled_for: opts.scheduledFor.toISOString() } : {}),
      summary: queued ? waitingOn : `بانتظار تسليم: ${input.title}`.slice(0, 300),
      ...(node && !queued ? { node: { id: node, status: "handoff" as const, note: input.title.slice(0, 200) } } : {}),
    },
    actor,
    "ui",
    now,
    { site: true },
  );
  await audit(actor, "handoff.create", { type: "handoff", id: row.id }, { after: { workflow: wf.key, kind, assignee: row.assignee } });
  return { handoff: (await views([row]))[0]!, created: true };
}

export interface HandoffFilter {
  status?: HandoffStatus[];
  /** «claude» means every kind of Claude (claude · claude_desktop · claude_task) */
  assignee?: string;
  workflow?: string;
  limit?: number;
}

/** What waits for someone (or has been answered): a request whose time is up is not offered. */
export async function listHandoffs(f: HandoffFilter = {}, now = new Date()): Promise<HandoffView[]> {
  const status = f.status?.length ? f.status : (["open", "claimed"] as HandoffStatus[]);
  const rows = await db.handoff.findMany({
    where: {
      status: { in: status },
      AND: [{ OR: [{ status: { not: "open" } }, { expiresAt: null }, { expiresAt: { gt: now } }] }],
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

/** Moves the run the handoff holds up (the site writes it: it may reopen a run); a workflow that is gone since must not stop the answer from being recorded. */
async function moveRun(h: Handoff, change: Omit<LogRunCall, "job" | "ref">, actor: Actor, now: Date, opts: { endReason?: string } = {}): Promise<RunView | null> {
  if (!h.runRef) return null;
  try {
    return (await logRun({ job: h.workflowKey, ref: h.runRef, ...change }, actor, "ui", now, { site: true, ...opts })).run;
  } catch (e) {
    if (e instanceof UnknownJob) return null;
    throw e;
  }
}

const runOf = async (h: Handoff) => {
  if (!h.runRef) return null;
  const wf = await db.workflow.findUnique({ where: { key: h.workflowKey }, select: { id: true, maxRunMin: true } });
  if (!wf) return null;
  const run = await db.workflowRun.findUnique({ where: { workflowId_ref: { workflowId: wf.id, ref: h.runRef } } });
  return { wf, run };
};

/**
 * Takes it: from now on the run is «running» and the step shows who has it. Only whoever it was given to may take it; the second taker is
 * told. The answer carries `claim` — the code the answer must show — and it is the only time it is said. The lease starts: silence for the job's
 * `maxRunMin` reopens the request.
 */
export async function claimHandoff(id: string, by: string, actor: Actor, now = new Date(), who: HandoffWho = {}): Promise<{ handoff: HandoffView; claim: string }> {
  const row = await mustFind(id);
  const gate = claimGate(row, { actorKey: who.actorKey ?? null, owner: who.owner });
  if (!gate.ok) throw new HandoffRefused(gate.message, gate.status);
  if (isExpired(row, now)) {
    await endExpired(now, row.workflowKey);
    throw new HandoffRefused("انتهت مهلة هالتسليم — ما حدا أخدها بوقتها", 409);
  }
  if (!canMove(row.status as HandoffStatus, "claimed") || row.status === "claimed") throw new HandoffRefused(`هالتسليم ${STATUS_AR[row.status as HandoffStatus] ?? row.status} — ما بينفع تاخده`, 409);
  const wf = await db.workflow.findUnique({ where: { key: row.workflowKey }, select: { maxRunMin: true } });
  const nonce = randomBytes(12).toString("base64url");
  const r = await db.handoff.updateMany({
    where: { id, status: "open", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    data: { status: "claimed", claimedBy: by, claimedAt: now, claimNonce: nonce, leaseUntil: leaseUntil(now, wf?.maxRunMin ?? 90) },
  });
  if (r.count === 0) throw new HandoffRefused("حدا تاني أخدها قبلك", 409);
  const taken = await mustFind(id);
  await moveRun(taken, { status: "running", ...(taken.nodeId ? { node: { id: taken.nodeId, status: "running" as const, note: `عند ${by}`.slice(0, 200) } } : {}) }, actor, now);
  await audit(actor, "handoff.claim", { type: "handoff", id }, { after: { by } });
  return { handoff: (await views([taken]))[0]!, claim: nonce };
}

/**
 * Answers it. With the claim code, or as the one it was given to (the owner, signed in, always). The run moves as `statusOnComplete` says: the
 * answer's own `run_status`; else it stays as it ended (a failure is never turned into a success), a stuck step only unblocks the run, and a run
 * that was asked for and has no failed step is `ok`. The summary and numbers are written only when sent. A request the run's end already
 * closed («doneBy: auto») may still be answered once, to leave its note.
 */
export async function completeHandoff(id: string, input: HandoffCompleteT, by: string, actor: Actor, now = new Date(), who: HandoffWho = {}): Promise<{ handoff: HandoffView; run: RunView | null }> {
  const refusal = refuseIfPrivate(input.note, ...Object.values(input.result ?? {}).map(String));
  if (refusal) throw new HandoffRefused(refusal);
  const row = await mustFind(id);
  const gate = completeGate(row, { actorKey: who.actorKey ?? null, claim: input.claim, owner: who.owner });
  if (!gate.ok) throw new HandoffRefused(gate.message, gate.status);

  const closedByRun = row.status === "done" && row.doneBy === "auto";
  if (!closedByRun && !canMove(row.status as HandoffStatus, "done")) throw new HandoffRefused(`هالتسليم ${STATUS_AR[row.status as HandoffStatus] ?? row.status} — ما بينفع تجاوبه`, 409);
  const note = { resultNote: input.note ?? null, ...(input.result ? { result: json(input.result) } : {}) };
  const r = closedByRun
    ? await db.handoff.updateMany({ where: { id, status: "done", doneBy: "auto" }, data: { doneBy: by, doneAt: now, ...note } })
    : await db.handoff.updateMany({ where: { id, status: { in: ["open", "claimed"] } }, data: { status: "done", doneBy: by, doneAt: now, ...note } });
  if (r.count === 0) throw new HandoffRefused("انجاوبت قبل شوي", 409);
  const done = await mustFind(id);
  if (closedByRun) {
    await audit(actor, "handoff.complete", { type: "handoff", id }, { after: { by, runStatus: "unchanged" } });
    return { handoff: (await views([done]))[0]!, run: null };
  }

  const found = await runOf(done);
  const current = found?.run ? { status: found.run.status, nodeStates: (found.run.nodeStates as unknown as NodeStates) ?? {} } : null;
  const status = statusOnComplete(done.kind, input.run_status, current);
  const nodeStatus = done.nodeId ? nodeStatusOnComplete(status, current?.nodeStates[done.nodeId]) : undefined;
  const run = await moveRun(
    done,
    {
      ...(status ? { status } : {}),
      ...(input.note ? { summary: input.note } : {}),
      ...(input.result ? { metrics: input.result } : {}),
      ...(done.nodeId && nodeStatus ? { node: { id: done.nodeId, status: nodeStatus, ...(input.note ? { note: input.note.slice(0, 200) } : {}) } } : {}),
    },
    actor,
    now,
  );
  await audit(actor, "handoff.complete", { type: "handoff", id }, { after: { by, runStatus: status ?? "unchanged" } });
  return { handoff: (await views([done]))[0]!, run };
}

/** «شغّل هلق»: asks the job's agent to run it now — one request at a time per job (asking again returns the open one, and how long it has waited). */
export async function requestRun(key: string, actor: Actor, now = new Date()): Promise<{ handoff: HandoffView; created: boolean; since?: string }> {
  const wf = await loadJob(key);
  if (!wf || wf.archivedAt) throw new HandoffRefused("الورك فلو مش موجود", 404);
  if (!wf.enabled) throw new HandoffRefused("هالورك فلو مطفي — شغّله أول", 409);
  return createHandoff({ workflow: wf.key, kind: "manual_run", title: `شغّل «${wf.name}» هلق`.slice(0, 160), assignee: queueAssignee(wf.assigneeKey) }, actor, now);
}

/** The owner gives it to someone else: back to «open», for that assignee (the old taker's code and lease are void). */
export async function reassignHandoff(id: string, assignee: string, actor: Actor): Promise<HandoffView> {
  const to = z.string().trim().min(1).max(40).safeParse(assignee);
  if (!to.success) throw new HandoffRefused("لمين؟ اكتب مفتاح الشخص أو الوكيل");
  const row = await mustFind(id);
  if (row.status !== "open" && !canMove(row.status as HandoffStatus, "open")) throw new HandoffRefused(`هالتسليم ${STATUS_AR[row.status as HandoffStatus] ?? row.status} — ما بينفع تغيّر مين عليه`, 409);
  const updated = await db.handoff.update({ where: { id }, data: { assignee: to.data, status: "open", claimedBy: null, claimedAt: null, claimNonce: null, leaseUntil: null } });
  await audit(actor, "handoff.reassign", { type: "handoff", id }, { before: { assignee: row.assignee }, after: { assignee: updated.assignee } });
  return (await views([updated]))[0]!;
}

/** The owner drops it: the run it held up is marked skipped (cancelled, so the agent is told to stop). Nothing is deleted. */
export async function cancelHandoff(id: string, actor: Actor, now = new Date()): Promise<HandoffView> {
  const row = await mustFind(id);
  if (!canMove(row.status as HandoffStatus, "cancelled")) throw new HandoffRefused(`هالتسليم ${STATUS_AR[row.status as HandoffStatus] ?? row.status}`, 409);
  const updated = await db.handoff.update({ where: { id }, data: { status: "cancelled", doneBy: actorKey(actor), doneAt: now } });
  await moveRun(updated, { status: "skipped", summary: "الغاها المالك" }, actor, now, { endReason: "cancelled" });
  await audit(actor, "handoff.cancel", { type: "handoff", id });
  return (await views([updated]))[0]!;
}
