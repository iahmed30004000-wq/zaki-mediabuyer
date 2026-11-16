/**
 * THE SITE'S OWN CLOCK (v3 · S), the server half. Off unless `SITE_SCHEDULER=1` (n8n may already be the clock: two clocks would
 * wake Claude twice). On, the worker calls \`runScheduled\` every minute; each due workflow is fired once for its due minute
 * (the job runner's (job, slot) row is the lock):
 *   · its steps the site may run itself (n8n · HTTP · Telegram, D35) → run from the site, handing over what it may not run;
 *   · anything else → a «run now» request in the handoff queue, so Claude wakes and runs it — the same as pressing the button.
 * It spends nothing and touches nothing on Meta; every firing is in the audit log.
 */
import { dueRuns, schedulerOn, type Schedulable } from "@/core/scheduler";
import { runOnce } from "@/jobs/runner";
import { audit, type Actor } from "./audit";
import { db } from "./db";
import { HandoffRefused, requestRun } from "./handoffs";
import { ExecRefused, executeWorkflow, realDeps, type ExecDeps } from "./step-exec";
import { UnknownJob } from "./workflows";

export type ScheduleResult = {
  checked: number;
  fired: { key: string; slot: string; how: "site" | "claude" }[];
  skipped: { key: string; why: string }[];
  note?: string;
};

const ACTOR: Actor = { type: "system", id: "scheduler" };

export async function runScheduled(now: Date, d: ExecDeps = realDeps(), env: Record<string, string | undefined> = process.env): Promise<ScheduleResult> {
  const out: ScheduleResult = { checked: 0, fired: [], skipped: [] };
  if (!schedulerOn(env)) return { ...out, note: "الجدولة من الموقع مقفولة (SITE_SCHEDULER=1 بيشغّلها)" };
  const rows: Schedulable[] = await db.workflow.findMany({ where: { enabled: true, archivedAt: null, NOT: { schedule: null } }, select: { key: true, schedule: true, enabled: true, archivedAt: true, permission: true } });
  out.checked = rows.length;
  for (const due of dueRuns(rows, now)) {
    await runOnce(`workflow.fire:${due.key}`, due.slot, async () => {
      try {
        const r = await executeWorkflow(due.key, ACTOR, d);
        out.fired.push({ key: due.key, slot: due.slot, how: "site" });
        await audit(ACTOR, "workflow.scheduled", { type: "workflow", id: due.key }, { after: { slot: due.slot, how: "site", status: r.status } });
        return { how: "site", status: r.status };
      } catch (e) {
        // no step the site may run → hand it to Claude like «شغّل هلق»; an open request or a refusal is just said
        if (e instanceof ExecRefused && e.status === 400) {
          try {
            const r = await requestRun(due.key, ACTOR, now);
            out.fired.push({ key: due.key, slot: due.slot, how: "claude" });
            await audit(ACTOR, "workflow.scheduled", { type: "workflow", id: due.key }, { after: { slot: due.slot, how: "claude", created: r.created } });
            return { how: "claude", created: r.created };
          } catch (e2) {
            if (!(e2 instanceof HandoffRefused)) throw e2;
            out.skipped.push({ key: due.key, why: e2.message });
            return { skipped: e2.message };
          }
        }
        if (e instanceof ExecRefused || e instanceof UnknownJob) {
          const why = e instanceof ExecRefused ? e.message : "الورك فلو مش موجود";
          out.skipped.push({ key: due.key, why });
          return { skipped: why };
        }
        throw e;
      }
    });
  }
  return out;
}
