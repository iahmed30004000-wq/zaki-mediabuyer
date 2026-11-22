/**
 * THE SCHEDULED JOBS, as the owner reads them (docs/rebuild/04-work.md §2): the number on the map, the status badge, the counters over the
 * map, the number of every branch (1.1, 1.2 …) and the schedule in words. Pure: the loaders hand in plain data; the clock is a parameter.
 * «مهمة مجدولة» is a `Workflow`; «فرع» is a node of its drawing; «تشغيل» is a `WorkflowRun`.
 */
import { nextRuns, parseCron } from "./cron";
import { stepOrder, type WfGraph } from "./workflow";

export const JOB_DOMAINS = ["ads", "ops"] as const;
export type JobDomain = (typeof JOB_DOMAINS)[number];
export const JOB_KINDS = ["recurring", "once", "window", "manual"] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export const JOB_ADVICE = ["keep", "merge", "cancel", "lighten", "think"] as const;
export type JobAdvice = (typeof JOB_ADVICE)[number];
export const JOB_DECISIONS = ["keep", "cancel", "merge"] as const;
export type JobDecision = (typeof JOB_DECISIONS)[number];

export const DOMAIN_AR: Record<JobDomain, string> = { ads: "إعلانات", ops: "فريق وتشغيل" };
export const KIND_AR: Record<JobKind, string> = { recurring: "متكررة", once: "مرة وحدة", window: "لفترة", manual: "عند الطلب" };
export const ADVICE_AR: Record<JobAdvice, string> = { keep: "خلّيها", merge: "ادمجها", cancel: "ألغيها", lighten: "خفّفها", think: "فكّر فيها" };

/** The seeded jobs and their place on the map. Claude's own map (`push_jobs`, P6) overrides these numbers. */
export const SEED_JOB_META: Record<string, { number: number; domain: JobDomain; kind: JobKind }> = {
  "night-round": { number: 1, domain: "ads", kind: "recurring" },
  "daily-check": { number: 2, domain: "ads", kind: "recurring" },
  "product-tests": { number: 3, domain: "ads", kind: "recurring" },
  "video-collection": { number: 4, domain: "ads", kind: "recurring" },
  "hermes-requests": { number: 5, domain: "ads", kind: "manual" },
  "tinnitus-experiment": { number: 6, domain: "ads", kind: "manual" },
  "breakeven-refresh": { number: 7, domain: "ads", kind: "manual" },
  "review-fixes": { number: 8, domain: "ads", kind: "manual" },
  "one-off-verdicts": { number: 9, domain: "ads", kind: "manual" },
  "team-round": { number: 10, domain: "ops", kind: "recurring" },
  "manager-comment": { number: 11, domain: "ops", kind: "recurring" },
  "leak-plan": { number: 12, domain: "ops", kind: "recurring" },
  "shipments-check": { number: 13, domain: "ops", kind: "recurring" },
  "stock-alerts": { number: 14, domain: "ops", kind: "recurring" },
  "girls-training": { number: 15, domain: "ops", kind: "recurring" },
  "basha-parcels": { number: 16, domain: "ops", kind: "manual" },
};

export interface JobLike {
  enabled: boolean;
  kind: JobKind;
  schedule: string | null;
  scheduleText: string | null;
  /** ISO */
  runsAt: string | null;
  endsAt: string | null;
  finishedAt: string | null;
}

export type BadgeKey = "paused" | "finished" | "failed" | "stuck" | "once" | "window" | "manual" | "on" | "running" | "queued" | "missed";
export type BadgeTone = "ok" | "warn" | "info" | "danger" | "neutral";
export interface JobBadge {
  key: BadgeKey;
  label: string;
  tone: BadgeTone;
}

/** One word for each state, the same on every screen (docs/rebuild-v6/03-look.md §9): «مفعّلة» is the switch, «شغّالة» is a run that is going. */
const BADGES: Record<BadgeKey, JobBadge> = {
  paused: { key: "paused", label: "مطفية", tone: "neutral" },
  finished: { key: "finished", label: "خلصت", tone: "neutral" },
  failed: { key: "failed", label: "وقفت", tone: "danger" },
  stuck: { key: "stuck", label: "واقفة — بدها حدا", tone: "warn" },
  once: { key: "once", label: "مرة وحدة جاية", tone: "warn" },
  window: { key: "window", label: "بتخلص لحالها", tone: "info" },
  manual: { key: "manual", label: "عند الطلب", tone: "neutral" },
  on: { key: "on", label: "مفعّلة", tone: "ok" },
  running: { key: "running", label: "شغّالة", tone: "info" },
  queued: { key: "queued", label: "بانتظار حدا ياخدها", tone: "warn" },
  missed: { key: "missed", label: "فاتت", tone: "neutral" },
};

/**
 * The badge of a job, the first line of the table that fits (04 §2): switched off → finished (a one-off that ran, or a window that ended) → a run is going now
 * («شغّالة») → the request of its last run waits in the queue («بانتظار <مين>», orange — not a stop) → its last run stopped or was lost → its last run waits and a
 * request is open → its last slot was missed → one-off → window → on request → «مفعّلة». `who` completes «بانتظار …».
 */
