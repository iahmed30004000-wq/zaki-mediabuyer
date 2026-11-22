/**
 * THE HANDOFF QUEUE (v3 · F) — pure. Work the app cannot do itself goes here, with everything needed to do it:
 *   · a run the owner started with «شغّل هلق» (Claude does the jobs; the app is the owner's window on them)
 *   · a step that failed, timed out, waits for an answer, or waits on a connection that is not there yet
 * Someone (Claude through MCP or the REST API, a person on the site) takes it, does it, and answers; the answer moves
 * the workflow's run on. Shown on الورك فلو as «متوقف — Claude بيكمّلها»; the owner can give it to someone else.
 */
import { stepOrder, type WfGraph, type WfNode } from "./workflow";

export const HANDOFF_KINDS = ["manual_run", "node_failed", "missing_connection", "timeout", "needs_input", "resume"] as const;
export type HandoffKind = (typeof HANDOFF_KINDS)[number];
/** What an agent may open itself: «resume» is the site's (after the owner's decision or his retry button). */
export const AGENT_HANDOFF_KINDS = ["manual_run", "node_failed", "missing_connection", "timeout", "needs_input"] as const;

export const KIND_AR: Record<HandoffKind, string> = {
  manual_run: "المالك طلب تشغيلها",
  node_failed: "خطوة فشلت",
  missing_connection: "ربط ناقص",
  timeout: "انتهت مهلتها",
  needs_input: "بدها معلومة",
  resume: "كمّل من هون",
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

// ───────────────────────────── v6: who, until when, and how it is answered (docs/rebuild-v6/01-model.md §7) ─────────────────────────────

/**
 * Who a request for this job goes to: the job's own agent (`Workflow.assigneeKey`). A job nobody is tied to, or one the site carries out itself
 * (`site` — nobody in the queue takes that), goes to «claude», as every request always did.
 */
export const queueAssignee = (assigneeKey: string | null | undefined): string => (!assigneeKey || assigneeKey === "site" ? "claude" : assigneeKey);

/** A request the owner asked for by hand waits this long for someone to take it. */
export const MANUAL_EXPIRY_HOURS = 6;

/** When a request nobody took ends: a scheduled one at its slot + graceMin, a manual one 6 hours after it was asked. */
export function expiryFor(opts: { scheduledFor?: Date | null; graceMin: number; now: Date }): Date {
  if (opts.scheduledFor) return new Date(opts.scheduledFor.getTime() + opts.graceMin * 60_000);
  return new Date(opts.now.getTime() + MANUAL_EXPIRY_HOURS * 3_600_000);
}

/** Taken but silent after this, it reopens: the moment of the taking (or of the last word from the run) + maxRunMin. */
export const leaseUntil = (from: Date, maxRunMin: number): Date => new Date(from.getTime() + maxRunMin * 60_000);

/** An open request whose time is up is not offered to anyone any more. */
export const isExpired = (h: { status: string; expiresAt: Date | null }, now: Date): boolean => h.status === "open" && !!h.expiresAt && h.expiresAt.getTime() <= now.getTime();

/**
 * Is this token the one the request was given to? The request's assignee is «claude» · «claude_desktop» · «claude_task» · «hermes» · «muse» or a
 * person's key; the token's actor is a directory key («claude» covers every kind of Claude, as the queue always has). A token that is not tied
 * to anybody (`actorKey` null, an old token) is treated as Claude — the only one the queue had before — and never as anyone else.
 */
export function actorOwnsAssignee(actorKey: string | null | undefined, assignee: string): boolean {
  const me = actorKey ?? "claude";
  return me === assignee || (isClaude(me) && isClaude(assignee));
}

export type Gate = { ok: true } | { ok: false; status: number; message: string };

/** May this caller take the request? Only whoever it was given to (the owner, signed in, may take it for anyone). */
export function claimGate(h: { assignee: string }, who: { actorKey: string | null; owner?: boolean }): Gate {
  if (who.owner || actorOwnsAssignee(who.actorKey, h.assignee)) return { ok: true };
  return { ok: false, status: 403, message: `هالتسليم مكلّف فيه ${assigneeLabel(h.assignee)} — مش لهالتوكن` };
}

/**
 * May this caller answer it? With the claim code the request was taken with: yes. Without one: only whoever it was given to (a token's own
 * actor) — and the owner, signed in. A wrong code is never accepted, even from the right actor.
 */
export function completeGate(h: { assignee: string; claimNonce: string | null }, who: { actorKey: string | null; claim?: string; owner?: boolean }): Gate {
  if (who.owner) return { ok: true };
  if (who.claim !== undefined) {
    if (h.claimNonce && who.claim === h.claimNonce) return { ok: true };
    return { ok: false, status: 403, message: "رمز الاستلام غلط — الرمز اللي إجاك بـ claim_handoff" };
  }
  if (actorOwnsAssignee(who.actorKey, h.assignee)) return { ok: true };
  return { ok: false, status: 403, message: `هالتسليم مكلّف فيه ${assigneeLabel(h.assignee)} — ابعت رمز الاستلام (claim) أو استعمل توكنه` };
}
