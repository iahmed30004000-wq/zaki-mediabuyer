/**
 * THE WATCHDOG (docs/rebuild-v6/01-model.md §5 · §6). Once a minute, inside the worker: take a snapshot of the jobs, the runs that matter, the open
 * requests and the owner's decisions, ask `watchPlan` (pure, src/core/watch-plan.ts) what is due, and carry it out. This is the site's one clock: it
 * asks for the runs of the jobs it wakes (`wake = site | site_run`), writes «فاتت» for a slot nothing answered, closes a run that went silent as
 * «انقطعت», and says so — one `Notification` row per event, through `emit` (sending is the dispatcher's, from P7).
 *
 * Every action is a conditional write on the state it saw, so a second worker, a restart or two passes at once cannot do anything twice; the pass itself
 * runs under an advisory lock so only one worker plans at a time, and there is no row per minute (N-14): the only thing written when nothing is due is
 * the heartbeat (`Setting watchdog.tick`, one row, updated in place).
 */
import { WATCH_LOOKBACK_H, countActions, watchPlan, type WatchAction, type WatchSnapshot } from "@/core/watch-plan";
import { slotRef } from "@/core/slot-for";
import { queueAssignee } from "@/core/handoff";
import { WATCHDOG_SINCE_KEY, WATCHDOG_TICK_KEY } from "@/core/health";
import type { NodeStates } from "@/core/workflow";
import type { Prisma } from "@prisma/client";
import { audit, type Actor } from "@/server/audit";
import { db } from "@/server/db";
import { emit } from "@/server/events";
import { HandoffRefused, createHandoff, expireHandoff } from "@/server/handoffs";
import { ExecRefused, executeWorkflow, realDeps } from "@/server/step-exec";
import { logRun } from "@/server/workflows";

export { watchPlan };

export { WATCHDOG_SINCE_KEY, WATCHDOG_TICK_KEY };

const ACTOR: Actor = { type: "system", id: "watchdog" };
const clockOf = (v: unknown): Date | null => {
  const at = (v as { at?: unknown } | null)?.at;
  const d = typeof at === "string" ? new Date(at) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/** The first time the watchdog ever ran: written once, then never moved — so nothing before it is ever «فات». */
async function readSince(now: Date): Promise<Date> {
  const row = await db.setting.findUnique({ where: { key: WATCHDOG_SINCE_KEY } });
  const at = clockOf(row?.value);
  if (at) return at;
  await db.setting.upsert({ where: { key: WATCHDOG_SINCE_KEY }, create: { key: WATCHDOG_SINCE_KEY, value: { at: now.toISOString() } }, update: {} });
  return now;
}

/** What the plan needs, in a fixed number of queries: the jobs, the runs that matter, the open requests, the decisions that ran out. */
export async function loadSnapshot(now: Date): Promise<WatchSnapshot> {
  const since = await readSince(now);
  const wfs = await db.workflow.findMany({ where: { archivedAt: null } });
  const ids = new Map(wfs.map((w) => [w.id, w.key]));
  const recent = new Date(now.getTime() - (WATCH_LOOKBACK_H + 2) * 3_600_000);
  const onceIds = wfs.filter((w) => w.kind === "once" && !w.finishedAt && w.enabled).map((w) => w.id);
  const [live, ranOnce, handoffs, approvals] = await Promise.all([
    db.workflowRun.findMany({ where: { workflowId: { in: [...ids.keys()] }, OR: [{ status: { in: ["queued", "running", "waiting"] } }, { startedAt: { gte: recent } }, { scheduledFor: { gte: recent } }] }, orderBy: { startedAt: "desc" }, take: 2000 }),
    onceIds.length ? db.workflowRun.findMany({ where: { workflowId: { in: onceIds }, status: "ok" }, take: 200 }) : Promise.resolve([]),
    db.handoff.findMany({ where: { status: { in: ["open", "claimed"] } }, take: 500 }),
    db.approval.findMany({ where: { status: { in: ["pending", "postponed"] }, expiresAt: { lt: now } }, take: 200 }),
  ]);
  const seen = new Set<string>();
  const runs = [...live, ...ranOnce]
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), ids.has(r.workflowId))))
    .map((r) => ({ id: r.id, jobKey: ids.get(r.workflowId)!, ref: r.ref, status: r.status, trigger: r.trigger, scheduledFor: r.scheduledFor, startedAt: r.startedAt, heartbeatAt: r.heartbeatAt, updatedAt: r.updatedAt }));
  return {
    since,
    jobs: wfs.map((w) => ({ key: w.key, kind: w.kind, schedule: w.schedule, runsAt: w.runsAt, endsAt: w.endsAt, graceMin: w.graceMin, enabled: w.enabled, archivedAt: w.archivedAt, finishedAt: w.finishedAt, mergedInto: w.mergedInto, permission: w.permission, wake: w.wake, maxRunMin: w.maxRunMin, createdAt: w.createdAt, scheduleChangedAt: w.scheduleChangedAt })),
    runs,
    handoffs: handoffs.map((h) => ({ id: h.id, workflowKey: h.workflowKey, runRef: h.runRef, status: h.status, expiresAt: h.expiresAt, leaseUntil: h.leaseUntil })),
    approvals: approvals.map((a) => ({ id: a.id, status: a.status, expiresAt: a.expiresAt, postponedUntil: a.postponedUntil })),
  };
}

