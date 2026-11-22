/**
 * DECISIONS THAT WAIT FOR THE OWNER (v4 · A `request_approval` / `get_approvals`, C). Claude asks; the owner answers on
 * the site (or in the phone app, which is the same site); Claude reads the answer on its next run and acts.
 *
 * Four answers: موافق · رفض · أجّل (15 دقيقة / ساعة / الصبح) · ألغِ الطلب. Only the owner can give one, and only a session
 * can — never Telegram, never a token. A request that is not answered by its expiry expires; a postponed one comes back
 * by itself. Whether it RINGS depends on the switch (صاحي / نايم) and its urgency — src/core/mode.ts says how.
 */
import { z } from "zod";
import type { Approval } from "@prisma/client";
import { approvalCapabilityOf, expiryAfterPostpone } from "@/core/approval-rules";
import { can } from "@/core/roles";
import { nextRuns } from "@/core/cron";
import { deliveryFor, effectiveMode, type Delivery, type Urgency } from "@/core/mode";
import { refuseIfPrivate } from "@/core/push-rows";
import { isTerminalRun, runSteps } from "@/core/run-state";
import { GraphSchema } from "@/core/workflow";
import { sendTelegram, telegramFromEnv } from "@/adapters/telegram";
import { db } from "./db";
import { audit, type Actor } from "./audit";
import { createHandoff } from "./handoffs";
import { logRun } from "./workflows";
import { HttpError } from "./auth";
import { appOrigin } from "./env";
import { URGENCY_ICON } from "./notify";
import { getSetting } from "./settings";

const text = (max: number) => z.string().trim().min(1).max(max);
const NumberRow = z.object({ label: text(60), value: z.union([text(60), z.number().finite()]).transform((v) => String(v)) }).strict();
const Option = z.object({ key: text(30), label: text(60) }).strict();

export const ApprovalInput = z
  .object({
    ref: text(80).optional().describe("معرّف من عندك — إذا بعتّ نفس الطلب مرتين بيبقى طلب وحد"),
    title: text(160).describe("عنوان القرار"),
    why: text(400).describe("سطر واحد: ليش"),
    urgency: z.enum(["red", "orange", "yellow"]).describe("red بيرنّ · orange إشعار بصوت · yellow صامت"),
    kind: text(40).optional().describe("نوع القرار (مثلاً cap_raise) — المالك بيحدد أي أنواع بتصحّيه وهو نايم"),
    amount: z.number().nonnegative().max(1_000_000).optional().describe("المبلغ بالدولار إن وُجد"),
    numbers: z.array(NumberRow).max(12).optional().describe("الأرقام الأساسية: [{label, value}]"),
    options: z.array(Option).min(2).max(5).optional().describe("الخيارات [{key, label}] — الافتراضي موافق/رفض"),
    analysis: z
      .object({ text: text(2000).optional().describe("نص الرسالة اللي بتنبعت للفريق (لطلب send_message)"), decision: text(600).optional(), analysis: text(1500).optional(), if_yes: text(600).optional(), if_no: text(600).optional(), recommendation: text(600).optional() })
      .strict()
      .optional()
      .describe("صفحة «ليش؟»: القرار · التحليل · المآل إذا نعم/لا · التوصية"),
    expires_in_min: z.number().int().min(1).max(10_080).optional().describe("بعد كم دقيقة بينتهي الطلب لحاله"),
    workflow: text(60).optional().describe("مفتاح الورك فلو اللي طلبه"),
    run_ref: text(80).optional().describe("معرّف التشغيل (نفس ref لـ log_run) — القرار بيظهر على خطوته"),
    node_id: text(40).optional().describe("الخطوة اللي طلبت القرار (id من خطوات الورك فلو)"),
  })
  .strict();
export type ApprovalInputT = z.infer<typeof ApprovalInput>;

