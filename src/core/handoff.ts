/**
 * THE HANDOFF QUEUE (v3 · F) — pure. Work the app cannot do itself goes here, with everything needed to do it:
 *   · a run the owner started with «شغّل هلق» (Claude does the jobs; the app is the owner's window on them)
 *   · a step that failed, timed out, waits for an answer, or waits on a connection that is not there yet
 * Someone (Claude through MCP or the REST API, a person on the site) takes it, does it, and answers; the answer moves
 * the workflow's run on. Shown on الورك فلو as «متوقف — Claude بيكمّلها»; the owner can give it to someone else.
 */
import { stepOrder, type WfGraph, type WfNode } from "./workflow";

export const HANDOFF_KINDS = ["manual_run", "node_failed", "missing_connection", "timeout", "needs_input"] as const;
export type HandoffKind = (typeof HANDOFF_KINDS)[number];

export const KIND_AR: Record<HandoffKind, string> = {
  manual_run: "المالك طلب تشغيلها",
  node_failed: "خطوة فشلت",
  missing_connection: "ربط ناقص",
  timeout: "انتهت مهلتها",
  needs_input: "بدها معلومة",
};

export const HANDOFF_STATUSES = ["open", "claimed", "done", "cancelled"] as const;
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];
export const STATUS_AR: Record<HandoffStatus, string> = { open: "بانتظار حدا ياخدها", claimed: "انأخدت", done: "خلصت", cancelled: "انلغت" };

/** Who a handoff can be given to from the site. Any other key (a person's) is allowed through the API. */
export const ASSIGNEES = [
  { key: "claude", label: "Claude" },
  { key: "claude_desktop", label: "Claude Desktop" },
  { key: "hermes", label: "هيرمز" },
  { key: "muse", label: "ميوز" },
] as const;

export const assigneeLabel = (key: string): string => ASSIGNEES.find((a) => a.key === key)?.label ?? key;

/** Anything that is Claude (the MCP session, the desktop app, a scheduled task) reads the same queue. */
export const isClaude = (assignee: string): boolean => assignee.startsWith("claude");

const MOVES: Record<HandoffStatus, readonly HandoffStatus[]> = {
  open: ["claimed", "done", "cancelled"],
  // back to open = given to someone else
  claimed: ["open", "done", "cancelled"],
  done: [],
  cancelled: [],
};
export const canMove = (from: HandoffStatus, to: HandoffStatus): boolean => MOVES[from].includes(to);

export type RunAfter = "running" | "ok" | "failed";

/**
 * What the run becomes when its handoff is answered. A run the owner asked for ends with the answer; a step that was
 * stuck only unblocks it — whoever answered keeps going and reports the rest with log_run — unless they say how it ended.
 */
export function runStatusAfter(kind: HandoffKind, said?: RunAfter): RunAfter {
  return said ?? (kind === "manual_run" ? "ok" : "running");
}

/** The step a manual run waits on: the first one after the trigger (what Claude has to start with). */
export function firstStep(g: WfGraph): WfNode | undefined {
  return stepOrder(g).find((n) => n.type !== "trigger" && !n.disabled);
}

/** The ref a handoff's run is logged under — the same ref goes to log_run, so the job's steps land on this run. */
export function newRunRef(kind: HandoffKind, now: Date, rand: string): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  return `${kind === "manual_run" ? "manual" : "handoff"}-${stamp}-${rand.replace(/[^a-z0-9]/gi, "").slice(0, 4).toLowerCase() || "x"}`;
}

export const waitingMinutes = (createdAtIso: string, nowMs: number): number => Math.max(0, Math.round((nowMs - Date.parse(createdAtIso)) / 60_000));

/** «من 5 دقايق» / «من ساعتين» / «من يومين» — how long it has been waiting, in the owner's words. */
export function waitingText(minutes: number): string {
  if (minutes < 1) return "هلأ";
  if (minutes < 60) return `من ${minutes} دقيقة`;
  const h = Math.round(minutes / 60);
  if (h < 24) return h === 1 ? "من ساعة" : h === 2 ? "من ساعتين" : `من ${h} ساعات`;
  const d = Math.round(h / 24);
  return d === 1 ? "من يوم" : d === 2 ? "من يومين" : `من ${d} أيام`;
}
