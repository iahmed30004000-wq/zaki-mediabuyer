/**
 * THE CHANGE SERVICE (spec 10.2) — the only path from a decision to Meta.
 *
 *   propose   → stored as draft, with one item per object and a unique idempotency key
 *   simulate  → caps, learning guard, conflicts, cooldown, money per day (nothing changes)
 *   decide    → by the account's EFFECTIVE autonomy level: auto (safety from level 1) · approval · owner · suggest
 *   approve   → a person with the right role, on the site (Telegram can only pause — spec 9.6)
 *   execute   → dry_run or live (src/meta/write.ts), then read back = verify
 *   rollback  → a new change with the inverse items; the original is marked rolled_back
 * The loop guard freezes an object whose direction flipped twice in 48 h, and sends the change to a person.
 */
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { audit, type Actor } from "./audit";
import { HttpError, type Caller } from "./auth";
import { can } from "@/core/roles";
import { effectiveLevel, modeFor, type ActionKind, type AutonomyLevel } from "@/core/autonomy";
import { accountRestricted } from "@/jobs/account-safety";
import { assertMove, directionOf, flipFlopped, simulate, spendDeltaDaily, type ChangeItemDraft, type ChangeState } from "@/core/changeset";
import { applyItem, writeMode } from "@/meta/write";
import { resolveRefs } from "@/core/templates";
import { MetaClient } from "@/meta/client";
import { metaToken } from "@/jobs/meta-sync";

export interface Proposal {
  source: "rule" | "agent" | "user" | "kill_switch" | "telegram";
  sourceRef?: string;
  reasonCode: string;
  sentence: string;
  kind: ActionKind;
  accountMetaId?: string | null;
  items: ChangeItemDraft[];
  cooldownHours?: number;
}

const SAFETY = new Set<ActionKind>(["safety_pause", "safety_reduce"]);
const json = (v: unknown) => v as Prisma.InputJsonValue;

const STATE_AR: Record<string, string> = { executed: "تنفّذ", rolled_back: "انرجع", rejected: "انرفض", failed: "فشل", pending_approval: "بانتظار الموافقة", simulated: "اقتراح", approved: "انوافق", executing: "عم يتنفّذ", draft: "مسودة" };

async function move(id: string, from: ChangeState, to: ChangeState, data: Prisma.ChangeSetUpdateInput = {}) {
  try {
    assertMove(from, to);
  } catch {
    throw new HttpError(409, `هالتغيير ${STATE_AR[from] ?? from} — ما بينفع هالخطوة عليه`);
  }
  return db.changeSet.update({ where: { id }, data: { ...data, state: to } });
}

async function tokenExpired(): Promise<boolean> {
  const c = await db.metaConnection.findFirst({ where: { status: { not: "revoked" } }, orderBy: { createdAt: "desc" } });
  return !!c && (c.status === "expired" || (!!c.expiresAt && c.expiresAt < new Date()));
}

async function simulationContext(p: Proposal) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const spent = await db.insightDaily.aggregate({ _sum: { spend: true }, where: { level: "ad", date: today } });
  const account = p.accountMetaId ? await db.adAccount.findUnique({ where: { metaId: p.accountMetaId } }) : null;
  const ids = p.items.map((i) => i.objectId);
  // a rolled-back change still happened: it counts for the learning guard and the loop guard
  const history = await db.changeItem.findMany({ where: { objectId: { in: ids }, changeSet: { state: { in: ["executed", "rolled_back"] } } }, include: { changeSet: true }, orderBy: { createdAt: "desc" } });
  const hoursSinceSignificant: Record<string, number> = {};
  for (const h of history) {
    if (hoursSinceSignificant[h.objectId] !== undefined) continue;
    if (h.op === "resume" || h.op === "set_budget") hoursSinceSignificant[h.objectId] = (Date.now() - (h.changeSet.executedAt ?? h.createdAt).getTime()) / 3_600_000;
  }
  const busy = await db.changeItem.findMany({ where: { objectId: { in: ids }, changeSet: { state: { in: ["pending_approval", "approved", "executing"] } } }, select: { objectId: true } });
  let hoursSinceRuleActed: number | undefined;
  if (p.source === "rule" && p.sourceRef) {
    const last = await db.ruleRun.findFirst({ where: { rule: p.sourceRef, targetId: { in: ids }, changeSetId: { not: null } }, orderBy: { createdAt: "desc" } });
    if (last) hoursSinceRuleActed = (Date.now() - last.createdAt.getTime()) / 3_600_000;
  }
  return {
    ctx: {
      plannedSpendToday: Number(spent._sum.spend ?? 0) * 1.01,
      dailyCap: account?.dailyCap ? Number(account.dailyCap) : null,
      hoursSinceSignificant,
      busyObjects: new Set(busy.map((b) => b.objectId)),
      hoursSinceRuleActed,
      cooldownHours: p.cooldownHours,
      safety: SAFETY.has(p.kind),
    },
    // a restricted account, a payment problem or an expired token: the account runs at level 0 (spec 10.1, T4.5)
    level: effectiveLevel((account?.autonomyLevel ?? 1) as AutonomyLevel, { accountHealthAlert: p.accountMetaId ? await accountRestricted(p.accountMetaId) : false, tokenExpired: await tokenExpired(), sourceDown: false, bigGap: false }).level,
    history,
  };
}

