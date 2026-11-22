/**
 * THE TASKS PLACE, READ FROM THE DATABASE (v6 · P3, docs/rebuild-v6/02-screens.md §3): `loadNow()` (the lanes) · `dayBoard(day)` · `loadAll()` (the jobs and the people's tasks) ·
 * `loadResults()` · and the pages of one job and one run. A fixed number of queries whatever the number of jobs (W-20); everything that decides a word, a lamp or a lane is
 * in `src/core/tasks-view.ts` (pure) — this file only reads rows and hands them over. A demo site has the seeded jobs and no run.
 */
import { cache } from "react";
import { ammanKey } from "@/core/dates";
import { collapseDayItems, type CollapsedLine } from "@/core/day-collapse";
import { isDemo, missingGroups, integrationOf } from "@/core/readiness";
import { assigneeOfExecutor, stepOrder, GraphSchema, SEED_WORKFLOWS, type NodeStates, type WfGraph } from "@/core/workflow";
import { stepsAreInferred, isLiveRun } from "@/core/run-state";
import {
  buildAll, buildDayBoard, buildNow, stuckOf, stateOfRun, stepTimeWords, durationWords, runHref, sentenceOf, stripOf, whoOptions, actionsFor,
  type AllGroup, type DayBoardData, type NowData, type NowLine, type StuckData, type ViewJob, type ViewRun, type ViewTask, type Names, type AllKind, type CardAction,
} from "@/core/tasks-view";
import type { StripStep } from "@/core/light-strip";
import { workdayBounds, workdayOf } from "@/core/timeline";
import type { JobDomain } from "@/core/jobs";
import { STATE_WORDS, type WordState } from "@/core/state-word";
import { fromApproval } from "@/core/inbox";
import { canReadRunResult, canSeeRunApproval, runMetricsFor } from "@/core/run-access";
import type { RoleKey } from "@/core/roles";
import { db } from "@/server/db";
import { directoryNames } from "@/server/directory";
import { loadReports, type ReportRow } from "@/server/reports";
import { loadDay } from "./day-view";
import { loadJobs, type JobView } from "./jobs-view";

const HOUR = 3_600_000;
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

// ───────────────────────────── the rows ─────────────────────────────

interface JobRow {
  id: string;
  key: string;
  number: number | null;
  name: string;
  domain: string;
  kind: string;
  schedule: string | null;
  scheduleText: string | null;
  runsAt: Date | null;
  endsAt: Date | null;
  enabled: boolean;
  graceMin: number;
  assigneeKey: string | null;
  finishedAt: Date | null;
  /** one of the site's own recipes (it runs itself: a failed run is run again, not asked of an agent) */
  recipe?: string | null;
  graph: unknown;
}

const EMPTY: WfGraph = { nodes: [], edges: [] };
const asJob = (j: JobRow): ViewJob => ({
  key: j.key,
  number: j.number,
  name: j.name,
  domain: j.domain === "ops" ? "ops" : "ads",
  kind: j.kind,
  schedule: j.schedule,
  scheduleText: j.scheduleText,
  runsAt: iso(j.runsAt),
  endsAt: iso(j.endsAt),
  enabled: j.enabled,
  graceMin: j.graceMin,
  assigneeKey: j.assigneeKey,
  finishedAt: iso(j.finishedAt),
  ...(j.recipe ? { recipe: j.recipe } : {}),
  graph: GraphSchema.safeParse(j.graph).data ?? EMPTY,
});

/** The jobs that are not put away or merged (the demo: the seeded ones, with numbers and no run). */
export async function readJobs(): Promise<{ jobs: ViewJob[]; ids: Map<string, string>; demo: boolean }> {
  if (isDemo(process.env)) {
    const jobs = SEED_WORKFLOWS.map((s, i) => ({ key: s.key, number: i + 1, name: s.name, domain: "ads" as JobDomain, kind: "recurring", schedule: s.schedule, scheduleText: null, runsAt: null, endsAt: null, enabled: true, graceMin: 15, assigneeKey: assigneeOfExecutor(s.executor), finishedAt: null, graph: s.graph }));
    return { jobs, ids: new Map(jobs.map((j) => [j.key, j.key])), demo: true };
  }
  const rows = await db.workflow.findMany({ where: { archivedAt: null, mergedInto: null }, orderBy: [{ number: "asc" }, { name: "asc" }] });
  return { jobs: rows.map(asJob), ids: new Map(rows.map((r) => [r.id, r.key])), demo: false };
}

