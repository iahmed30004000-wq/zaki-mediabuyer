/**
 * THE TASKS PLACE, AS DATA (v6 · P3, docs/rebuild-v6/02-screens.md §3). «هلق» (the lanes), «جدول اليوم» (the board), «كل المهام» (one list) — each built here from plain rows,
 * pure: a loader (src/lib/tasks-view.ts) reads the tables and hands the rows in; the clock is a parameter. Every word of a state comes from `state-word.ts`
 * and every lamp from `run-state.ts` — a screen only draws what is decided here, and never guesses what the stored run did not say.
 */
import { ammanKey } from "./dates";
import { timeOf } from "./day";
import { KIND_AR, DOMAIN_AR, scheduleWords, type JobDomain, type JobKind } from "./jobs";
import type { StripStep } from "./light-strip";
import { runLamp, runSentence, runSteps, stepLamp, isLiveRun, type Lamp } from "./run-state";
import { STATE_WORDS, runWordState, wordOf, type WordState } from "./state-word";
import { dueState } from "./tasks";
import { dayLine, workdayBounds, type LineJob, type LineRun } from "./timeline";
import type { NodeStates, WfGraph } from "./workflow";

// ───────────────────────────── the rows the loaders hand in ─────────────────────────────

export interface ViewJob {
  key: string;
  number: number | null;
  name: string;
  domain: JobDomain;
  kind: JobKind | string;
  schedule: string | null;
  scheduleText: string | null;
  runsAt: string | null;
  endsAt: string | null;
  enabled: boolean;
  graceMin: number;
  assigneeKey: string | null;
  finishedAt?: string | null;
  graph: Pick<WfGraph, "nodes" | "edges">;
}

export interface ViewRun {
  id: string;
  jobKey: string;
  status: string;
  trigger: string;
  scheduledFor: string | null;
  startedAt: string;
  heartbeatAt: string | null;
  finishedAt: string | null;
  endReason: string | null;
  summary: string | null;
  doneBy: string | null;
  nodeStates: NodeStates;
  /** whoever the request of a queued run is open for (`Handoff.assignee`) */
  assignee?: string | null;
}

export interface ViewTask {
  id: string;
  title: string;
  assignee: string | null;
  status: string;
  dueAt: string | null;
  priority: string;
}

export type Names = Readonly<Record<string, string>>;

/** The name of whoever carries a job (or a run) out: the directory's, «الموقع» for the site itself, «بلا مسؤول» for nobody. */
export function whoIs(key: string | null | undefined, names: Names): string {
  if (!key) return "بلا مسؤول";
  return names[key] ?? (key === "site" ? "الموقع" : key === "claude" ? "Claude" : key);
}

// ───────────────────────────── one run, said in the owner's words ─────────────────────────────

/** What a waiting run waits on: a decision of the owner (a step on «approval»), or a step that needs somebody. */
export function waitingOn(run: Pick<ViewRun, "status" | "nodeStates">): "approval" | "step" | null {
  if (run.status !== "waiting") return null;
  return Object.values(run.nodeStates ?? {}).some((s) => s.status === "approval") ? "approval" : "step";
}

/** The word state of a run — the ONE word the screens use (docs/rebuild-v6/03-look.md §9). */
export const stateOfRun = (run: Pick<ViewRun, "status" | "nodeStates">): WordState => runWordState(run.status, waitingOn(run));

/** The lamps of a run's steps, in the order they run: what the light strip draws. A step the site inferred carries the mark, and the strip draws it without a halo. */
export function stripOf(job: Pick<ViewJob, "graph">, run: Pick<ViewRun, "nodeStates"> | null): StripStep[] {
  const states = run?.nodeStates ?? {};
  return runSteps(job.graph).map((n) => ({ id: n.id, label: n.label, lamp: run ? stepLamp(states[n.id]) : "off", ...(states[n.id]?.inferred ? { inferred: true } : {}) }));
}