/** Propose, simulate and route a change. Returns the stored change set (executed already when the level allows it). */
export async function propose(p: Proposal, actor: Actor) {
  const { ctx, level, history } = await simulationContext(p);
  const sim = simulate(p.items, ctx);
  const created = await db.changeSet.create({
    data: {
      state: "draft",
      source: p.source,
      sourceRef: p.sourceRef ?? null,
      reasonCode: p.reasonCode,
      sentence: p.sentence,
      accountMetaId: p.accountMetaId ?? null,
      kind: p.kind,
      spendDeltaDaily: spendDeltaDaily(p.items),
      writeMode: writeMode(),
      items: { create: p.items.map((i, seq) => ({ seq, op: i.op, objectType: i.objectType, objectId: i.objectId, before: json(i.before), after: json(i.after), idempotencyKey: `${i.objectId}:${i.op}:${randomUUID()}` })) },
    },
  });
  await audit(actor, "change.propose", { type: "changeset", id: created.id }, { after: { kind: p.kind, items: p.items } });
  await move(created.id, "draft", "simulated", { simulation: json(sim) });

  // loop guard: the new direction on top of the last 48 h
  const now = new Date();
  for (const i of p.items) {
    const past = history.filter((h) => h.objectId === i.objectId).map((h) => ({ at: h.changeSet.executedAt ?? h.createdAt, direction: directionOf(h.op as ChangeItemDraft["op"], (h.before as { dailyBudget?: number }).dailyBudget, (h.after as { dailyBudget?: number }).dailyBudget) }));
    if (flipFlopped([...past, { at: now, direction: directionOf(i.op, i.before.dailyBudget, i.after.dailyBudget) }], now)) {
      await db.freeze.create({ data: { scope: i.objectType, targetId: i.objectId, kind: "all", reason: "انعكس القرار مرتين خلال 48 ساعة — بانتظار مراجعة المالك" } });
      return move(created.id, "simulated", "pending_approval", { error: "loop_guard" });
    }
  }

  const mode = modeFor(p.kind, level);
  if (mode === "suggest") return db.changeSet.findUniqueOrThrow({ where: { id: created.id } });
  // an agent only ever suggests: its changes wait for a person, whatever the level (spec 11.1)
  if (mode === "auto" && sim.ok && p.source !== "user" && p.source !== "agent") {
    await move(created.id, "simulated", "approved", { approvedBy: `level-${level}`, approvedAt: new Date() });
    return execute(created.id, actor);
  }
  if (p.source === "user" || p.source === "kill_switch" || p.source === "telegram") {
    // a person asked for it: safety goes through at once (kill switch, «اوقف»); anything that spends waits for approve()
    if (SAFETY.has(p.kind)) {
      await move(created.id, "simulated", "approved", { approvedBy: actor.id ?? p.source, approvedAt: new Date() });
      return execute(created.id, actor);
    }
  }
  return move(created.id, "simulated", "pending_approval");
}

/** Approve on the site. Telegram never reaches here (spec 3.13). */
export async function approve(id: string, caller: Caller) {
  const cs = await db.changeSet.findUniqueOrThrow({ where: { id } });
  const ownerOnly = ["above_cap", "test_campaign", "connect_asset", "customer_audience", "safety_net"].includes(cs.kind) || cs.error === "loop_guard";
  if (!can(caller.role, ownerOnly ? "owner_only" : "approve_within_cap")) throw new HttpError(403, ownerOnly ? "هالقرار بدو المالك" : "دورك ما بيسمح بالموافقة");
  const sim = cs.simulation as { ok?: boolean } | null;
  if (sim && sim.ok === false && !ownerOnly && Number(cs.spendDeltaDaily) > 0) throw new HttpError(409, "التجربة ما نجحت (سقف أو تعلّم أو تعارض) — شوف «جرّب»");
  await move(id, cs.state as ChangeState, "approved", { approvedBy: caller.id, approvedAt: new Date() });
  await audit({ type: "user", id: caller.id }, "change.approve", { type: "changeset", id });
  return execute(id, { type: "user", id: caller.id });
}

