/**
 * WHO MAY ANSWER A DECISION, AND WHEN IT ENDS — pure (docs/rebuild-v6/01-model.md §8 · 00-audit W-10). The site decides who may approve from what the
 * request carries, never from a free-text field the agent chose: the `kind` is the agent's word, the amount and the shape of the request are facts.
 */

export const MESSAGE_KIND = "send_message";

export interface ApprovalFacts {
  kind: string | null;
  /** dollars, when the request names an amount */
  amount: number | null;
  /** the «ليش؟» page; a message to the team carries its text here */
  analysis?: { text?: unknown } | null;
}

/**
 * A message to the team is the operations manager's to approve — and only when it IS one: the kind says so, no money is named, and the request
 * carries the text that would be sent. Anything else (money, stock, a cap, any request whose kind the agent invented) is the owner's.
 */
export function isTeamMessage(a: ApprovalFacts): boolean {
  if (a.kind !== MESSAGE_KIND) return false;
  if (a.amount !== null && a.amount !== 0) return false;
  const text = a.analysis?.text;
  return typeof text === "string" && text.trim().length > 0 && text.length <= 2000;
}

export type ApprovalCapability = "owner_only" | "ops.send";

export const approvalCapabilityOf = (a: ApprovalFacts): ApprovalCapability => (isTeamMessage(a) ? "ops.send" : "owner_only");

const MIN_POSTPONE_TTL_MIN = 60;

/**
 * A request that is postponed does not end before it comes back (W-10: it used to end at its first expiry, silently, while it slept). If its
 * expiry falls before the moment it returns, the expiry moves to that moment plus the time it was first given (at least an hour), so it can still
 * be answered; an expiry later than that stays. No expiry stays none.
 */
export function expiryAfterPostpone(a: { expiresAt: Date | null; createdAt: Date; until: Date }): Date | null {
  if (!a.expiresAt) return null;
  if (a.expiresAt.getTime() > a.until.getTime()) return a.expiresAt;
  const ttlMin = Math.max(MIN_POSTPONE_TTL_MIN, Math.round((a.expiresAt.getTime() - a.createdAt.getTime()) / 60_000));
  return new Date(a.until.getTime() + ttlMin * 60_000);
}