/** The sentence under the rope for a run — `runSentence` with the name of whoever carries the job out. */
export function sentenceOf(job: Pick<ViewJob, "graph" | "assigneeKey">, run: ViewRun, names: Names, now: Date): string {
  const who = run.assignee ?? run.doneBy ?? job.assigneeKey;
  // «فاتت: …» — the word is already drawn beside it (the state word), so the line says only the reason
  return runSentence({ graph: job.graph, assigneeName: who ? whoIs(who, names) : null }, run, now).replace(/^فاتت: /, "");
}

// ───────────────────────────── the buttons of a card ─────────────────────────────

export type CardActionKey = "retry" | "skip" | "cancel" | "run_now" | "dismiss" | "open";
export interface CardAction {
  key: CardActionKey;
  label: string;
  variant: "primary" | "secondary" | "ghost";
}

const OPEN = (label: string, variant: CardAction["variant"] = "ghost"): CardAction => ({ key: "open", label, variant });

/**
 * The buttons a run in this state offers (docs/rebuild-v6/01-model.md §8): one primary at most. A run that waits for a DECISION opens its page (the card of the decision is
 * there, with «وافق» and «ارفض»); a run that stopped or whose step failed offers «أعد المحاولة من هون» and «تخطّى هالخطوة»; a request nobody took offers «ألغِ التشغيل»; a missed slot
 * offers «شغّلها هلق» and «تجاهل». A run that is going, finished or yet to come has none (its card opens the run).
 */
export function actionsFor(state: WordState): CardAction[] {
  switch (state) {
    case "stuck":
    case "fail":
    case "lost":
      return [
        { key: "retry", label: "أعد المحاولة من هون", variant: "primary" },
        { key: "skip", label: "تخطّى هالخطوة", variant: "secondary" },
        OPEN("شوف التشغيل"),
      ];
    case "approval":
      return [OPEN("شوف القرار", "primary")];
    case "queued":
      return [OPEN("شوف التشغيل", "primary"), { key: "cancel", label: "ألغِ التشغيل", variant: "ghost" }];
    case "missed":
      return [{ key: "run_now", label: "شغّلها هلق", variant: "primary" }, { key: "dismiss", label: "تجاهل", variant: "ghost" }];
    case "run":
      return [{ key: "cancel", label: "ألغِ التشغيل", variant: "ghost" }];
    default:
      return [];
  }
}

// ───────────────────────────── «هلق»: the lanes ─────────────────────────────

export const LANE_KEYS = ["stuck", "missed", "running", "upcoming", "team", "done"] as const;
export type LaneKey = (typeof LANE_KEYS)[number];

export const LANE_TITLES: Record<LaneKey, { title: string; lamp: Lamp }> = {
  stuck: { title: "واقفة — بدها حدا", lamp: "wait" },
  missed: { title: "فاتت وما اشتغلت", lamp: "missed" },
  running: { title: "شغّالة", lamp: "run" },
  upcoming: { title: "جاية اليوم", lamp: "off" },
  team: { title: "عند الفريق", lamp: "off" },
  done: { title: "خلصت اليوم", lamp: "done" },
};

/** The most each lane shows before «عرض الكل». */
export const LANE_LIMITS = { upcoming: 6, done: 5, team: 6 } as const;

export interface NowCard {
  id: string;
  jobKey: string;
  runId: string | null;
  number: number | null;
  name: string;
  who: string;
  state: WordState;
  /** the sentence under the rope */
  sentence: string;
  steps: StripStep[];
  actions: CardAction[];
  /** the page it opens */
  href: string;
  /** ISO — the moment it is about */
  at: string;
  /** how many more of the same job were folded into this card («فاتت 3 مرات») */
  more: number;
}

export interface NowLine {
  id: string;
  /** «19:07» */
  time: string;
  jobKey: string;
  number: number | null;
  name: string;
  who: string | null;
  /** the one line of the result (a done run) — null for a moment yet to come */
  line: string | null;
  href: string;
}

export interface TeamLine {
  id: string;
  title: string;
  who: string;
  /** «متأخرة» · «اليوم» */
  due: "late" | "today";
  dueAt: string | null;
  href: string;
}