export function jobStatus(job: JobLike, lastRun: { status: string } | null, now: Date, hasOpenHandoff = false, who?: string | null): JobBadge {
  if (!job.enabled) return BADGES.paused;
  if (job.finishedAt || (job.kind === "window" && job.endsAt && Date.parse(job.endsAt) <= now.getTime())) return BADGES.finished;
  if (lastRun?.status === "running") return BADGES.running;
  if (lastRun?.status === "queued") return { ...BADGES.queued, label: who?.trim() ? `بانتظار ${who.trim()}` : BADGES.queued.label };
  if (lastRun?.status === "failed") return BADGES.failed;
  if (lastRun?.status === "lost") return { ...BADGES.failed, label: "انقطعت" };
  if (lastRun?.status === "waiting" && hasOpenHandoff) return BADGES.stuck;
  if (lastRun?.status === "missed") return BADGES.missed;
  if (job.kind === "once") return BADGES.once;
  if (job.kind === "window") return BADGES.window;
  if (job.kind === "manual") return BADGES.manual;
  return BADGES.on;
}

export interface JobCounters {
  total: number;
  /** the five numbers over the map */
  running: number;
  problem: number;
  upcoming: number;
  manual: number;
  off: number;
  byBadge: Record<BadgeKey, number>;
}

/** The counters over the map: a count of the badges, grouped in five (on or running · a problem · coming · on request · off or finished). A request that waits in the queue is not a problem. */
export function jobCounters(badges: readonly JobBadge[]): JobCounters {
  const by: Record<BadgeKey, number> = { paused: 0, finished: 0, failed: 0, stuck: 0, once: 0, window: 0, manual: 0, on: 0, running: 0, queued: 0, missed: 0 };
  for (const b of badges) by[b.key]++;
  return { total: badges.length, running: by.on + by.running + by.queued, problem: by.failed + by.stuck + by.missed, upcoming: by.once + by.window, manual: by.manual, off: by.paused + by.finished, byBadge: by };
}

/**
 * «1.1», «1.2»… for the branches of job N: its steps in the order they run (the trigger is not a branch), numbered from 1. A job with no
 * number yet has no branch numbers (they would change when it is numbered).
 */
export function branchNumbers(job: { number: number | null; graph: WfGraph }): Map<string, string> {
  const out = new Map<string, string>();
  if (job.number === null) return out;
  let i = 0;
  for (const n of stepOrder(job.graph)) {
    if (n.type === "trigger") continue;
    i++;
    out.set(n.id, `${job.number}.${i}`);
  }
  return out;
}

/**
 * How a step is named to an agent in a message of the site («الفرع 11.3» on the decision sheet): the number the owner sees on screen — the job's number and the
 * step's place in the order the steps RUN in. A job with no number, or a step the job no longer has, falls back to `<key>/<step id>` (W-19: the old text counted by the
 * order of the drawing's list, which is not the running order, so it could name another step).
 */
export function stepNumberOf(job: { key: string; number: number | null; graph: WfGraph }, nodeId: string): string {
  return branchNumbers(job).get(nodeId) ?? `${job.key}/${nodeId}`;
}

// ── the schedule in words ──

const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const mm = (m: number) => String(m).padStart(2, "0");

/** 12-hour clock in the way the owner says it: «12:35 بالليل» · «11:20 الصبح» · «3:00 العصر». */
export function clockWords(h: number, m: number): string {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const part = h === 0 || h >= 21 ? "بالليل" : h < 12 ? "الصبح" : h === 12 ? "الظهر" : h < 18 ? "العصر" : "المسا";
  return `${h12}:${mm(m)} ${part}`;
}

const dayPart = (h: number) => (h === 0 || h >= 21 ? "بالليل" : h < 12 ? "الصبح" : h === 12 ? "الظهر" : h < 18 ? "العصر" : "المسا");
const hourWord = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${dayPart(h)}`;
const ARAB_DATE = new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false });

/** The schedule as a sentence: the typed words, else read from the cron (every day · every hour from–to · every Thursday · N times), else the cron itself with the next run, else «عند الطلب». */
export function scheduleWords(job: { schedule: string | null; scheduleText: string | null; kind: JobKind; runsAt?: string | null }, now: Date): string {
  if (job.scheduleText) return job.scheduleText;
  if (job.kind === "once" && job.runsAt) return `مرة وحدة: ${ARAB_DATE.format(new Date(job.runsAt))}`;
  if (!job.schedule) return "عند الطلب";
  let c;
  try {
    c = parseCron(job.schedule);
  } catch {
    return `${job.schedule}`;
  }
  const everyDay = c.dom === null && c.dow === null && c.month.length === 12;
  const oneMinute = c.minute.length === 1;
  if (everyDay && c.hour.length === 1 && oneMinute) return `كل يوم ${clockWords(c.hour[0]!, c.minute[0]!)}`;
  if (c.dom === null && c.dow && c.dow.length === 1 && c.month.length === 12 && c.hour.length === 1 && oneMinute) return `كل ${DAYS[c.dow[0]!]} ${clockWords(c.hour[0]!, c.minute[0]!)}`;
  if (everyDay && oneMinute && c.hour.length >= 4) {
    const [first, second] = c.hour as [number, number];
    const last = c.hour[c.hour.length - 1]!;
    const step = second - first;
    const even = c.hour.every((h, i) => i === 0 || h - c.hour[i - 1]! === step);
    if (even) return `${step === 1 ? "كل ساعة" : step === 2 ? "كل ساعتين" : `كل ${step} ساعات`} من ${hourWord(first)} لـ${hourWord(last)} (${c.hour.length} جولة)`;
  }
  if (everyDay && c.hour.length * c.minute.length <= 8 && c.hour.length * c.minute.length >= 2) {
    const times = c.hour.flatMap((h) => c.minute.map((m) => `${h % 12 === 0 ? 12 : h % 12}:${mm(m)}`));
    return `${times.length} مرات: ${times.join(" · ")}`;
  }
  const next = nextRuns(job.schedule, now, 1)[0];
  return `${job.schedule}${next ? ` — الجاي: ${ARAB_DATE.format(next)}` : ""}`;
}
