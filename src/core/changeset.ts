/**
 * CHANGESETS (spec 10.2) — every change to Meta, in eight stages: propose → prepare → simulate → approve → execute →
 * verify → follow up → roll back. Pure: the allowed moves, the simulation and the loop guard. Persisting and calling
 * Meta live in src/server/changes.ts.
 */
export const STATES = ["draft", "simulated", "pending_approval", "approved", "executing", "executed", "failed", "rolled_back", "rejected"] as const;
export type ChangeState = (typeof STATES)[number];

const MOVES: Record<ChangeState, readonly ChangeState[]> = {
  draft: ["simulated", "rejected"],
  simulated: ["pending_approval", "approved", "rejected"],
  pending_approval: ["approved", "rejected"],
  approved: ["executing"],
  executing: ["executed", "failed"],
  executed: ["rolled_back"],
  failed: ["approved"], // a person may retry
  rolled_back: [],
  rejected: [],
};

export function canMove(from: ChangeState, to: ChangeState): boolean {
  return MOVES[from].includes(to);
}

export function assertMove(from: ChangeState, to: ChangeState): void {
  if (!canMove(from, to)) throw new Error(`a change cannot go from ${from} to ${to}`);
}

export type Op = "pause" | "resume" | "set_budget" | "create";

export interface ChangeItemDraft {
  op: Op;
  objectType: "campaign" | "adset" | "creative" | "ad";
  /** the Meta id — or `{{ref:x}}` for an object this change creates (filled when Meta answers) */
  objectId: string;
  /** daily budget in USD for set_budget */
  before: { status?: string; dailyBudget?: number };
  /** for create: the POST target, the exact payload and the ref the new id is kept under; dailyBudget counts as new spend */
  after: { status?: string; dailyBudget?: number; endpoint?: string; payload?: Record<string, unknown>; ref?: string };
}

/** The money a change moves per day (positive = more spend). Pausing an ad set saves its budget. */
export function spendDeltaDaily(items: ChangeItemDraft[]): number {
  let delta = 0;
  for (const i of items) {
    if (i.op === "set_budget") delta += (i.after.dailyBudget ?? 0) - (i.before.dailyBudget ?? 0);
    if (i.op === "pause" && i.before.dailyBudget) delta -= i.before.dailyBudget;
    if (i.op === "resume" && i.after.dailyBudget) delta += i.after.dailyBudget;
    if (i.op === "create" && i.after.dailyBudget) delta += i.after.dailyBudget;
  }
  return Math.round(delta * 100) / 100;
}

/** A change Meta treats as «significant» (resets learning): budget moves above 20%, resuming after 7 days… (spec 5.6). */
export function isSignificant(i: ChangeItemDraft): boolean {
  if (i.op === "set_budget") {
    const b = i.before.dailyBudget ?? 0;
    const a = i.after.dailyBudget ?? 0;
    return b === 0 || Math.abs(a - b) / b > 0.2;
  }
  return i.op === "resume";
}

export interface SimulationContext {
  /** what the accounts spend today so far + all approved daily budgets */
  plannedSpendToday: number;
  dailyCap: number | null;
  /** hours since the last significant edit (or launch) per object id */
  hoursSinceSignificant: Record<string, number>;
  /** object ids with another change waiting or running */
  busyObjects: Set<string>;
  /** hours since this rule last acted on this object (undefined = never) */
  hoursSinceRuleActed?: number;
  cooldownHours?: number;
  /** a safety change (pause / reduce) is allowed through the learning guard and the cap */
  safety: boolean;
}

export interface Simulation {
  ok: boolean;
  spendDeltaDaily: number;
  spendTodayAfter: number;
  checks: { key: string; ok: boolean; note: string }[];
}

export const LEARNING_GUARD_HOURS = 72;

/** «جرّب»: everything checked, nothing changed. */
export function simulate(items: ChangeItemDraft[], ctx: SimulationContext): Simulation {
  const delta = spendDeltaDaily(items);
  const after = ctx.plannedSpendToday + Math.max(0, delta);
  const checks: Simulation["checks"] = [];
  const add = (key: string, ok: boolean, note: string) => checks.push({ key, ok, note });

  if (delta > 0) {
    if (ctx.dailyCap === null) add("cap", false, "السقف اليومي مش معروف — ولا زيادة صرف");
    else add("cap", after <= ctx.dailyCap, `صرف اليوم المتوقع ${after.toFixed(2)}$ من سقف ${ctx.dailyCap.toFixed(2)}$`);
  } else add("cap", true, "ما بيزيد الصرف");

  const fresh = items.filter((i) => isSignificant(i) && (ctx.hoursSinceSignificant[i.objectId] ?? Infinity) < LEARNING_GUARD_HOURS);
  add("learning", ctx.safety || fresh.length === 0, fresh.length ? `تعديل جوهري خلال ${LEARNING_GUARD_HOURS} ساعة من آخر تعديل` : "ما بيكسر مرحلة التعلّم");

  const busy = items.filter((i) => ctx.busyObjects.has(i.objectId));
  add("conflict", busy.length === 0, busy.length ? "في تغيير تاني على نفس العنصر لسا ما خلص" : "ما في تعارض");

  if (ctx.cooldownHours !== undefined && ctx.hoursSinceRuleActed !== undefined) {
    add("cooldown", ctx.hoursSinceRuleActed >= ctx.cooldownHours, `القاعدة تصرفت قبل ${Math.round(ctx.hoursSinceRuleActed)} ساعة (التهدئة ${ctx.cooldownHours})`);
  }
  return { ok: checks.every((c) => c.ok), spendDeltaDaily: delta, spendTodayAfter: after, checks };
}

/**
 * THE LOOP GUARD (spec 10.4): if the direction on one object flipped twice within 48 h (down-up-down, up-down-up),
 * freeze it for the owner's review.
 */
export function flipFlopped(history: { at: Date; direction: "up" | "down" }[], now: Date, windowHours = 48): boolean {
  const recent = history.filter((h) => now.getTime() - h.at.getTime() <= windowHours * 3_600_000).sort((a, b) => a.at.getTime() - b.at.getTime());
  let flips = 0;
  for (let i = 1; i < recent.length; i++) if (recent[i]!.direction !== recent[i - 1]!.direction) flips++;
  return flips >= 2;
}

export const directionOf = (op: Op, before?: number, after?: number): "up" | "down" =>
  op === "pause" ? "down" : op === "resume" || op === "create" ? "up" : (after ?? 0) >= (before ?? 0) ? "up" : "down";