export interface WatchResult {
  /** how many of each kind were carried out */
  applied: Record<string, number>;
  /** actions that found nothing left to do (somebody else did it first) or that were refused */
  skipped: number;
  errors: string[];
}

const hhmm = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Amman", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

async function whoIs(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  const a = await db.actor.findUnique({ where: { key } });
  return a?.name ?? key;
}

type Wf = NonNullable<Awaited<ReturnType<typeof db.workflow.findUnique>>>;

/** A run the site writes as ended without the agent's word (missed · lost): through `logRun`, the one writer of runs. */
async function writeMissed(wf: Wf, slot: Date, now: Date) {
  const ref = slotRef(slot);
  return logRun(
    { job: wf.key, ref, status: "missed", trigger: "schedule", started_at: slot.toISOString(), scheduled_for: slot.toISOString(), summary: "فاتت: ما وصل أي تسجيل" },
    ACTOR,
    "worker",
    now,
    { site: true, endReason: "missed" },
  );
}

/** Carries out the plan. Each action is attempted alone: a failure of one is told and the rest still go. */
export async function applyWatch(actions: readonly WatchAction[], now: Date): Promise<WatchResult> {
  const res: WatchResult = { applied: {}, skipped: 0, errors: [] };
  const done = (type: string) => (res.applied[type] = (res.applied[type] ?? 0) + 1);
  const skip = () => void res.skipped++;

  for (const a of actions) {
    try {
      switch (a.type) {
        case "fire": {
          const wf = await db.workflow.findUnique({ where: { key: a.jobKey } });
          if (!wf || !wf.enabled || wf.archivedAt || wf.wake === "self") { skip(); continue; }
          const slot = new Date(a.slot);
          const ref = slotRef(slot);
          if (await db.workflowRun.findUnique({ where: { workflowId_ref: { workflowId: wf.id, ref } }, select: { id: true } })) { skip(); continue; }
          if (wf.wake === "site_run") {
            try {
              const r = await executeWorkflow(wf.key, ACTOR, realDeps(), { ref, scheduledFor: slot, trigger: "schedule" });
              await audit(ACTOR, "workflow.scheduled", { type: "workflow", id: wf.key }, { after: { slot: a.slot, how: "site", status: r.status } });
              done("fire");
              break;
            } catch (e) {
              // no step the site may run: it asks the agent instead, the same as a press of «شغّلها هلأ». Anything else is just said.
              if (!(e instanceof ExecRefused && e.status === 400)) throw e;
            }
          }
          const h = await createHandoff({ workflow: wf.key, kind: "manual_run", title: `شغّل «${wf.name}» — موعدها ${hhmm(slot)}`.slice(0, 160), run_ref: ref, assignee: queueAssignee(wf.assigneeKey) }, ACTOR, now, { scheduledFor: slot, trigger: "schedule" });
          await audit(ACTOR, "workflow.scheduled", { type: "workflow", id: wf.key }, { after: { slot: a.slot, how: "agent", handoff: h.handoff.id } });
          done("fire");
          break;
        }
        case "miss": {
          const wf = await db.workflow.findUnique({ where: { key: a.jobKey } });
          if (!wf) { skip(); continue; }
          const slot = new Date(a.slot);
          if (await db.workflowRun.findUnique({ where: { workflowId_ref: { workflowId: wf.id, ref: slotRef(slot) } }, select: { id: true } })) { skip(); continue; }
          const r = await writeMissed(wf, slot, now);
          await audit(ACTOR, "workflow.missed", { type: "workflow", id: wf.key }, { after: { slot: a.slot, run: r.run.id } });
          await emit({ kind: "run.missed", runId: r.run.id, jobKey: wf.key, jobName: wf.name, scheduledFor: slot, who: await whoIs(wf.assigneeKey) }, wf.notifyOn);
          done("miss");
          break;
        }
        case "lose": {
          const run = await db.workflowRun.findUnique({ where: { id: a.runId } });
          const wf = run ? await db.workflow.findFirst({ where: { id: run.workflowId } }) : null;
          if (!run || !wf) { skip(); continue; }
          const cut = new Date(now.getTime() - wf.maxRunMin * 60_000);
          // a job the site itself runs has nobody to wait for: it failed; one an agent runs is «انقطعت»
          const lost = wf.wake !== "site_run";
          const r = await db.workflowRun.updateMany({
            where: { id: run.id, status: "running", OR: [{ heartbeatAt: { lt: cut } }, { heartbeatAt: null, startedAt: { lt: cut } }] },
            data: { status: lost ? "lost" : "failed", endReason: lost ? "lost" : "error", finishedAt: now },
          });
          if (!r.count) { skip(); continue; }
          const who = (await whoIs(run.doneBy ?? wf.assigneeKey)) ?? "المنفّذ";
          const states = ((run.nodeStates as unknown as NodeStates) ?? {}) as NodeStates;
          const next: NodeStates = { ...states };
          for (const [id, s] of Object.entries(states)) if (s.status === "running") next[id] = { ...s, status: "failed", at: now.toISOString(), endedAt: now.toISOString(), error: `انقطع الخبر من ${who}`, inferred: true };
          if (JSON.stringify(next) !== JSON.stringify(states)) await db.workflowRun.update({ where: { id: run.id }, data: { nodeStates: next as unknown as Prisma.InputJsonValue } });
          const minutes = Math.round((now.getTime() - (run.heartbeatAt ?? run.startedAt).getTime()) / 60_000);
          await audit(ACTOR, "workflow.lost", { type: "workflow_run", id: run.id }, { after: { job: wf.key, minutes } });
          await emit({ kind: lost ? "run.lost" : "run.failed", runId: run.id, jobKey: wf.key, jobName: wf.name, scheduledFor: run.scheduledFor, minutes, who, detail: lost ? null : `انقطع الخبر من ${who}` }, wf.notifyOn);
          done("lose");
          break;
        }
        case "reopen_handoff": {
          const h = await db.handoff.findUnique({ where: { id: a.id } });
          if (!h) { skip(); continue; }
          const wf = await db.workflow.findUnique({ where: { key: h.workflowKey } });
          const r = await db.handoff.updateMany({
            where: { id: a.id, status: "claimed", leaseUntil: { lte: now } },
            // taken by one that went quiet: open again, and a new taker has the grace to come
            data: { status: "open", claimedBy: null, claimedAt: null, claimNonce: null, leaseUntil: null, expiresAt: new Date(now.getTime() + (wf?.graceMin ?? 15) * 60_000) },
          });
          if (!r.count) { skip(); continue; }
          await audit(ACTOR, "handoff.reopen", { type: "handoff", id: a.id }, { before: { claimedBy: h.claimedBy } });
          done("reopen_handoff");
          break;
        }
        case "expire_handoff": {
          const r = await expireHandoff(a.id, now);
          if (!r.ended) { skip(); continue; }
          if (r.runId && r.jobKey) {
            const wf = await db.workflow.findUnique({ where: { key: r.jobKey } });
            const run = await db.workflowRun.findUnique({ where: { id: r.runId } });
            if (wf && run) await emit({ kind: "run.missed", runId: run.id, jobKey: wf.key, jobName: wf.name, scheduledFor: run.scheduledFor, who: await whoIs(wf.assigneeKey) }, wf.notifyOn);
          }
          done("expire_handoff");
          break;
        }
        case "close_handoff": {
          const r = await db.handoff.updateMany({ where: { id: a.id, status: { in: ["open", "claimed"] } }, data: { status: "done", doneBy: "auto", doneAt: now, resultNote: "انتهى التشغيل" } });
          if (!r.count) { skip(); continue; }
          done("close_handoff");
          break;
        }
        case "finish_job": {
          const r = await db.workflow.updateMany({ where: { key: a.jobKey, finishedAt: null }, data: { finishedAt: now } });
          if (!r.count) { skip(); continue; }
          await audit(ACTOR, "workflow.finished", { type: "workflow", id: a.jobKey });
          done("finish_job");
          break;
        }
        case "expire_approval": {
          const r = await db.approval.updateMany({ where: { id: a.id, OR: [{ status: "pending" }, { status: "postponed", postponedUntil: null }], expiresAt: { lt: now } }, data: { status: "expired" } });
          if (!r.count) { skip(); continue; }
          done("expire_approval");
          break;
        }
        case "stuck": {
          const run = await db.workflowRun.findUnique({ where: { id: a.runId } });
          const wf = run ? await db.workflow.findFirst({ where: { id: run.workflowId } }) : null;
          if (!run || !wf || (run.status !== "waiting" && run.status !== "queued")) { skip(); continue; }
          const e = await emit({ kind: "run.stuck", runId: run.id, jobKey: wf.key, jobName: wf.name, scheduledFor: run.scheduledFor, minutes: a.minutes, queued: run.status === "queued", who: await whoIs(wf.assigneeKey) }, wf.notifyOn);
          // told once per run: a second pass finds the row and counts nothing
          if (!e.written) { skip(); continue; }
          done("stuck");
          break;
        }
      }
    } catch (e) {
      if (e instanceof HandoffRefused || e instanceof ExecRefused) skip();
      else res.errors.push(`${a.type}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
    }
  }
  return res;
}

export interface WatchdogPass {
  locked: boolean;
  planned: Record<string, number>;
  applied: Record<string, number>;
  skipped: number;
  errors: string[];
}

/**
 * One pass of the watchdog. Under `pg_try_advisory_xact_lock`: while another worker holds it, this pass does nothing (it is not an error). The lock is the
 * transaction kind on purpose — the pool hands every query a connection of its own, and a lock tied to a session could be left held by one of them.
 * Writes the heartbeat (`watchdog.tick`) and nothing else when nothing is due.
 */
export async function runWatchdog(now = new Date()): Promise<WatchdogPass> {
  const pass = await db.$transaction(
    async (tx) => {
      const got = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext('watchdog')) AS ok`;
      if (!got[0]?.ok) return null;
      const snapshot = await loadSnapshot(now);
      const plan = watchPlan(snapshot, now);
      const r = plan.length ? await applyWatch(plan, now) : ({ applied: {}, skipped: 0, errors: [] } as WatchResult);
      return { planned: countActions(plan), ...r };
    },
    { timeout: 55_000, maxWait: 5_000 },
  );
  const out: WatchdogPass = pass ? { locked: false, ...pass } : { locked: true, planned: {}, applied: {}, skipped: 0, errors: [] };
  const value = { at: now.toISOString(), ...(out.locked ? { locked: true } : { planned: out.planned, applied: out.applied, ...(out.errors.length ? { errors: out.errors.length } : {}) }) };
  await db.setting.upsert({ where: { key: WATCHDOG_TICK_KEY }, create: { key: WATCHDOG_TICK_KEY, value }, update: { value } });
  return out;
}
