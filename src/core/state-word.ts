/**
 * ONE WORD FOR EACH STATE (docs/rebuild-v6/03-look.md §9). The same lamp and the same word in every screen: «خلصت» is never «تمت» somewhere else.
 * `StateWord` draws it; this file decides it. «موقوفة» and «متوقفة» are gone (they differ by one letter) — `fail` is «وقفت».
 */
import type { Lamp } from "./run-state";

/** The colour of the word: a STATE, nothing else. */
export type WordTone = "ok" | "info" | "warn" | "danger" | "muted";

export const WORD_STATES = [
  "done", //      ok      — خلصت
  "run", //       running — شغّالة
  "approval", //  waiting on the owner — بدها موافقتك
  "stuck", //     waiting on a step that failed — واقفة — بدها حدا
  "fail", //      failed — وقفت
  "missed", //    the time came, nothing started — فاتت
  "lost", //      the news stopped — انقطعت
  "skipped", //   انتخطت
  "queued", //    بانتظار <مين>
  "next", //      جاية
  "job_on", //    the job's switch is on — مفعّلة
  "job_off", //   the job's switch is off — مطفية
] as const;
export type WordState = (typeof WORD_STATES)[number];

export interface WordSpec {
  lamp: Lamp;
  word: string;
  tone: WordTone;
}

export const STATE_WORDS: Record<WordState, WordSpec> = {
  done: { lamp: "done", word: "خلصت", tone: "ok" },
  run: { lamp: "run", word: "شغّالة", tone: "info" },
  approval: { lamp: "wait", word: "بدها موافقتك", tone: "warn" },
  stuck: { lamp: "wait", word: "واقفة — بدها حدا", tone: "warn" },
  fail: { lamp: "fail", word: "وقفت", tone: "danger" },
  missed: { lamp: "missed", word: "فاتت", tone: "muted" },
  lost: { lamp: "fail", word: "انقطعت", tone: "danger" },
  skipped: { lamp: "off", word: "انتخطت", tone: "muted" },
  queued: { lamp: "wait", word: "بانتظار", tone: "warn" },
  next: { lamp: "off", word: "جاية", tone: "muted" },
  job_on: { lamp: "done", word: "مفعّلة", tone: "ok" },
  job_off: { lamp: "off", word: "مطفية", tone: "muted" },
};

/**
 * The word of a state, with whoever it waits for when it is a queue: `queued` + «Claude الرئيسي» is «بانتظار Claude الرئيسي»;
 * without a name it is «بانتظار حدا ياخدها».
 */
export function wordOf(state: WordState, who?: string | null): WordSpec {
  const spec = STATE_WORDS[state];
  if (state !== "queued") return spec;
  const name = who?.trim();
  return { ...spec, word: name ? `بانتظار ${name}` : "بانتظار حدا ياخدها" };
}

/**
 * The word state of a RUN, from what the site knows: its status, and — for a run that waits — what it waits on (a decision of the owner,
 * or a step that failed and needs somebody).
 */
export function runWordState(status: string, waitingOn?: "approval" | "step" | null): WordState {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "run";
    case "waiting":
      return waitingOn === "step" ? "stuck" : "approval";
    case "ok":
      return "done";
    case "failed":
      return "fail";
    case "missed":
      return "missed";
    case "lost":
      return "lost";
    case "skipped":
      return "skipped";
    default:
      return "next";
  }
}
