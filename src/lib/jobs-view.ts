/**
 * The scheduled jobs as the map and the job page read them: each one with its number, badge, schedule in words, branches (numbered,
 * the switched-off struck), and its last result or its next run. Plain data — the pure rules are in src/core/jobs.ts.
 */
import { ADVICE_AR, DOMAIN_AR, KIND_AR, branchNumbers, jobCounters, jobStatus, scheduleWords, type JobAdvice, type JobBadge, type JobCounters, type JobDomain, type JobKind } from "@/core/jobs";
import { EXECUTOR_AR, stepOrder, type Executor, type WfGraph } from "@/core/workflow";
import { listHandoffs } from "@/server/handoffs";
import type { WorkflowCard } from "@/server/workflows";
import { loadWorkflowCards } from "./workflow-view";

export interface BranchView {
  id: string;
  /** «7.1», or null while the job has no number */
  number: string | null;
  label: string;
  desc: string | null;
  disabled: boolean;
}

export interface JobView {
  key: string;
  number: number | null;
  name: string;
  domain: JobDomain;
  domainLabel: string;
  kind: JobKind;
  kindLabel: string;
  description: string | null;
  enabled: boolean;
  badge: JobBadge;
  /** the schedule in words */
  words: string;
  /** who runs it: «Claude (MCP)» */
  runner: string;
  branches: BranchView[];
  /** the last run: how it ended and its one line */
  last: { ok: boolean | null; at: string; summary: string | null } | null;
  /** ISO of the next run, if there is one */
  next: string | null;
  advice: { key: JobAdvice; label: string; text: string | null } | null;
  decision: string | null;
  facts: { runsFrom: string | null; origin: string | null; touches: string[]; talksTo: string[] };
  note: string | null;
  graph: WfGraph;
  source: string;
}

const isAdvice = (v: string | null): v is JobAdvice => v === "keep" || v === "merge" || v === "cancel" || v === "lighten" || v === "think";

export function toJobView(c: WorkflowCard, stuck: ReadonlySet<string>, now: Date): JobView {
  const domain: JobDomain = c.domain === "ops" ? "ops" : "ads";
  const kind: JobKind = c.kind === "once" || c.kind === "window" || c.kind === "manual" ? c.kind : "recurring";
  const like = { enabled: c.enabled, kind, schedule: c.schedule, scheduleText: c.scheduleText, runsAt: c.runsAt, endsAt: c.endsAt, finishedAt: c.finishedAt };
  const numbers = branchNumbers({ number: c.number, graph: c.graph });
  const branches: BranchView[] = stepOrder(c.graph)
    .filter((n) => n.type !== "trigger")
    .map((n) => ({ id: n.id, number: numbers.get(n.id) ?? null, label: n.label, desc: n.desc ?? null, disabled: !!n.disabled }));
  return {
    key: c.key,
    number: c.number,
    name: c.name,
    domain,
    domainLabel: DOMAIN_AR[domain],
    kind,
    kindLabel: KIND_AR[kind],
    description: c.description,
    enabled: c.enabled,
    badge: jobStatus(like, c.lastRun, now, stuck.has(c.key)),
    words: scheduleWords({ schedule: c.schedule, scheduleText: c.scheduleText, kind, runsAt: c.runsAt }, now),
    runner: EXECUTOR_AR[c.executor as Executor] ?? c.executor,
    branches,
    last: c.lastRun ? { ok: c.lastRun.status === "ok" ? true : c.lastRun.status === "failed" ? false : null, at: c.lastRun.startedAt, summary: c.lastRun.summary } : null,
    next: c.nextRun,
    advice: isAdvice(c.advice) ? { key: c.advice, label: ADVICE_AR[c.advice], text: c.adviceText } : null,
    decision: c.decision,
    facts: { runsFrom: c.runsFrom, origin: c.origin, touches: c.touches, talksTo: c.talksTo },
    note: c.note,
    graph: c.graph,
    source: c.source,
  };
}

export interface JobsData {
  demo: boolean;
  jobs: JobView[];
  counters: JobCounters;
}

/** Every job, numbered ones first in the order of their numbers; the badge counts feed the counters over the map. */
export async function loadJobs(now = new Date()): Promise<JobsData> {
  const { cards, demo } = await loadWorkflowCards(now);
  const open = demo ? [] : await listHandoffs({ status: ["open", "claimed"], limit: 200 });
  const stuck = new Set(open.map((h) => h.workflowKey));
  const jobs = cards
    .filter((c) => c.source !== "archived")
    .map((c) => toJobView(c, stuck, now))
    .sort((a, b) => (a.number ?? 9999) - (b.number ?? 9999) || a.name.localeCompare(b.name));
  return { demo, jobs, counters: jobCounters(jobs.map((j) => j.badge)) };
}
