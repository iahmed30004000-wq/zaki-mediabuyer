/** Loads the working day's line (src/core/timeline.ts) from the jobs and their runs. A demo site has no line: nothing is made up. */
import { isDemo } from "@/core/readiness";
import { dayLine, workdayBounds, workdayOf, type DayLine, type LineJob, type LineRun } from "@/core/timeline";
import { db } from "@/server/db";

export interface DayLineView {
  demo: boolean;
  /** the calendar key of the working day */
  day: string;
  line: DayLine;
  /** jobs that are scheduled — «ولا مهمة مجدولة» when 0 */
  scheduled: number;
}

const EMPTY = (from: Date, to: Date): DayLine => ({ from: from.toISOString(), to: to.toISOString(), dots: [], next: null, counts: { done: 0, failed: 0, running: 0, missed: 0, coming: 0, manual: 0 } });

/** `day` is a calendar key; left out, it is the working day that `now` is in. */
export async function loadDayLine(opts: { day?: string; now?: Date } = {}): Promise<DayLineView> {
  const now = opts.now ?? new Date();
  const b = opts.day ? workdayOf(opts.day) : workdayBounds(now);
  if (isDemo(process.env)) return { demo: true, day: b.key, line: EMPTY(b.from, b.to), scheduled: 0 };
  const [wfs, runs] = await Promise.all([
    db.workflow.findMany({ where: { archivedAt: null }, select: { key: true, name: true, schedule: true, enabled: true, kind: true, runsAt: true, endsAt: true, graceMin: true } }),
    db.workflowRun.findMany({ where: { startedAt: { gte: b.from, lt: b.to } }, select: { id: true, status: true, trigger: true, startedAt: true, scheduledFor: true, workflow: { select: { key: true } } }, orderBy: { startedAt: "asc" }, take: 500 }),
  ]);
  const jobs: LineJob[] = wfs.map((w) => ({ key: w.key, name: w.name, schedule: w.schedule, enabled: w.enabled, kind: w.kind, runsAt: w.runsAt?.toISOString() ?? null, endsAt: w.endsAt?.toISOString() ?? null, graceMin: w.graceMin }));
  const lineRuns: LineRun[] = runs.map((r) => ({ id: r.id, jobKey: r.workflow.key, startedAt: r.startedAt.toISOString(), status: r.status, trigger: r.trigger, scheduledFor: r.scheduledFor?.toISOString() ?? null }));
  return { demo: false, day: b.key, line: dayLine(jobs, lineRuns, b, now), scheduled: jobs.filter((j) => j.enabled && (j.schedule || j.kind === "once")).length };
}