interface RunRow {
  id: string;
  workflowId: string;
  ref: string;
  status: string;
  trigger: string;
  scheduledFor: Date | null;
  startedAt: Date;
  heartbeatAt: Date | null;
  finishedAt: Date | null;
  endReason: string | null;
  summary: string | null;
  doneBy: string | null;
  nodeStates: unknown;
}

const asRun = (r: RunRow, jobKey: string, assignee: string | null = null): ViewRun => ({
  id: r.id,
  jobKey,
  status: r.status,
  trigger: r.trigger,
  scheduledFor: iso(r.scheduledFor),
  startedAt: r.startedAt.toISOString(),
  heartbeatAt: iso(r.heartbeatAt),
  finishedAt: iso(r.finishedAt),
  endReason: r.endReason,
  summary: r.summary,
  doneBy: r.doneBy,
  nodeStates: (r.nodeStates as NodeStates) ?? {},
  assignee,
});

/** Who each queued run's request is open for: `<job key>:<run ref>` → the assignee (one query). */
async function openRequests(): Promise<Map<string, string>> {
  const rows = await db.handoff.findMany({ where: { status: { in: ["open", "claimed"] }, runRef: { not: null } }, select: { workflowKey: true, runRef: true, assignee: true } });
  return new Map(rows.map((h) => [`${h.workflowKey}:${h.runRef}`, h.assignee]));
}

async function runsWhere(where: object, take: number, jobs: { ids: Map<string, string> }): Promise<ViewRun[]> {
  const [rows, req] = await Promise.all([db.workflowRun.findMany({ where, orderBy: { startedAt: "desc" }, take }), openRequests()]);
  return rows
    .filter((r) => jobs.ids.has(r.workflowId))
    .map((r) => {
      const key = jobs.ids.get(r.workflowId)!;
      return asRun(r, key, req.get(`${key}:${r.ref}`) ?? null);
    });
}

// ───────────────────────────── «هلق» ─────────────────────────────

/**
 * The lanes of «هلق»: the live runs, the ones that stopped in the last 24 hours, the missed slots of today's working day and the runs that finished in it — one query for
 * the runs, one for the open requests, one for the people's tasks. `taskKeys` is the scope of the person looking (`taskKeysFor`: null = everybody's).
 */
export async function loadNow(opts: { now?: Date; taskKeys?: string[] | null } = {}): Promise<NowData & { demo: boolean }> {
  const now = opts.now ?? new Date();
  const bounds = workdayBounds(now);
  const names = await directoryNames().catch(() => ({}) as Names);
  const jobs = await readJobs();
  if (jobs.demo) return { ...buildNow({ jobs: jobs.jobs, runs: [], tasks: [], names, now }), demo: true };
  const since = new Date(Math.min(now.getTime() - 24 * HOUR, bounds.from.getTime()));
  const [runs, tasks] = await Promise.all([
    runsWhere({ OR: [{ status: { in: ["queued", "running", "waiting"] } }, { startedAt: { gte: since } }, { scheduledFor: { gte: since } }] }, 800, jobs),
    db.task.findMany({ where: { archivedAt: null, status: { not: "done" }, dueAt: { not: null, lt: bounds.to }, ...(opts.taskKeys ? { assignee: { in: opts.taskKeys } } : {}) }, orderBy: { dueAt: "asc" }, take: 100 }),
  ]);
  return { ...buildNow({ jobs: jobs.jobs, runs, tasks: tasks.map(asTask), names, now }), demo: false };
}

/**
 * What needs somebody (v6 · P5, the home's first section): the runs that wait, that stopped or were lost in the last day and that nothing answered, that nobody took, and the slots
 * missed today — the first two lanes of «هلق», one card each. `taskKeys` is the scope of the person looking (`taskKeysFor`). It reads what `loadNow` reads (and no more), so the
 * home and the tasks screen are one rule.
 */
export async function loadStuck(opts: { now?: Date; taskKeys?: string[] | null } = {}): Promise<StuckData & { demo: boolean }> {
  const data = await loadNow(opts);
  return { ...stuckOf(data), demo: data.demo };
}

export interface HomeTasks {
  demo: boolean;
  /** the first section's runs */
  stuck: StuckData;
  /** the moments still to come today: how many in all, and the first ones (the lane's own limit) */
  upcoming: { total: number; lines: NowLine[] };
}

