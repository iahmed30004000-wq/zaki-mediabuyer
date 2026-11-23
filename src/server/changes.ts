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
import { assertMove, directionOf, flipFlopped, isSignificant, simulate, spendDeltaDaily, type ChangeItemDraft, type ChangeState } from "@/core/changeset";
import { plannedDaily } from "@/core/rulebook";
import { applyItem, writeMode } from "@/meta/write";
import { metaWriteGate } from "@/core/readiness";
import { resolveRefs } from "@/core/templates";
import { MetaClient } from "@/meta/client";
import { readCampaigns } from "@/meta/read";
import { metaToken } from "@/jobs/meta-sync";
import { stopResult, type StopResult } from "@/core/stop-result";

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
  // compare-and-set: the row moves only if it is STILL in `from`. Two approvals at the same moment (a double click, two people) cannot both pass: the second finds 0 rows and stops.
  const moved = await db.changeSet.updateMany({ where: { id, state: from }, data: { ...data, state: to } });
  if (moved.count !== 1) throw new HttpError(409, "هالتغيير انتقل لحالة تانية قبل لحظة — حدّث الصفحة");
  return db.changeSet.findUniqueOrThrow({ where: { id } });
}

/** The kinds only the owner decides (and rolls back), and a change the loop guard froze. */
const OWNER_ONLY_KINDS = ["above_cap", "test_campaign", "connect_asset", "customer_audience", "safety_net"];
const isOwnerOnly = (cs: { kind: string; error: string | null }) => OWNER_ONLY_KINDS.includes(cs.kind) || cs.error === "loop_guard";

async function tokenExpired(): Promise<boolean> {
  const c = await db.metaConnection.findFirst({ where: { status: { not: "revoked" } }, orderBy: { createdAt: "desc" } });
  return !!c && (c.status === "expired" || (!!c.expiresAt && c.expiresAt < new Date()));
}

/**
 * What an account plans to spend per day: every active ad set budget and campaign budget it has now, plus the raises already waiting or
 * running (so two raises that each fit alone are not both let through). Null when the account is unknown — the cap check then fails closed.
 */