export async function reject(id: string, caller: Caller) {
  const cs = await db.changeSet.findUniqueOrThrow({ where: { id } });
  if (!can(caller.role, "propose_change")) throw new HttpError(403, "دورك ما بيسمح");
  await move(id, cs.state as ChangeState, "rejected");
  await audit({ type: "user", id: caller.id }, "change.reject", { type: "changeset", id });
  return db.changeSet.findUniqueOrThrow({ where: { id } });
}

async function metaClientIfLive() {
  if (writeMode() !== "live") return null;
  const token = await metaToken();
  return token ? new MetaClient({ token }) : null;
}

export async function execute(id: string, actor: Actor) {
  await move(id, "approved", "executing");
  const cs = await db.changeSet.findUniqueOrThrow({ where: { id }, include: { items: true } });
  const client = await metaClientIfLive();
  let allVerified = true;
  let mismatch = "";
  // a launch creates objects in order: the ids Meta gives are kept by ref and filled into the items after them
  const ids: Record<string, string> = {};
  for (const item of cs.items) {
    const ref = (item.after as { ref?: string }).ref;
    if (item.op === "create" && ref && item.apiResponse !== null) ids[ref] = item.objectId;
  }
  try {
    for (const item of [...cs.items].sort((a, b) => a.seq - b.seq)) {
      if (item.apiResponse !== null) continue; // already sent once: never twice
      const objectId = resolveRefs(item.objectId, ids);
      const draft: ChangeItemDraft = { op: item.op as ChangeItemDraft["op"], objectType: item.objectType as ChangeItemDraft["objectType"], objectId, before: item.before as ChangeItemDraft["before"], after: resolveRefs(item.after as ChangeItemDraft["after"], ids) };
      if (draft.op !== "create" && objectId.includes("{{ref:")) throw new Error(`ما انعرف رقم ${objectId} — العنصر اللي قبله ما انعمل`);
      const r = await applyItem(draft, cs.writeMode === "live" ? "live" : "dry_run", client);
      if (r.createdId && draft.after.ref) ids[draft.after.ref] = r.createdId;
      allVerified &&= r.verified;
      await db.changeItem.update({ where: { id: item.id }, data: { objectId: r.createdId ?? objectId, apiResponse: json(r.response), verifyResult: json({ verified: r.verified, readBack: r.readBack, mismatches: r.mismatches ?? [] }) } });
      // a created object that does not match its template: stop here — nothing after it is created or switched on
      if (!r.verified) {
        mismatch = (r.mismatches ?? []).map((m) => `${m.object}: ${m.sentence}`).join(" · ") || "القراءة بعد الكتابة ما طابقت";
        break;
      }
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await move(id, "executing", "failed", { error: error.slice(0, 1000) });
    await audit(actor, "change.failed", { type: "changeset", id }, { after: { error } });
    return db.changeSet.findUniqueOrThrow({ where: { id } });
  }
  await move(id, "executing", allVerified ? "executed" : "failed", { executedAt: new Date(), verifiedAt: allVerified ? new Date() : null, error: allVerified ? null : `verify_mismatch: ${mismatch}`.slice(0, 1000) });
  await audit(actor, "change.execute", { type: "changeset", id }, { after: { writeMode: cs.writeMode, verified: allVerified } });
  if (cs.kind === "test_campaign" && allVerified) {
    // the launch is on: its test starts counting days now
    const days = await db.experiment.findFirst({ where: { changeSetId: id }, select: { stopRules: true } });
    const maxDays = (days?.stopRules as { maxDays?: number } | null)?.maxDays ?? 7;
    await db.experiment.updateMany({ where: { changeSetId: id, status: "planned" }, data: { status: "running", campaignMetaId: ids.campaign ?? null, startedAt: new Date(), endsAt: new Date(Date.now() + maxDays * 86_400_000) } });
  }
  return db.changeSet.findUniqueOrThrow({ where: { id } });
}

/** «رجّع»: a new change with the inverse items, executed for the person who asked; the original becomes rolled_back. */
export async function rollback(id: string, caller: Caller) {
  if (!can(caller.role, "pause_or_reduce")) throw new HttpError(403, "دورك ما بيسمح بالرجوع");
  const cs = await db.changeSet.findUniqueOrThrow({ where: { id }, include: { items: true } });
  if (cs.state !== "executed") throw new HttpError(409, "بس التغيير المنفّذ بينرجع");
  // a launch is undone by pausing what it made (never deleting): the switches first, then the created objects
  const inverse: ChangeItemDraft[] = [...cs.items].sort((a, b) => b.seq - a.seq).flatMap((i): ChangeItemDraft[] => {
    const before = i.before as ChangeItemDraft["before"];
    const after = i.after as ChangeItemDraft["after"];
    const objectType = i.objectType as ChangeItemDraft["objectType"];
    if (i.op === "create") return objectType === "creative" ? [] : [{ op: "pause", objectType, objectId: i.objectId, before: { status: "ACTIVE", dailyBudget: after.dailyBudget }, after: { status: "PAUSED" } }];
    // the account cap goes back to what it was (never with a second reset of what was spent)
    if (i.op === "set_account_cap") return [{ op: "set_account_cap", objectType, objectId: i.objectId, before: { spendCap: after.spendCap }, after: { spendCap: before.spendCap ?? 0, reset: false } }];
    return [{ op: i.op === "pause" ? "resume" : i.op === "resume" ? "pause" : "set_budget", objectType, objectId: i.objectId, before: after, after: before }];
  }).filter((x, n, all) => all.findIndex((y) => y.objectId === x.objectId) === n);
  const back = await db.changeSet.create({
    data: {
      state: "approved",
      source: "user",
      sourceRef: caller.id,
      reasonCode: "S11",
      sentence: `رجوع عن: ${cs.sentence}`,
      accountMetaId: cs.accountMetaId,
      kind: cs.kind,
      spendDeltaDaily: spendDeltaDaily(inverse),
      writeMode: writeMode(),
      approvedBy: caller.id,
      approvedAt: new Date(),
      items: { create: inverse.map((i, seq) => ({ seq, op: i.op, objectType: i.objectType, objectId: i.objectId, before: json(i.before), after: json(i.after), idempotencyKey: `${i.objectId}:${i.op}:${randomUUID()}` })) },
    },
  });
  const done = await execute(back.id, { type: "user", id: caller.id });
  if (done.state === "executed") {
    await move(id, "executed", "rolled_back", { rolledBackAt: new Date(), rolledBackBy: caller.id });
    // undoing a launch ends its test: what was made is paused, nothing is judged on it any more
    if (cs.kind === "test_campaign") await db.experiment.updateMany({ where: { changeSetId: id, status: { in: ["planned", "running"] } }, data: { status: "stopped", verdict: "انوقف بـ «رجّع» — الحملة موقّفة" } });
  }
  await audit({ type: "user", id: caller.id }, "change.rollback", { type: "changeset", id }, { after: { by: back.id } });
  return done;
}

/** The full stop (spec 10.3): every active campaign of one account, or of all, paused at once, logged. */
export async function killSwitch(scope: string, caller: Caller) {
  if (!can(caller.role, "kill_switch")) throw new HttpError(403, "دورك ما بيسمح بالإيقاف الكامل");
  const campaigns = await db.campaign.findMany({ where: { status: { notIn: ["PAUSED", "ARCHIVED", "DELETED"] }, ...(scope === "all" ? {} : { account: { metaId: scope } }) }, include: { account: true } });
  if (!campaigns.length) {
    await db.killSwitchEvent.create({ data: { scope, byUser: caller.id, objects: 0 } });
    return { changeSetId: null, objects: 0 };
  }
  const cs = await propose(
    {
      source: "kill_switch",
      sourceRef: caller.id,
      reasonCode: "S11",
      sentence: `إيقاف كامل (${scope === "all" ? "كل الحسابات" : scope}): ${campaigns.length} حملة.`,
      kind: "safety_pause",
      accountMetaId: scope === "all" ? null : scope,
      items: campaigns.map((c) => ({ op: "pause", objectType: "campaign", objectId: c.metaId, before: { status: c.status, dailyBudget: c.dailyBudget ? Number(c.dailyBudget) : undefined }, after: { status: "PAUSED" } })),
    },
    { type: "user", id: caller.id },
  );
  await db.killSwitchEvent.create({ data: { scope, byUser: caller.id, changeSetId: cs.id, objects: campaigns.length } });
  return { changeSetId: cs.id, objects: campaigns.length, state: cs.state };
}