const homeTasksOf = cache(async (scope: string): Promise<HomeTasks> => {
  const data = await loadNow({ taskKeys: scope === "*" ? null : scope === "" ? [] : scope.split(",") });
  const lane = data.lanes.find((l) => l.key === "upcoming");
  return { demo: data.demo, stuck: stuckOf(data), upcoming: { total: lane?.total ?? 0, lines: lane?.lines ?? [] } };
});

/** What the home needs from the tasks place: the stopped runs and what comes today. Read ONCE per request however many sections ask (`cache`). */
export const loadHomeTasks = (taskKeys: string[] | null): Promise<HomeTasks> => homeTasksOf(taskKeys === null ? "*" : taskKeys.join(","));

const asTask = (t: { id: string; title: string; assignee: string | null; status: string; dueAt: Date | null; priority: string }): ViewTask => ({ id: t.id, title: t.title, assignee: t.assignee, status: t.status, dueAt: iso(t.dueAt), priority: t.priority });

// ───────────────────────────── «جدول اليوم» ─────────────────────────────

export interface DayBoardView extends DayBoardData {
  demo: boolean;
  today: string;
  /** what was done in this working day, the same line folded: «104 فيديو انرفعوا لميتا» */
  done: CollapsedLine[];
  /** the filters that are on, and the choices */
  who: { key: string; label: string }[];
}

/** The board of a working day (06:00 → 06:00): every moment of every job with its one word, then what was done in the same hours, the same line said once. */
export async function dayBoard(day: string, opts: { now?: Date; who?: string | null; domain?: JobDomain | null } = {}): Promise<DayBoardView> {
  const now = opts.now ?? new Date();
  const bounds = workdayOf(day);
  const names = await directoryNames().catch(() => ({}) as Names);
  const jobs = await readJobs();
  const filter = { who: opts.who ?? null, domain: opts.domain ?? null };
  const who = whoOptions(jobs.jobs, [], names);
  const today = workdayBounds(now).key;
  if (jobs.demo) {
    const board = buildDayBoard({ jobs: jobs.jobs, runs: [], bounds, now, names, filter });
    return { ...board, demo: true, today, done: [], who };
  }
  const [runs, data] = await Promise.all([
    runsWhere({ OR: [{ startedAt: { gte: bounds.from, lt: bounds.to } }, { scheduledFor: { gte: bounds.from, lt: bounds.to } }] }, 1500, jobs),
    loadDay(day, now, { workday: true }),
  ]);
  const board = buildDayBoard({ jobs: jobs.jobs, runs, bounds, now, names, filter });
  // what was done: the lines of the day — the run lines are the board's, so they are not said twice
  const done = collapseDayItems(data.done.flatMap((g) => g.items).filter((i) => i.kind !== "run"));
  return { ...board, demo: false, today, done, who };
}

// ───────────────────────────── «كل المهام» ─────────────────────────────

export interface AllView {
  demo: boolean;
  groups: AllGroup[];
  who: { key: string; label: string }[];
  /** how many pairs look like one job written twice (the button «نظّف المكرّر» shows when there are) */
  duplicates: number;
  total: number;
}

export async function loadAll(opts: { now?: Date; kind?: AllKind | null; who?: string | null; taskKeys?: string[] | null; duplicates?: number } = {}): Promise<AllView> {
  const now = opts.now ?? new Date();
  const names = await directoryNames().catch(() => ({}) as Names);
  const jobs = await readJobs();
  const last = new Map<string, Pick<ViewRun, "status" | "nodeStates">>();
  const newestAt = new Map<string, number>();
  let tasks: ViewTask[] = [];
  if (!jobs.demo) {
    const ids = [...jobs.ids.keys()];
    const newest = ids.length ? await db.workflowRun.groupBy({ by: ["workflowId"], where: { workflowId: { in: ids } }, _max: { startedAt: true } }) : [];
    const lasts = newest.length ? await db.workflowRun.findMany({ where: { OR: newest.filter((n) => n._max.startedAt).map((n) => ({ workflowId: n.workflowId, startedAt: n._max.startedAt as Date })) } }) : [];
    for (const r of lasts) {
      const key = jobs.ids.get(r.workflowId);
      // two runs started in the same instant: the one written last is the last
      if (key && r.createdAt.getTime() >= (newestAt.get(key) ?? 0)) {
        newestAt.set(key, r.createdAt.getTime());
        last.set(key, { status: r.status, nodeStates: (r.nodeStates as unknown as NodeStates) ?? {} });
      }
    }
    const rows = await db.task.findMany({ where: { archivedAt: null, status: { not: "done" }, ...(opts.taskKeys ? { assignee: { in: opts.taskKeys } } : {}) }, orderBy: { dueAt: "asc" }, take: 300 });
    tasks = rows.map(asTask);
  }
  const groups = buildAll({ jobs: jobs.jobs, last, tasks, names, now, filter: { kind: opts.kind ?? null, who: opts.who ?? null } });
  return { demo: jobs.demo, groups, who: whoOptions(jobs.jobs, tasks, names), duplicates: opts.duplicates ?? 0, total: jobs.jobs.length + tasks.length };
}