export async function plannedDailyOf(accountMetaId: string | null | undefined, excludeId?: string): Promise<number | null> {
  if (!accountMetaId) return null;
  const account = await db.adAccount.findUnique({ where: { metaId: accountMetaId }, include: { campaigns: { include: { adsets: true } } } });
  if (!account) return null;
  const base = plannedDaily(account.campaigns.map((c) => ({ status: c.status, dailyBudget: c.dailyBudget ? Number(c.dailyBudget) : null, adsets: c.adsets.map((x) => ({ status: x.status, dailyBudget: x.dailyBudget ? Number(x.dailyBudget) : null })) })));
  const waiting = await db.changeSet.findMany({ where: { accountMetaId, state: { in: ["pending_approval", "approved", "executing"] }, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { spendDeltaDaily: true } });
  return Math.round((base + waiting.reduce((n, w) => n + Math.max(0, Number(w.spendDeltaDaily)), 0)) * 100) / 100;
}

async function simulationContext(p: Proposal, excludeId?: string) {
  const account = p.accountMetaId ? await db.adAccount.findUnique({ where: { metaId: p.accountMetaId } }) : null;
  const ids = p.items.map((i) => i.objectId);
  // a rolled-back change still happened: it counts for the learning guard and the loop guard
  const history = await db.changeItem.findMany({ where: { objectId: { in: ids }, changeSet: { state: { in: ["executed", "rolled_back"] } } }, include: { changeSet: true }, orderBy: { createdAt: "desc" } });
  const hoursSinceSignificant: Record<string, number> = {};
  for (const h of history) {
    if (hoursSinceSignificant[h.objectId] !== undefined) continue;
    // only a change Meta counts as significant restarts the learning clock: a +20% step does not (R-18)
    if (h.op === "resume" || (h.op === "set_budget" && isSignificant({ op: "set_budget", objectType: "adset", objectId: h.objectId, before: h.before as ChangeItemDraft["before"], after: h.after as ChangeItemDraft["after"] }))) hoursSinceSignificant[h.objectId] = (Date.now() - (h.changeSet.executedAt ?? h.createdAt).getTime()) / 3_600_000;
  }
  const busy = await db.changeItem.findMany({ where: { objectId: { in: ids }, changeSet: { state: { in: ["pending_approval", "approved", "executing"] }, ...(excludeId ? { id: { not: excludeId } } : {}) } }, select: { objectId: true } });
  let hoursSinceRuleActed: number | undefined;
  if (p.source === "rule" && p.sourceRef) {
    const last = await db.ruleRun.findFirst({ where: { rule: p.sourceRef, targetId: { in: ids }, changeSetId: { not: null } }, orderBy: { createdAt: "desc" } });
    if (last) hoursSinceRuleActed = (Date.now() - last.createdAt.getTime()) / 3_600_000;
  }
  return {
    ctx: {
      plannedDaily: await plannedDailyOf(p.accountMetaId, excludeId),
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

  // a person asked for a safety stop (kill switch, «اوقف», a pause by hand): it goes through at once — BEFORE the account's level is looked at.
  // A level-0 account (restricted, a payment problem, an expired token) must still be stoppable: a stop only ever lowers spend.
  if ((p.source === "user" || p.source === "kill_switch" || p.source === "telegram") && SAFETY.has(p.kind)) {
    await move(created.id, "simulated", "approved", { approvedBy: actor.id ?? p.source, approvedAt: new Date() });
    return execute(created.id, actor);
  }
  const mode = modeFor(p.kind, level);
  if (mode === "suggest") return db.changeSet.findUniqueOrThrow({ where: { id: created.id } });
  // an agent only ever suggests: its changes wait for a person, whatever the level (spec 11.1)
  if (mode === "auto" && sim.ok && p.source !== "user" && p.source !== "agent") {
    await move(created.id, "simulated", "approved", { approvedBy: `level-${level}`, approvedAt: new Date() });
    return execute(created.id, actor);
  }
  // anything that spends waits for approve()
  return move(created.id, "simulated", "pending_approval");
}

/** The trial of a stored change, run again on today's numbers; the stored simulation is replaced by it. */
async function resimulate(cs: { id: string; source: string; sourceRef: string | null; reasonCode: string; sentence: string; kind: string; accountMetaId: string | null; items: { seq: number; op: string; objectType: string; objectId: string; before: unknown; after: unknown }[] }) {
  const items: ChangeItemDraft[] = [...cs.items].sort((a, b) => a.seq - b.seq).map((i) => ({ op: i.op as ChangeItemDraft["op"], objectType: i.objectType as ChangeItemDraft["objectType"], objectId: i.objectId, before: i.before as ChangeItemDraft["before"], after: i.after as ChangeItemDraft["after"] }));
  const { ctx } = await simulationContext({ source: cs.source as Proposal["source"], sourceRef: cs.sourceRef ?? undefined, reasonCode: cs.reasonCode, sentence: cs.sentence, kind: cs.kind as ActionKind, accountMetaId: cs.accountMetaId, items }, cs.id);
  const sim = simulate(items, ctx);
  await db.changeSet.updateMany({ where: { id: cs.id }, data: { simulation: json(sim) } });
  return sim;
}

/** Approve on the site. Telegram never reaches here (spec 3.13). */
export async function approve(id: string, caller: Caller) {
  const cs = await db.changeSet.findUniqueOrThrow({ where: { id }, include: { items: true } });
  const ownerOnly = isOwnerOnly(cs);
  if (!can(caller.role, ownerOnly ? "owner_only" : "ads.approve_within_cap")) throw new HttpError(403, ownerOnly ? "هالقرار بدو المالك" : "دورك ما بيسمح بالموافقة");
  // the trial is read again NOW — what it said when the change was proposed may not be true any more (budgets moved, other raises came in)
  const fresh = await resimulate(cs);
  if (!fresh.ok && !ownerOnly && Number(cs.spendDeltaDaily) > 0) throw new HttpError(409, `التجربة ما نجحت هلق (سقف أو تعلّم أو تعارض): ${fresh.checks.filter((c) => !c.ok).map((c) => c.note).join(" · ")}`);
  await move(id, cs.state as ChangeState, "approved", { approvedBy: caller.id, approvedAt: new Date() });
  await audit({ type: "user", id: caller.id }, "change.approve", { type: "changeset", id });
  return execute(id, { type: "user", id: caller.id });
}

export async function reject(id: string, caller: Caller) {
  const cs = await db.changeSet.findUniqueOrThrow({ where: { id } });
  if (!can(caller.role, "ads.propose")) throw new HttpError(403, "دورك ما بيسمح");
  await move(id, cs.state as ChangeState, "rejected");
  await audit({ type: "user", id: caller.id }, "change.reject", { type: "changeset", id });
  return db.changeSet.findUniqueOrThrow({ where: { id } });
}

/** Campaigns Meta says are running that the site's copy does not list (live only; a failed read is never a reason not to stop what we know). */
async function liveOnly(scope: string, known: Set<string>): Promise<{ metaId: string; status: string; dailyBudget: null; account: { metaId: string } }[]> {
  const client = await metaClientIfLive();
  if (!client) return [];
  try {
    const accounts = scope === "all" ? (await db.adAccount.findMany({ select: { metaId: true } })).map((a) => a.metaId) : [scope];
    const out: { metaId: string; status: string; dailyBudget: null; account: { metaId: string } }[] = [];
    for (const a of accounts) {
      for (const c of await readCampaigns(client, a)) {
        const status = String(c.effective_status);
        if (!/PAUSED|ARCHIVED|DELETED/.test(status) && !known.has(String(c.id))) out.push({ metaId: String(c.id), status, dailyBudget: null, account: { metaId: a } });
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function metaClientIfLive() {
  if (writeMode() !== "live") return null;
  const token = await metaToken();
  return token ? new MetaClient({ token }) : null;
}

/** The site's copy of an object, brought to what a verified live write left on Meta (never for a trial). */
async function mirrorWrite(i: ChangeItemDraft): Promise<void> {
  if (i.op === "create" || i.op === "set_account_cap" || i.objectType === "rule" || i.objectType === "account" || i.objectType === "creative") return;
  const data = i.op === "set_budget" ? { dailyBudget: i.after.dailyBudget } : { status: i.op === "pause" ? "PAUSED" : "ACTIVE" };
  if (i.objectType === "campaign") await db.campaign.updateMany({ where: { metaId: i.objectId }, data });
  else if (i.objectType === "adset") await db.adSet.updateMany({ where: { metaId: i.objectId }, data: { ...data, ...(isSignificant(i) ? { lastSignificantEditAt: new Date() } : {}) } });
  else if (i.objectType === "ad" && i.op !== "set_budget") await db.ad.updateMany({ where: { metaId: i.objectId }, data });
}

export async function execute(id: string, actor: Actor) {
  await move(id, "approved", "executing");
  const cs = await db.changeSet.findUniqueOrThrow({ where: { id }, include: { items: true } });
  const client = await metaClientIfLive();
  let allVerified = true;
  let mismatch = "";
  // R-05: a stop or a cut keeps going when one item fails and answers per item; a launch (a chain of creates) still stops at the first problem
  const keepGoing = SAFETY.has(cs.kind as ActionKind);
  // a live write was asked for but is not allowed yet (no META_LIVE_VERIFIED, no token): the change FAILS with the sentence — it is not run as a quiet dry-run
  const gate = metaWriteGate(process.env, !!(await metaToken()));
  // a launch creates objects in order: the ids Meta gives are kept by ref and filled into the items after them
  const ids: Record<string, string> = {};
  for (const item of cs.items) {
    const ref = (item.after as { ref?: string }).ref;
    if (item.op === "create" && ref && item.apiResponse !== null) ids[ref] = item.objectId;
  }
  try {
    if (gate.error) throw new Error(gate.error);
    for (const item of [...cs.items].sort((a, b) => a.seq - b.seq)) {
      if (item.apiResponse !== null) continue; // already sent once: never twice
      const objectId = resolveRefs(item.objectId, ids);
      try {
        const draft: ChangeItemDraft = { op: item.op as ChangeItemDraft["op"], objectType: item.objectType as ChangeItemDraft["objectType"], objectId, before: item.before as ChangeItemDraft["before"], after: resolveRefs(item.after as ChangeItemDraft["after"], ids) };
        if (draft.op !== "create" && objectId.includes("{{ref:")) throw new Error(`ما انعرف رقم ${objectId} — العنصر اللي قبله ما انعمل`);
        const r = await applyItem(draft, cs.writeMode === "live" ? "live" : "dry_run", client);
        if (r.createdId && draft.after.ref) ids[draft.after.ref] = r.createdId;
        allVerified &&= r.verified;
        // what Meta just confirmed by reading it back is written into the site's copy at once: the next decision (and the cap) must not wait for the next sync
        if (r.verified && cs.writeMode === "live") await mirrorWrite(draft).catch(() => undefined);
        const why = r.verified ? null : (r.mismatches ?? []).map((m) => `${m.object}: ${m.sentence}`).join(" · ") || "القراءة بعد الكتابة ما طابقت";
        await db.changeItem.update({ where: { id: item.id }, data: { objectId: r.createdId ?? objectId, apiResponse: json(r.response), verifyResult: json({ verified: r.verified, readBack: r.readBack, mismatches: r.mismatches ?? [], ...(why ? { error: why.slice(0, 300) } : {}) }) } });
        if (!r.verified) {
          mismatch ||= why ?? "";
          // a created object that does not match its template: stop here — nothing after it is created or switched on
          if (!keepGoing) break;
        }
      } catch (e) {
        if (!keepGoing) throw e;
        // a stop or a cut goes on past a campaign that fails (deleted on Meta, a refused call): the others still get paused, and this one's answer is kept
        const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
        allVerified = false;
        mismatch ||= error;
        await db.changeItem.update({ where: { id: item.id }, data: { verifyResult: json({ verified: false, error }) } });
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
  // the approved inverse of a rollback that raised spend: the original is rolled back once its inverse really ran
  if (allVerified && cs.sourceRef?.startsWith("rollback:")) await db.changeSet.updateMany({ where: { id: cs.sourceRef.slice("rollback:".length), state: "executed" }, data: { state: "rolled_back", rolledBackAt: new Date(), rolledBackBy: cs.approvedBy } });
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
  if (!can(caller.role, "ads.pause")) throw new HttpError(403, "دورك ما بيسمح بالرجوع");
  const cs = await db.changeSet.findUniqueOrThrow({ where: { id }, include: { items: true } });
  if (cs.state !== "executed") throw new HttpError(409, "بس التغيير المنفّذ بينرجع");
  // the same rule as approve(): what only the owner may decide, only the owner may undo (the account cap, a launch…)
  if (isOwnerOnly(cs) && !can(caller.role, "owner_only")) throw new HttpError(403, "هالقرار بدو المالك");
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
  // an inverse that RAISES spend (un-pausing, restoring a bigger budget) is a new decision, not an undo: it goes through the caps and the learning guard and waits for approval like any other
  if (spendDeltaDaily(inverse) > 0) {
    const kind: ActionKind = inverse.every((i) => i.op === "resume") ? "resume" : "raise_step";
    const proposed = await propose({ source: "user", sourceRef: `rollback:${id}`, reasonCode: "S11", sentence: `رجوع عن: ${cs.sentence}`, kind, accountMetaId: cs.accountMetaId, items: inverse }, { type: "user", id: caller.id });
    await audit({ type: "user", id: caller.id }, "change.rollback", { type: "changeset", id }, { after: { proposed: proposed.id, state: proposed.state } });
    return proposed;
  }
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

/**
 * The full stop (spec 10.3): every active campaign of one account, or of all, paused at once, logged.
 * It answers with what REALLY happened per campaign (R-04): the screen says one of four sentences from this, never a made-up «انوقف».
 */
export async function killSwitch(scope: string, caller: Caller): Promise<StopResult> {
  if (!can(caller.role, "ads.pause")) throw new HttpError(403, "دورك ما بيسمح بالإيقاف الكامل");
  const mirror = await db.campaign.findMany({ where: { status: { notIn: ["PAUSED", "ARCHIVED", "DELETED"] }, ...(scope === "all" ? {} : { account: { metaId: scope } }) }, include: { account: true } });
  // the stop must not trust the site's copy alone: live, it also asks Meta what is running
  const campaigns = [...mirror, ...(await liveOnly(scope, new Set(mirror.map((c) => c.metaId))))];
  if (!campaigns.length) {
    await db.killSwitchEvent.create({ data: { scope, byUser: caller.id, objects: 0 } });
    return stopResult({ objects: 0, changeSetId: null, csState: "none", writeMode: "dry_run", csError: null, items: [] });
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
  const full = await db.changeSet.findUniqueOrThrow({ where: { id: cs.id }, include: { items: true } });
  return stopResult({ objects: campaigns.length, changeSetId: cs.id, csState: full.state, writeMode: full.writeMode, csError: full.error, items: full.items });
}
