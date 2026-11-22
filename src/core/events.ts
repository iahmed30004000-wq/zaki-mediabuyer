/**
 * THE EVENTS OF THE ENGINE, as the owner is told about them — pure (docs/rebuild-v6/01-model.md §10, docs/rebuild-v6/05-notify.md §4).
 * Every event becomes ONE `Notification` row with a key that makes it unique (the same event twice is one): the key of a run's event carries the
 * run's id. The row is written here; SENDING it is the dispatcher's (P7) — until then nothing about the delivery changes.
 *
 * The title starts with the thing itself and is 45 characters at most; the second line says why and what happens when he taps. No customer's
 * detail ever gets in: only the name of the job, a time and a count.
 */
import { waitingText } from "./handoff";

export const RUN_EVENTS = ["run.missed", "run.lost", "run.stuck", "run.failed", "run.done"] as const;
/** The events the engine knows by name; the others (stock · report · backup · worker · sync · approval · agent) are wired by the phases that own them. */
export const EVENT_KINDS = [...RUN_EVENTS, "approval.new", "stock.red", "stock.orange", "report.morning", "agent.silent", "backup.failed", "worker.down", "sync.failed"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export type RunEventKind = (typeof RUN_EVENTS)[number];

/** Which word of `Workflow.notifyOn` switches an event on: «انقطعت» counts as a failure. */
export const NOTIFY_FLAG: Record<RunEventKind, "missed" | "stuck" | "failed" | "done"> = {
  "run.missed": "missed",
  "run.lost": "failed",
  "run.stuck": "stuck",
  "run.failed": "failed",
  "run.done": "done",
};

export interface EventRow {
  urgency: "red" | "orange" | "yellow";
  title: string;
  body: string;
  href: string;
  /** unique per event: «run.missed:<run id>» */
  key: string;
}

export const TITLE_MAX = 45;
const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, Math.max(1, n - 1)).trimEnd()}…`);
/** «<name> <verb>» in at most 45 characters: the name gives way, the verb never does. */
export const titleOf = (name: string, verb: string): string => `${cut(name.trim(), TITLE_MAX - verb.length - 1)} ${verb}`;

const clock = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Amman", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

export interface RunEventFacts {
  kind: RunEventKind;
  runId: string;
  jobKey: string;
  jobName: string;
  /** the slot the run answers, if it has one */
  scheduledFor?: Date | null;
  /** minutes of silence (lost) or of waiting (stuck) */
  minutes?: number;
  /** who carries it out, in words: «Claude الرئيسي» */
  who?: string | null;
  /** a line from the run (the summary or the error of the step that failed), already free of customer data */
  detail?: string | null;
  queued?: boolean;
}

/** Does the job want this event? `done` is only for jobs that ask for it; the others are on unless the owner took them off. */
export const wantsEvent = (kind: RunEventKind, notifyOn: readonly string[] | null | undefined): boolean => (notifyOn ?? ["missed", "stuck", "failed"]).includes(NOTIFY_FLAG[kind]);

/** The row of a run's event. */
export function runEventRow(f: RunEventFacts): EventRow {
  const href = `/tasks/${f.jobKey}`;
  const key = `${f.kind}:${f.runId}`;
  const slot = f.scheduledFor ? ` ${clock(f.scheduledFor)}` : "";
  switch (f.kind) {
    case "run.missed":
      return { urgency: "orange", title: titleOf(f.jobName, `فاتت${slot}`), body: cut(`ما وصل أي تسجيل بعد موعدها${f.who ? ` — ${f.who} ما بدأ` : ""}. اضغط تشوف التشغيل وتقرر.`, 200), href, key };
    case "run.lost":
      return { urgency: "orange", title: titleOf(f.jobName, "انقطعت"), body: cut(`آخر خبر ${f.who ? `من ${f.who} ` : ""}${waitingText(f.minutes ?? 0)}. اضغط تشوف وين وقفت.`, 200), href, key };
    case "run.stuck":
      return {
        urgency: "orange",
        title: titleOf(f.jobName, f.queued ? "ما حدا استلمها" : "واقفة"),
        body: cut(f.queued ? `مطلوبة ${waitingText(f.minutes ?? 0)} ${f.who ? `من ${f.who} ` : ""}ولسا ما حدا بدأها. اضغط تسلّمها لغيره.` : `بانتظار حدا ${waitingText(f.minutes ?? 0)}. اضغط تشوف شو بدها.`, 200),
        href,
        key,
      };
    case "run.failed":
      return { urgency: "orange", title: titleOf(f.jobName, "فشلت"), body: cut(`${f.detail ? `${f.detail}. ` : ""}اضغط تشوف الخطوة اللي وقفت وتعيدها.`, 200), href, key };
    case "run.done":
      return { urgency: "yellow", title: titleOf(f.jobName, "خلصت"), body: cut(f.detail ?? "خلصت بلا مشاكل.", 200), href, key };
  }
}