// ───────────────────────────── «النتائج» ─────────────────────────────

export interface ResultsView {
  demo: boolean;
  rows: (ReportRow & { count: number })[];
  /** reports with nothing in them that are not shown, and why */
  hidden: number;
  hiddenWhy: string | null;
}

/** The results, newest first. A run that said nothing (an empty report) is not listed — it is counted in one line at the end; the same result twice in a row is one line with a count. */
export async function loadResults(opts: { limit?: number; jobKey?: string; domain?: "ads" | "ops"; day?: string } = {}): Promise<ResultsView> {
  if (isDemo(process.env)) return { demo: true, rows: [], hidden: 0, hiddenWhy: null };
  const all = await loadReports({ limit: opts.limit ?? 60, base: "/tasks/results", ...(opts.jobKey ? { jobKey: opts.jobKey } : {}), ...(opts.domain ? { domain: opts.domain } : {}), ...(opts.day ? { day: opts.day } : {}) });
  const shown = all.filter((r) => !r.empty);
  const emptyPeriodic = opts.jobKey || opts.domain || opts.day ? 0 : await db.report.count({ where: { kind: { in: ["morning", "weekly", "monthly"] }, empty: true } });
  const hidden = all.length - shown.length + emptyPeriodic;
  // the same job saying the same thing twice in a row is ONE line with a count (the list is newest first)
  const rows: (ReportRow & { count: number })[] = [];
  for (const r of shown) {
    const prev = rows[rows.length - 1];
    if (prev && prev.kind === "run" && r.kind === "run" && prev.jobKey === r.jobKey && prev.status === r.status && (prev.summary ?? "") === (r.summary ?? "") && r.summary) prev.count++;
    else rows.push({ ...r, count: 1 });
  }
  const metaOff = missingGroups(integrationOf("meta")).length > 0;
  return { demo: false, rows, hidden, hiddenWhy: hidden > 0 && metaOff ? "لأنو ميتا مش مربوطة" : null };
}

// ───────────────────────────── the page of a run ─────────────────────────────

export interface RunStepView extends StripStep {
  n: number;
  title: string;
  note: string | null;
  time: string | null;
  error: string | null;
  /** the step is in the states of the run but not in the steps of the job any more */
  removed: boolean;
  /** the id of the decision that waits on this step (its card is drawn inside the step) */
  approvalId: string | null;
  /** the step the buttons «أعد المحاولة»/«تخطّى» are about */
  needsHelp: boolean;
}

export interface RunPageData {
  job: ViewJob & { id: string; domainLabel: string };
  run: ViewRun & { ref: string; metrics: Record<string, unknown> | null; artifacts: { label: string; url?: string; text?: string }[]; report: string | null; graphVersion: number | null };
  state: WordState;
  word: string;
  sentence: string;
  who: string;
  steps: RunStepView[];
  inferred: boolean;
  actions: CardAction[];
  live: boolean;
  duration: string | null;
  /** this role may not read the result of the job (its area is not theirs): the summary, report, numbers and links are empty */
  resultHidden: boolean;
  approvals: { id: string; title: string; why: string; numbers: { label: string; value: string }[]; options: { key: string; label: string }[]; amount: number | null; urgency: "red" | "orange" | "yellow"; kind: string | null; source: string; workflowKey: string | null; expiresAt: string | null; postponedUntil: string | null; createdAt: string; nodeId: string | null; analysis: Record<string, unknown> | null }[];
}

/**
 * One run: the rope drawn from the steps it BEGAN with (its own version), every state exactly as it was stored, the sentence, the decisions that wait on its steps. Null: no such run.
 * `role` is who is looking (null: a job or a test). As on the results screen, the result needs the area of the job, the money numbers need `money.view`, and a decision needs the inbox.
 */
