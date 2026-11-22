/**
 * THE FULL STOP'S ANSWER (v6 · P0-2, R-04 · R-05), pure.
 *
 * The button used to write «انوقف» whatever happened. Now the server counts what really happened per campaign (the change set's items)
 * and the screen says ONE of four sentences — plus a fifth for the rare case that the stop is waiting for a person:
 *   انوقف N حملة · ما في حملات شغّالة · تجربة: ما انبعت لميتا · انوقف N وفشل M: …
 */
import { reachedMeta } from "./reached-meta";

export type StopState = "stopped" | "none" | "trial" | "partial" | "waiting";

export interface StopResult {
  state: StopState;
  /** campaigns that were paused (verified) — in a trial, the ones that would have been */
  done: number;
  failed: number;
  /** at least one pause really went to Meta */
  reachedMeta: boolean;
  /** the first reasons it failed, already in words */
  failures: string[];
  changeSetId: string | null;
  /** how many campaigns were targeted */
  objects: number;
}

export interface StopItem {
  objectId: string;
  verifyResult?: unknown;
}

const verifiedOf = (i: StopItem) => (i.verifyResult as { verified?: boolean } | null | undefined)?.verified === true;
const errorOf = (i: StopItem) => (i.verifyResult as { error?: string } | null | undefined)?.error ?? null;

/** What happened to a stop request, from the stored change set. `objects` is how many campaigns were running when it was asked. */
export function stopResult(input: { objects: number; changeSetId: string | null; csState: string; writeMode: string; csError: string | null; items: StopItem[] }): StopResult {
  const base = { changeSetId: input.changeSetId, objects: input.objects };
  if (input.objects === 0) return { ...base, state: "none", done: 0, failed: 0, reachedMeta: false, failures: [] };
  if (input.csState !== "executed" && input.csState !== "failed") return { ...base, state: "waiting", done: 0, failed: 0, reachedMeta: false, failures: [] };
  const done = input.items.filter(verifiedOf).length;
  // an item with no answer in a failed change set was never tried (the live write was refused before it started)
  const failedItems = input.items.filter((i) => !verifiedOf(i));
  const failed = failedItems.length;
  const failures = [...new Set(failedItems.map((i) => errorOf(i) ?? input.csError ?? "ما انعرف السبب").map((s) => s.replace(/^verify_mismatch:\s*/, "")))].slice(0, 2);
  const reached = reachedMeta({ writeMode: input.writeMode }) && done > 0;
  if (failed === 0 && done > 0) return { ...base, state: reached ? "stopped" : "trial", done, failed, reachedMeta: reached, failures };
  return { ...base, state: "partial", done, failed: failed || 1, reachedMeta: reached, failures: failures.length ? failures : [input.csError ?? "ما انعرف السبب"] };
}

/** The one sentence the screen shows. */
export function stopSentence(r: StopResult): string {
  switch (r.state) {
    case "stopped":
      return `انوقف ${r.done} حملة`;
    case "none":
      return "ما في حملات شغّالة";
    case "trial":
      return "تجربة: ما انبعت لميتا";
    case "waiting":
      return "الإيقاف بانتظار موافقة — شوفه بـ«بانتظارك»";
    case "partial":
      return `انوقف ${r.done} وفشل ${r.failed}: ${r.failures.join(" · ")}`;
  }
}