export interface NowLane {
  key: LaneKey;
  title: string;
  lamp: Lamp;
  /** how many belong in the lane (the cards or lines shown may be fewer) */
  total: number;
  cards: NowCard[];
  lines: NowLine[];
  tasks: TeamLine[];
}

export interface NowData {
  /** only the lanes that have something — an empty lane is not drawn */
  lanes: NowLane[];
  /** how many runs need somebody (stuck + missed): the number the home carries */
  needs: number;
  day: string;
}

export const runHref = (jobKey: string, runId: string | null): string => (runId ? `/tasks/${encodeURIComponent(jobKey)}/runs/${encodeURIComponent(runId)}` : `/tasks/${encodeURIComponent(jobKey)}`);
export const jobHref = (jobKey: string): string => `/tasks/${encodeURIComponent(jobKey)}`;

const HOUR = 3_600_000;
const T = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : 0);
const moment = (r: Pick<ViewRun, "scheduledFor" | "startedAt">): number => T(r.scheduledFor) || T(r.startedAt);

/** A later run of the job answered it: the stop, the loss or the miss is old news. */
export function isSuperseded(run: ViewRun, runs: readonly ViewRun[]): boolean {
  return runs.some((r) => r.jobKey === run.jobKey && r.id !== run.id && r.status === "ok" && moment(r) > moment(run));
}

function cardOf(job: ViewJob, run: ViewRun, names: Names, now: Date, more = 0): NowCard {
  const state = stateOfRun(run);
  const who = run.assignee ?? run.doneBy ?? job.assigneeKey;
  return {
    id: run.id,
    jobKey: job.key,
    runId: run.id,
    number: job.number,
    name: job.name,
    who: whoIs(who, names),
    state,
    sentence: sentenceOf(job, run, names, now),
    steps: stripOf(job, run),
    actions: actionsFor(state),
    href: runHref(job.key, run.id),
    at: run.scheduledFor ?? run.startedAt,
    more,
  };
}

export interface NowInput {
  jobs: readonly ViewJob[];
  /** the live runs, the runs that stopped in the last 24 hours, the missed ones and the runs of today's working day */
  runs: readonly ViewRun[];
  tasks: readonly ViewTask[];
  names: Names;
  now: Date;
}

/**
 * «هلق» — six lanes, an empty one is left out (02 §3.1):
 *  واقفة — بدها حدا    a run `waiting`, a request nobody took for longer than the job's grace, a run that stopped or was lost in the last 24 hours and that nothing later answered
 *  فاتت وما اشتغلت     the slots of today's working day that were missed, one card a job (the latest, with how many came before it)
 *  شغّالة              a run going now — and a request just made that is still inside its grace (it waits, but nothing is wrong yet)
 *  جاية اليوم          the first 6 moments still to come
 *  عند الفريق          the people's tasks that are late or due today
 *  خلصت اليوم          the last 5 runs that finished, and how many in all
 */