export async function loadRunPage(key: string, runId: string, role: RoleKey | null, now = new Date()): Promise<RunPageData | null> {
  if (isDemo(process.env)) return null;
  const job = await db.workflow.findUnique({ where: { key } });
  if (!job) return null;
  const run = await db.workflowRun.findFirst({ where: { id: runId, workflowId: job.id } });
  if (!run) return null;
  const names = await directoryNames().catch(() => ({}) as Names);
  const jobView = asJob(job);
  let graph = jobView.graph;
  if (run.graphVersion != null && run.graphVersion !== job.version) {
    const v = await db.workflowVersion.findUnique({ where: { workflowId_version: { workflowId: job.id, version: run.graphVersion } } });
    const g = v ? GraphSchema.safeParse(v.graph) : null;
    if (g?.success) graph = g.data;
  }
  const [req, approvalRows] = await Promise.all([
    openRequests(),
    db.approval.findMany({ where: { workflowKey: key, runRef: run.ref, status: { in: ["pending", "postponed"] } }, orderBy: { createdAt: "asc" } }),
  ]);
  const mapped = approvalRows.map((a) => ({
    id: a.id,
    title: a.title,
    why: a.why,
    numbers: (a.numbers as { label: string; value: string }[] | null) ?? [],
    options: (a.options as { key: string; label: string }[] | null) ?? [],
    amount: a.amount === null ? null : Number(a.amount),
    urgency: (a.urgency === "red" || a.urgency === "yellow" ? a.urgency : "orange") as "red" | "orange" | "yellow",
    kind: a.kind,
    source: a.source,
    workflowKey: a.workflowKey,
    expiresAt: iso(a.expiresAt),
    postponedUntil: iso(a.postponedUntil),
    createdAt: a.createdAt.toISOString(),
    nodeId: a.nodeId,
    analysis: (a.analysis as Record<string, unknown> | null) ?? null,
  }));
  const seeResult = canReadRunResult(role, jobView.domain);
  // a decision belongs to the inbox: it is drawn here only for a role whose inbox holds its area (the same filter as the inbox itself) AND who may read this job's area — its numbers are the job's numbers
  const approvals = seeResult ? mapped.filter((a) => canSeeRunApproval(role, fromApproval({ ...a, analysis: a.analysis as { text?: string } | null }).domain)) : [];
  const v = asRun(run, key, req.get(`${key}:${run.ref}`) ?? null);
  const states = v.nodeStates;
  const forRun = { ...jobView, graph };
  const state = stateOfRun(v);
  const approvalOf = new Map(approvals.filter((a) => a.nodeId).map((a) => [a.nodeId as string, a.id]));
  const order = stepOrder(graph).filter((n) => n.type !== "trigger" && !n.disabled);
  const known = new Set(order.map((n) => n.id));
  const steps: RunStepView[] = order.map((n, i) => {
    const s = states[n.id];
    const strip = stripOf(forRun, v)[i]!;
    return {
      ...strip,
      n: i + 1,
      title: n.label,
      note: s?.note ?? null,
      time: stepTimeWords(s?.startedAt, s?.endedAt),
      error: s?.error ?? null,
      removed: false,
      approvalId: approvalOf.get(n.id) ?? null,
      needsHelp: s?.status === "failed" || s?.status === "approval" || s?.status === "handoff",
    };
  });
  // a step the run reported that the job does not have: shown as removed, with its own state, never dropped (§14)
  let extra = steps.length;
  for (const [id, s] of Object.entries(states)) {
    if (known.has(id) || !s) continue;
    extra++;
    steps.push({ id, n: extra, title: "خطوة انشالت من المهمة", lamp: s.status === "done" ? "done" : s.status === "failed" ? "fail" : s.status === "running" ? "run" : "off", ...(s.inferred ? { inferred: true } : {}), note: s.note ?? null, time: stepTimeWords(s.startedAt, s.endedAt), error: s.error ?? null, removed: true, approvalId: null, needsHelp: false });
  }
  const metrics = run.metrics && typeof run.metrics === "object" && !Array.isArray(run.metrics) ? (run.metrics as Record<string, unknown>) : null;
  const artifacts = Array.isArray(run.artifacts) ? (run.artifacts as { label?: string; url?: string; text?: string }[]).filter((a) => a?.label).map((a) => ({ label: String(a.label), ...(a.url ? { url: a.url } : {}), ...(a.text ? { text: a.text } : {}) })) : [];
  return {
    job: { ...jobView, id: job.id, domainLabel: jobView.domain === "ops" ? "فريق وتشغيل" : "إعلانات" },
    run: { ...v, summary: seeResult ? v.summary : null, ref: run.ref, metrics: seeResult ? runMetricsFor(role, metrics) : null, artifacts: seeResult ? artifacts : [], report: seeResult ? run.report : null, graphVersion: run.graphVersion },
    state,
    word: STATE_WORDS[state].word,
    sentence: sentenceOf(forRun, v, names, now),
    who: names[v.assignee ?? v.doneBy ?? job.assigneeKey ?? ""] ?? (v.assignee ?? v.doneBy ?? job.assigneeKey ?? "بلا مسؤول"),
    steps,
    inferred: stepsAreInferred(v),
    actions: actionsFor(state, { recipe: !!jobView.recipe }),
    live: isLiveRun(run.status),
    duration: durationWords(v.startedAt, v.finishedAt),
    resultHidden: !seeResult,
    approvals,
  };
}

