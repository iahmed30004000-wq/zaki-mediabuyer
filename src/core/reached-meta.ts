/**
 * DID IT REACH META? (v6 · P0-2, R-22 · R-04) — one place that says so, pure.
 *
 * Nothing is written to Meta unless `META_WRITE_MODE=live` AND `META_LIVE_VERIFIED=1`; until then every change set and every video
 * upload runs as a trial: the item records what WOULD be sent. The screens, the Telegram messages and the morning report must
 * not say «انوقف» / «انرفع» / «وقّفت» / «خفّضت» about a trial — they say «تجربة: …». This file is the only place that decides.
 */

export interface MetaOutcome {
  /** a change set's mode as stored on the row: "live" | "dry_run" */
  writeMode?: string | null;
  /** a change set's state (when given, only an `executed` one counts) */
  state?: string | null;
  /** an upload's flag (`creative-upload` stats): true = nothing was sent */
  dryRun?: boolean | null;
}

/** True only when the thing was really sent to Meta (never for a trial, a failure or something still waiting). */
export function reachedMeta(x: MetaOutcome): boolean {
  if (x.dryRun !== undefined && x.dryRun !== null) return !x.dryRun;
  if (x.writeMode !== "live") return false;
  return x.state === undefined || x.state === null || x.state === "executed";
}

/** «تجربة: وقّفت الإعلان…» — the sentence as it is when it reached Meta, with the trial label in front when it did not. */
export function trialSentence(reached: boolean, sentence: string): string {
  return reached ? sentence : `تجربة: ${sentence}`;
}

/** Only the label for a trial; a word like «تنفّذ» stays as it is when it was real. */
export const TRIAL = "تجربة";