export function buildNow(input: NowInput): NowData {
  const { now, names } = input;
  const bounds = workdayBounds(now);
  const jobOf = new Map(input.jobs.map((j) => [j.key, j]));
  const dayStart = bounds.from.getTime();
  const dayEnd = bounds.to.getTime();
  const runs = input.runs.filter((r) => jobOf.has(r.jobKey));

  const stuck: NowCard[] = [];
  const running: NowCard[] = [];
  const missedByJob = new Map<string, ViewRun[]>();
  const done: ViewRun[] = [];

  for (const r of runs) {
    const job = jobOf.get(r.jobKey)!;
    if (r.status === "waiting") stuck.push(cardOf(job, r, names, now));
    else if (r.status === "queued") {
      const lateMin = (now.getTime() - moment(r)) / 60_000;
      (lateMin > job.graceMin ? stuck : running).push(cardOf(job, r, names, now));
    } else if (r.status === "running") running.push(cardOf(job, r, names, now));
    else if ((r.status === "failed" || r.status === "lost") && now.getTime() - T(r.finishedAt ?? r.startedAt) <= 24 * HOUR && !isSuperseded(r, runs)) stuck.push(cardOf(job, r, names, now));
    else if (r.status === "missed" && moment(r) >= dayStart && moment(r) < dayEnd) missedByJob.set(r.jobKey, [...(missedByJob.get(r.jobKey) ?? []), r]);
    else if (r.status === "ok" && T(r.finishedAt ?? r.startedAt) >= dayStart && T(r.finishedAt ?? r.startedAt) < dayEnd) done.push(r);
  }

  // one card a job for the missed ones: the latest slot, and how many before it
  const missed: NowCard[] = [...missedByJob.entries()].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => moment(b) - moment(a));
    return cardOf(jobOf.get(key)!, sorted[0]!, names, now, sorted.length - 1);
  });

  const byAt = (a: NowCard, b: NowCard) => T(a.at) - T(b.at);
  stuck.sort(byAt);
  missed.sort(byAt);
  running.sort((a, b) => T(b.at) - T(a.at));

  // what is still to come today: the slots the clock has not reached (the same laying-out as the board, so the two never disagree)
  const board = buildDayBoard({ jobs: input.jobs, runs, bounds, now, names });
  const coming = board.rows.filter((r) => r.state === "next");
  const upcoming: NowLine[] = coming.slice(0, LANE_LIMITS.upcoming).map((r) => ({ id: r.id, time: r.time, jobKey: r.jobKey, number: r.number, name: r.name, who: r.who, line: null, href: jobHref(r.jobKey) }));

  const doneSorted = [...done].sort((a, b) => T(b.finishedAt ?? b.startedAt) - T(a.finishedAt ?? a.startedAt));
  const doneLines: NowLine[] = doneSorted.slice(0, LANE_LIMITS.done).map((r) => {
    const job = jobOf.get(r.jobKey)!;
    return { id: r.id, time: timeOf(r.finishedAt ?? r.startedAt), jobKey: job.key, number: job.number, name: job.name, who: null, line: oneLine(r.summary), href: runHref(job.key, r.id) };
  });

  const team: TeamLine[] = input.tasks
    .map((t) => ({ t, due: dueState(t.dueAt, t.status, now) }))
    .filter((x): x is { t: ViewTask; due: "late" | "today" } => x.due === "late" || x.due === "today")
    .sort((a, b) => (a.due === b.due ? (a.t.dueAt ?? "9").localeCompare(b.t.dueAt ?? "9") : a.due === "late" ? -1 : 1))
    .map(({ t, due }) => ({ id: t.id, title: t.title, who: whoIs(t.assignee, names), due, dueAt: t.dueAt, href: "/tasks/team" }));

  const all: NowLane[] = [
    lane("stuck", stuck.length, stuck, [], []),
    lane("missed", missed.length, missed, [], []),
    lane("running", running.length, running, [], []),
    lane("upcoming", coming.length, [], upcoming, []),
    lane("team", team.length, [], [], team.slice(0, LANE_LIMITS.team)),
    lane("done", done.length, [], doneLines, []),
  ];
  return { lanes: all.filter((l) => l.total > 0), needs: stuck.length + missed.length, day: bounds.key };
}

function lane(key: LaneKey, total: number, cards: NowCard[], lines: NowLine[], tasks: TeamLine[]): NowLane {
  return { key, ...LANE_TITLES[key], total, cards, lines, tasks };
}