// ───────────────────────────── the page of a job ─────────────────────────────

export interface JobRunLine {
  id: string;
  state: WordState;
  steps: StripStep[];
  word: string;
  startedAt: string;
  duration: string | null;
  line: string | null;
  href: string;
  summary: string | null;
}

/** The last runs of a job (10), each as a small rope, its word, how long it took and its one line. */
export async function loadJobRuns(job: ViewJob, jobId: string, now = new Date(), limit = 10): Promise<{ runs: JobRunLine[]; live: ViewRun | null; names: Names }> {
  const [rows, names] = await Promise.all([db.workflowRun.findMany({ where: { workflowId: jobId }, orderBy: { startedAt: "desc" }, take: limit }), directoryNames().catch(() => ({}) as Names)]);
  const req = await openRequests();
  const runs = rows.map((r) => asRun(r, job.key, req.get(`${job.key}:${r.ref}`) ?? null));
  const lines: JobRunLine[] = runs.map((r) => {
    const state = stateOfRun(r);
    return { id: r.id, state, steps: stripOf(job, r), word: STATE_WORDS[state].word, startedAt: r.startedAt, duration: durationWords(r.startedAt, r.finishedAt), line: state === "done" ? (r.summary?.split(/\r?\n/)[0]?.slice(0, 90) ?? null) : sentenceOf(job, r, names, now), href: runHref(job.key, r.id), summary: r.summary };
  });
  const live = runs.find((r) => isLiveRun(r.status)) ?? null;
  return { runs: lines, live, names };
}

export interface JobPageData {
  job: JobView;
  view: ViewJob;
  runs: JobRunLine[];
  /** the run that is going now (queued · running · waiting), if any */
  live: { id: string; state: WordState; sentence: string; steps: StripStep[]; actions: CardAction[] } | null;
  /** the last finished run, when nothing is going */
  last: JobRunLine | null;
  /** the people and agents the job's requests can be handed to */
  names: Names;
}

/** What the page of a job needs: its view (the same one the old map reads), its last ten runs as small ropes, and — when one is going — that run with its sentence and its buttons. Null: no such job. */
export async function loadJobPage(key: string, now = new Date()): Promise<JobPageData | null> {
  const { jobs, demo } = await loadJobs(now);
  const job = jobs.find((j) => j.key === key);
  if (!job) return null;
  const view: ViewJob = { key: job.key, number: job.number, name: job.name, domain: job.domain, kind: job.kind, schedule: null, scheduleText: null, runsAt: null, endsAt: null, enabled: job.enabled, graceMin: job.graceMin, assigneeKey: job.assigneeKey, ...(job.recipe ? { recipe: job.recipe } : {}), graph: job.graph };
  if (demo) return { job, view, runs: [], live: null, last: null, names: {} };
  const row = await db.workflow.findUnique({ where: { key }, select: { id: true } });
  if (!row) return null;
  const { runs, live, names } = await loadJobRuns(view, row.id, now);
  const liveRun = live ? { id: live.id, state: stateOfRun(live), sentence: sentenceOf(view, live, names, now), steps: stripOf(view, live), actions: actionsFor(stateOfRun(live), { recipe: !!job.recipe }) } : null;
  return { job, view, runs, live: liveRun, last: liveRun ? null : (runs[0] ?? null), names };
}

export { ammanKey };