export interface ApprovalView {
  id: string;
  ref: string | null;
  title: string;
  why: string;
  analysis: ApprovalInputT["analysis"] | null;
  numbers: { label: string; value: string }[];
  options: { key: string; label: string }[];
  amount: number | null;
  urgency: Urgency;
  kind: string | null;
  status: string;
  source: string;
  workflowKey: string | null;
  runRef: string | null;
  nodeId: string | null;
  /** the agent carried the decision out (ack_approval) */
  actedAt: string | null;
  expiresAt: string | null;
  postponedUntil: string | null;
  chosenOption: string | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export function approvalView(a: Approval): ApprovalView {
  return {
    id: a.id,
    ref: a.ref,
    title: a.title,
    why: a.why,
    analysis: (a.analysis as ApprovalView["analysis"]) ?? null,
    numbers: (a.numbers as ApprovalView["numbers"]) ?? [],
    options: (a.options as ApprovalView["options"]) ?? [],
    amount: a.amount === null ? null : Number(a.amount),
    urgency: a.urgency as Urgency,
    kind: a.kind,
    status: a.status,
    source: a.source,
    workflowKey: a.workflowKey,
    runRef: a.runRef,
    nodeId: a.nodeId,
    actedAt: a.actedAt?.toISOString() ?? null,
    expiresAt: a.expiresAt?.toISOString() ?? null,
    postponedUntil: a.postponedUntil?.toISOString() ?? null,
    chosenOption: a.chosenOption,
    decisionNote: a.decisionNote,
    decidedBy: a.decidedBy,
    decidedAt: a.decidedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

export class Refused extends Error {}

const DEFAULT_OPTIONS = [{ key: "approve", label: "موافق" }, { key: "reject", label: "رفض" }];

/** Sends the request to the owner the way its urgency and his switch allow. Telegram only says «افتح الموقع». */
async function deliver(a: Approval, delivery: Delivery, now: Date): Promise<void> {
  if (delivery === "silent" || delivery === "queue") return;
  const tg = telegramFromEnv();
  if (tg) {
    try {
      const amount = a.amount !== null ? `\nالمبلغ: ${Number(a.amount)}$` : "";
      await sendTelegram(tg, `${URGENCY_ICON[a.urgency as Urgency]} بدي موافقتك: ${a.title}\n${a.why}${amount}\nللموافقة (من الموقع بس): ${appOrigin()}/inbox/${encodeURIComponent(`approval:${a.id}`)}`);
    } catch (e) {
      console.error("approval telegram failed:", e instanceof Error ? e.message : e);
    }
  }
  // the phone app's push (FCM) goes out from the worker, which reads `notifiedAt = null` approvals — see src/jobs/approvals.ts
  if (!tg) return;
  await db.approval.update({ where: { id: a.id }, data: { notifiedAt: now } });
}

/** Creates (or finds, by `ref`) a request for the owner's decision. Throws Refused when the text carries private data. */
export async function requestApproval(input: ApprovalInputT, actor: Actor, now = new Date()): Promise<{ approval: ApprovalView; created: boolean; delivery: Delivery | "already" }> {
  if (input.ref) {
    const found = await db.approval.findUnique({ where: { ref: input.ref } });
    if (found) return { approval: approvalView(found), created: false, delivery: "already" };
  }
  const refusal = refuseIfPrivate(input.title, input.why, input.kind, ...(input.numbers ?? []).flatMap((n) => [n.label, n.value]), ...(input.options ?? []).flatMap((o) => [o.key, o.label]), ...Object.values(input.analysis ?? {}));
  if (refusal) throw new Refused(refusal);

  const wakeKinds = (await getSetting("owner.wake_kinds")) as string[];
  const wakeOwner = !!input.kind && wakeKinds.includes(input.kind);
  const mode = effectiveMode(await getSetting("owner.mode"), now);
  const delivery = deliveryFor(input.urgency, mode, wakeOwner);
  const row = await db.approval.create({
    data: {
      ref: input.ref ?? null,
      title: input.title,
      why: input.why,
      analysis: input.analysis ?? undefined,
      numbers: input.numbers ?? undefined,
      options: input.options ?? DEFAULT_OPTIONS,
      amount: input.amount ?? null,
      urgency: input.urgency,
      kind: input.kind ?? null,
      source: actor.type === "agent" ? "mcp" : "user",
      workflowKey: input.workflow ?? null,
      runRef: input.run_ref ?? null,
      nodeId: input.node_id ?? null,
      expiresAt: input.expires_in_min ? new Date(now.getTime() + input.expires_in_min * 60_000) : null,
      wakeOwner,
    },
  });
  await audit(actor, "approval.request", { type: "approval", id: row.id }, { after: { title: row.title, urgency: row.urgency, amount: input.amount, delivery } });
  await deliver(row, delivery, now);
  return { approval: approvalView(row), created: true, delivery };
}

/**
 * Brings back what was postponed, then expires what ran out. Cheap: it is called whenever approvals are read. A postponed request does not end
 * while it sleeps (W-10): it comes back first, with its expiry moved past the moment it returns when that had already gone by.
 */
export async function refreshApprovals(now = new Date()): Promise<{ expired: number; woken: number }> {
  const due = await db.approval.findMany({ where: { status: "postponed", postponedUntil: { lte: now } } });
  const mode = effectiveMode(await getSetting("owner.mode"), now);
  let woken = 0;
  for (const a of due) {
    const expiresAt = expiryAfterPostpone({ expiresAt: a.expiresAt, createdAt: a.createdAt, until: now });
    const woke = await db.approval.updateMany({ where: { id: a.id, status: "postponed" }, data: { status: "pending", postponedUntil: null, notifiedAt: null, expiresAt } });
    if (woke.count) {
      woken += 1;
      await deliver({ ...a, status: "pending", notifiedAt: null, expiresAt }, deliveryFor(a.urgency as Urgency, mode, a.wakeOwner), now);
    }
  }
  // a postponed one that is still asleep is not expired (it ends after it has come back and nobody answered)
  const expired = await db.approval.updateMany({ where: { OR: [{ status: "pending" }, { status: "postponed", postponedUntil: null }], expiresAt: { lt: now } }, data: { status: "expired" } });
  return { expired: expired.count, woken };
}

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "postponed", "cancelled", "expired"] as const;

/**
 * What Claude reads: the open ones, and what was decided in the last 48 hours that it has not carried out yet (`ack_approval` marks one carried
 * out, and it is not offered again — W-06). A request by id or by status is read as it is, acked or not.
 */
export async function listApprovals(f: { status?: string[]; ids?: string[]; since?: Date; limit?: number } = {}, now = new Date()): Promise<ApprovalView[]> {
  await refreshApprovals(now);
  const since = f.since ?? new Date(now.getTime() - 48 * 3_600_000);
  const rows = await db.approval.findMany({
    where: f.ids?.length
      ? { id: { in: f.ids } }
      : f.status?.length
        ? { status: { in: f.status }, ...(f.since ? { updatedAt: { gte: f.since } } : {}) }
        : { OR: [{ status: { in: ["pending", "postponed"] } }, { updatedAt: { gte: since }, actedAt: null }] },
    orderBy: { createdAt: "desc" },
    take: Math.min(f.limit ?? 50, 200),
  });
  return rows.map(approvalView);
}

export const DecisionInput = z
  .object({
    action: z.enum(["approve", "reject", "postpone", "cancel"]),
    option: text(30).optional(),
    note: text(400).optional(),
    until: z.union([z.enum(["15m", "1h", "morning"]), z.string().datetime({ offset: true })]).optional(),
  })
  .strict();
export type DecisionInputT = z.infer<typeof DecisionInput>;

/** «الصبح» = the next time his awake hour comes round (his schedule, 10:00 until he sets another). */
export async function morningAfter(now: Date): Promise<Date> {
  const awake = (await getSetting("owner.mode")).schedule.awake;
  const [h, m] = awake.split(":").map(Number);
  return nextRuns(`${m} ${h} * * *`, now, 1)[0]!;
}

/** Who may answer a request (docs/rebuild-v6/01-model.md §8): decided from what it carries — see src/core/approval-rules.ts. */
export const approvalCapability = (a: Pick<Approval, "kind" | "amount" | "analysis">): "owner_only" | "ops.send" =>
  approvalCapabilityOf({ kind: a.kind, amount: a.amount === null ? null : Number(a.amount), analysis: (a.analysis as { text?: unknown } | null) ?? null });

/** The owner's answer. Throws HttpError (403 for anybody else, 409 when it is no longer open). */
export async function decideApproval(id: string, d: DecisionInputT, caller: { id: string; role: Parameters<typeof can>[0] }, now = new Date()): Promise<ApprovalView> {
  const found = await db.approval.findUnique({ where: { id } });
  if (!found) throw new HttpError(404, "الطلب مش موجود");
  // a message to the team is the operations manager's to approve; everything else (money, stock, anything Claude asks) is the owner's
  const need = approvalCapability(found);
  if (!can(caller.role, need)) throw new HttpError(403, need === "ops.send" ? "رسايل الفريق بتنوافق من مسؤول التشغيل أو المالك" : "القرار للمالك");
  await refreshApprovals(now);

  let until: Date | null = null;
  if (d.action === "postpone") {
    until = d.until === "15m" || !d.until ? new Date(now.getTime() + 15 * 60_000) : d.until === "1h" ? new Date(now.getTime() + 3_600_000) : d.until === "morning" ? await morningAfter(now) : new Date(d.until);
    if (until <= now) throw new HttpError(400, "وقت التأجيل لازم يكون بالمستقبل");
  }
  // it must not end while it sleeps: the expiry moves past the moment it comes back
  const expiresAt = until ? expiryAfterPostpone({ expiresAt: found.expiresAt, createdAt: found.createdAt, until }) : found.expiresAt;
  const status = { approve: "approved", reject: "rejected", postpone: "postponed", cancel: "cancelled" }[d.action];
  const done = await db.approval.updateMany({
    where: { id, status: { in: ["pending", "postponed"] } },
    data: { status, decidedBy: caller.id, decidedAt: now, decisionNote: d.note ?? null, chosenOption: d.option ?? (d.action === "approve" || d.action === "reject" ? d.action : null), postponedUntil: until, ...(until ? { expiresAt } : {}) },
  });
  if (!done.count) throw new HttpError(409, "الطلب مش مفتوح لهالقرار (انجاوب أو انتهى)");
  await audit({ type: "user", id: caller.id }, "approval.decide", { type: "approval", id }, { after: { action: d.action, option: d.option, until: until?.toISOString() } });
  const decided = await db.approval.findUniqueOrThrow({ where: { id } });
  await afterDecision(decided, caller.id, now);
  return approvalView(decided);
}

/**
 * A decision that came from a step of a run puts the run back on its way (§8): approved → the step goes on and a request «كمّل من الخطوة N» goes to
 * the job's agent; rejected → the step is set aside and the request is for the step after it. A run that has ended, a step the job no longer has,
 * or any other answer (postpone · cancel) changes nothing here. A failure here never undoes the decision.
 */
async function afterDecision(a: Approval, userId: string, now: Date): Promise<void> {
  if (!a.runRef || !a.nodeId || !a.workflowKey || (a.status !== "approved" && a.status !== "rejected")) return;
  try {
    const wf = await db.workflow.findUnique({ where: { key: a.workflowKey } });
    if (!wf) return;
    const run = await db.workflowRun.findUnique({ where: { workflowId_ref: { workflowId: wf.id, ref: a.runRef } } });
    if (!run || isTerminalRun(run.status)) return;
    const graph = GraphSchema.parse(wf.graph);
    const steps = runSteps(graph);
    const at = steps.findIndex((n) => n.id === a.nodeId);
    if (at === -1) return;
    const target = a.status === "approved" ? steps[at] : steps[at + 1];
    const actor = { type: "user" as const, id: userId };
    // the step moves with the run in the same write: «queued» (waiting for the agent) or, when nothing is left to ask, «ok» — never «waiting», which would turn the step back into a gate
    const nodeUpdate = { id: a.nodeId, status: (a.status === "approved" ? "running" : "skipped") as "running" | "skipped", note: a.status === "approved" ? "المالك وافق" : "المالك رفض" };
    await logRun({ job: wf.key, ref: a.runRef, status: target ? "queued" : "ok", node: nodeUpdate, ...(target ? {} : { summary: "المالك رفض آخر خطوة" }) }, actor, "ui", now, { site: true });
    if (target) await createHandoff({ workflow: wf.key, kind: "resume", node: target.id, title: `كمّل من الخطوة ${steps.indexOf(target) + 1}: ${target.label}`.slice(0, 160), run_ref: a.runRef }, actor, now);
  } catch (e) {
    console.error("approval resume failed:", e instanceof Error ? e.message : e);
  }
}

/** «نفّذت هالقرار»: the agent says it carried a decision out; it is not offered to it again. Only a decided one can be acked. */
export async function ackApproval(id: string, actor: Actor, now = new Date()): Promise<ApprovalView> {
  const found = await db.approval.findUnique({ where: { id } });
  if (!found) throw new Refused("الطلب مش موجود");
  if (found.status === "pending" || found.status === "postponed") throw new Refused("الطلب لسا ما انقرر — ما في شي تنفّذه");
  if (!found.actedAt) {
    await db.approval.updateMany({ where: { id, actedAt: null }, data: { actedAt: now } });
    await audit(actor, "approval.ack", { type: "approval", id }, { after: { status: found.status } });
  }
  return approvalView(await db.approval.findUniqueOrThrow({ where: { id } }));
}