/** A result in one line: the first line of the summary, cut at 90 characters. */
export function oneLine(s: string | null | undefined, max = 90): string | null {
  const t = (s ?? "").trim().split(/\r?\n/)[0]?.trim() ?? "";
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

// ───────────────────────────── «جدول اليوم»: the board ─────────────────────────────

export interface BoardRow {
  id: string;
  /** ISO of the moment */
  at: string;
  /** «19:07» */
  time: string;
  jobKey: string;
  number: number | null;
  name: string;
  who: string;
  state: WordState;
  /** the line under the name: the result, or why it is where it is */
  line: string | null;
  runId: string | null;
  href: string;
  /** the moment has passed */
  past: boolean;
}

export interface BoardGroup {
  kind: "group";
  jobKey: string;
  number: number | null;
  name: string;
  total: number;
  /** «9 خلصت · 1 فاتت · 3 جاية» */
  summary: string;
  rows: BoardRow[];
}
export type BoardEntry = { kind: "row"; row: BoardRow } | BoardGroup;

export interface DayBoardData {
  /** the calendar key of the day the working day started on */
  day: string;
  from: string;
  to: string;
  rows: BoardRow[];
  entries: BoardEntry[];
  counts: Partial<Record<WordState, number>>;
  /** «خلصت 6 · فاتت 1 · شغّالة 1 · جاية 4» */
  headline: string;
}

/** A job with more moments than this in one day is folded into one line (02 §3.2). */
export const FOLD_OVER = 4;

const COUNT_ORDER: WordState[] = ["done", "missed", "run", "approval", "stuck", "queued", "fail", "lost", "skipped", "next"];
const COUNT_WORD: Partial<Record<WordState, string>> = { queued: "بانتظار", approval: "بدها موافقتك", stuck: "واقفة" };
const wordForCount = (s: WordState): string => COUNT_WORD[s] ?? STATE_WORDS[s].word;

/** «خلصت 6 · فاتت 1 · شغّالة 1 · جاية 4»: only the states that have something, in a fixed order, with the words of the dictionary. */
export function boardHeadline(counts: Partial<Record<WordState, number>>): string {
  return COUNT_ORDER.filter((s) => (counts[s] ?? 0) > 0)
    .map((s) => `${wordForCount(s)} ${counts[s]}`)
    .join(" · ");
}

export interface BoardInput {
  jobs: readonly ViewJob[];
  runs: readonly ViewRun[];
  /** the working day (06:00 → 06:00, Amman) */
  bounds: { from: Date; to: Date; key?: string };
  now: Date;
  names: Names;
  filter?: { who?: string | null; domain?: JobDomain | null };
}

/**
 * The working day as a board: every moment of every enabled job (its slots, from the same `dayLine` the day line draws), each with the ONE word of its state. The word
 * comes from the run the moment was answered by — `خلصت` · `شغّالة` · `واقفة` · `فاتت` — or `جاية` when no run has answered yet and the clock has not passed it. A run no slot
 * asked for (a manual one) is a line of its own. The day is 06:00 → 06:00 on the Amman clock, so a night round after midnight stays on the day it belongs to.
 */
export function buildDayBoard(input: BoardInput): DayBoardData {
  const { now, names } = input;
  const key = input.bounds.key ?? ammanKey(new Date(input.bounds.from.getTime() + 3 * HOUR));
  const jobs = input.jobs.filter((j) => (!input.filter?.who || j.assigneeKey === input.filter.who) && (!input.filter?.domain || j.domain === input.filter.domain));
  const jobOf = new Map(jobs.map((j) => [j.key, j]));
  const runOf = new Map(input.runs.map((r) => [r.id, r]));
  const lineJobs: LineJob[] = jobs.map((j) => ({ key: j.key, name: j.name, schedule: j.schedule, enabled: j.enabled, kind: j.kind, runsAt: j.runsAt, endsAt: j.endsAt, graceMin: j.graceMin }));
  const lineRuns: LineRun[] = input.runs.filter((r) => jobOf.has(r.jobKey)).map((r) => ({ id: r.id, jobKey: r.jobKey, startedAt: r.startedAt, status: r.status, trigger: r.trigger, scheduledFor: r.scheduledFor }));
  const line = dayLine(lineJobs, lineRuns, { from: input.bounds.from, to: input.bounds.to }, now);

  const rows: BoardRow[] = [];
  for (const d of line.dots) {
    const job = jobOf.get(d.jobKey);
    if (!job) continue;
    const run = d.runId ? runOf.get(d.runId) : undefined;
    const state: WordState = run ? stateOfRun(run) : d.state === "missed" ? "missed" : d.state === "coming" ? "next" : "next";
    // a finished or running run says what it did; a stuck one says why; a missed slot says nothing came; a moment yet to come says nothing
    const text = run ? (state === "done" ? oneLine(run.summary) : state === "skipped" ? null : sentenceOf(job, run, names, now)) : state === "missed" ? "ما وصل أي تسجيل" : null;
    rows.push({
      id: run ? run.id : `slot:${d.jobKey}:${d.at}`,
      at: d.at,
      time: timeOf(d.at),
      jobKey: job.key,
      number: job.number,
      name: job.name,
      who: whoIs(run?.assignee ?? run?.doneBy ?? job.assigneeKey, names),
      state,
      line: text,
      runId: run?.id ?? null,
      href: runHref(job.key, run?.id ?? null),
      past: T(d.at) < now.getTime() && state !== "run" && state !== "approval" && state !== "stuck" && state !== "queued",
    });
  }
  rows.sort((a, b) => T(a.at) - T(b.at) || a.name.localeCompare(b.name, "ar"));
  const counts: Partial<Record<WordState, number>> = {};
  for (const r of rows) counts[r.state] = (counts[r.state] ?? 0) + 1;
  return { day: key, from: input.bounds.from.toISOString(), to: input.bounds.to.toISOString(), rows, entries: foldBoard(rows), counts, headline: boardHeadline(counts) };
}

/**
 * A job with more than `max` moments in the day is ONE line: «جولة الفريق — 13 موعد: 9 خلصت · 1 فاتت · 3 جاية», opened with a press to show them (02 §3.2). The line stands where
 * the job's first moment is; the others of the day keep their time order.
 */
export function foldBoard(rows: readonly BoardRow[], max = FOLD_OVER): BoardEntry[] {
  const by = new Map<string, BoardRow[]>();
  for (const r of rows) by.set(r.jobKey, [...(by.get(r.jobKey) ?? []), r]);
  const out: BoardEntry[] = [];
  const placed = new Set<string>();
  for (const r of rows) {
    const mine = by.get(r.jobKey)!;
    if (mine.length <= max) {
      out.push({ kind: "row", row: r });
      continue;
    }
    if (placed.has(r.jobKey)) continue;
    placed.add(r.jobKey);
    const counts: Partial<Record<WordState, number>> = {};
    for (const m of mine) counts[m.state] = (counts[m.state] ?? 0) + 1;
    out.push({ kind: "group", jobKey: r.jobKey, number: r.number, name: r.name, total: mine.length, summary: boardHeadline(counts), rows: mine });
  }
  return out;
}

// ───────────────────────────── «كل المهام»: the list ─────────────────────────────

export const ALL_KINDS = ["recurring", "once", "window", "manual", "person"] as const;
export type AllKind = (typeof ALL_KINDS)[number];
export const ALL_KIND_AR: Record<AllKind, string> = { ...KIND_AR, person: "لشخص" };

export interface AllRow {
  id: string;
  /** a job (`Workflow`) or a person's task (`Task`) */
  type: "job" | "person";
  key: string;
  number: number | null;
  name: string;
  /** the time in words */
  when: string;
  who: string;
  whoKey: string | null;
  kind: AllKind;
  kindLabel: string;
  enabled: boolean;
  /** the lamp of the last run (a person's task: its state) */
  lamp: Lamp;
  /** the last run's word, so the lamp is never alone */
  word: WordState | null;
  domain: JobDomain;
  href: string;
}

export interface AllGroup {
  domain: JobDomain;
  label: string;
  rows: AllRow[];
}

export interface AllInput {
  jobs: readonly ViewJob[];
  /** the last run of each job, by key */
  last: ReadonlyMap<string, Pick<ViewRun, "status" | "nodeStates">>;
  tasks: readonly ViewTask[];
  names: Names;
  now: Date;
  filter?: { kind?: AllKind | null; who?: string | null };
}

const kindOfJob = (k: string): JobKind => (k === "once" || k === "window" || k === "manual" ? k : "recurring");

/**
 * One list, two groups (إعلانات · فريق وتشغيل). The people's tasks (`Task`) sit in the same list with the kind «لشخص» and open their own board. The numbers of the jobs are the
 * site's, so the list is in the order of the numbers; a person's task has none and comes after them. The filter is the kind and the person (`who` = the key).
 */
export function buildAll(input: AllInput): AllGroup[] {
  const { now, names } = input;
  const rows: AllRow[] = [];
  for (const j of input.jobs) {
    const kind = kindOfJob(String(j.kind));
    const last = input.last.get(j.key) ?? null;
    rows.push({
      id: `job:${j.key}`,
      type: "job",
      key: j.key,
      number: j.number,
      name: j.name,
      when: scheduleWords({ schedule: j.schedule, scheduleText: j.scheduleText, kind: kind, runsAt: j.runsAt }, now),
      who: whoIs(j.assigneeKey, names),
      whoKey: j.assigneeKey,
      kind,
      kindLabel: ALL_KIND_AR[kind],
      enabled: j.enabled,
      lamp: last ? runLamp(last) : "off",
      word: last ? stateOfRun(last) : null,
      domain: j.domain,
      href: jobHref(j.key),
    });
  }
  for (const t of input.tasks) {
    if (t.status === "done") continue;
    const due = dueState(t.dueAt, t.status, now);
    rows.push({
      id: `task:${t.id}`,
      type: "person",
      key: t.id,
      number: null,
      name: t.title,
      when: t.dueAt ? `لحد ${t.dueAt.slice(0, 10)}` : "بلا موعد",
      who: whoIs(t.assignee, names),
      whoKey: t.assignee,
      kind: "person",
      kindLabel: ALL_KIND_AR.person,
      enabled: true,
      lamp: due === "late" ? "fail" : due === "today" ? "wait" : "off",
      word: null,
      domain: "ops",
      href: "/tasks/team",
    });
  }
  const f = input.filter;
  const shown = rows.filter((r) => (!f?.kind || r.kind === f.kind) && (!f?.who || r.whoKey === f.who));
  const order = (a: AllRow, b: AllRow) => (a.number ?? 9999) - (b.number ?? 9999) || a.name.localeCompare(b.name, "ar");
  return (["ads", "ops"] as const)
    .map((d) => ({ domain: d, label: DOMAIN_AR[d], rows: shown.filter((r) => r.domain === d).sort(order) }))
    .filter((g) => g.rows.length > 0);
}

/** The people (keys) who appear in the list — for the filter chips. */
export function whoOptions(jobs: readonly Pick<ViewJob, "assigneeKey">[], tasks: readonly Pick<ViewTask, "assignee">[], names: Names): { key: string; label: string }[] {
  const keys = new Set<string>();
  for (const j of jobs) if (j.assigneeKey) keys.add(j.assigneeKey);
  for (const t of tasks) if (t.assignee) keys.add(t.assignee);
  return [...keys].sort().map((key) => ({ key, label: whoIs(key, names) }));
}

// ───────────────────────────── the page of a job ─────────────────────────────

/** How long a run lasted, in words: «دقيقتين» · «12 دقيقة» · «ساعة و10 دقايق». Null while it has not ended. */
export function durationWords(startedAt: string | null | undefined, endedAt: string | null | undefined): string | null {
  if (!startedAt || !endedAt) return null;
  const m = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 60_000));
  if (m < 1) return "أقل من دقيقة";
  if (m === 1) return "دقيقة";
  if (m === 2) return "دقيقتين";
  if (m < 11) return `${m} دقايق`;
  if (m < 60) return `${m} دقيقة`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  const hours = h === 1 ? "ساعة" : h === 2 ? "ساعتين" : `${h} ساعات`;
  return rest ? `${hours} و${rest} ${rest < 11 ? "دقايق" : "دقيقة"}` : hours;
}

/** «من 00:35 لـ 00:37 (دقيقتين)» — a step's time. Only what the stored state says: a step that has not started has no time. */
export function stepTimeWords(startedAt: string | null | undefined, endedAt: string | null | undefined): string | null {
  if (!startedAt) return null;
  if (!endedAt) return `من ${timeOf(startedAt)}`;
  const d = durationWords(startedAt, endedAt);
  return `من ${timeOf(startedAt)} لـ ${timeOf(endedAt)}${d ? ` (${d})` : ""}`;
}

export { isLiveRun, wordOf };
