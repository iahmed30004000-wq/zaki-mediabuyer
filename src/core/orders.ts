/**
 * THE STANDING ORDERS (docs/rebuild/04-work.md §5): a temporary instruction from the owner that touches jobs — «لا في فيديو جديد لحد ما أقلك
 * ارجع». It is data on the site and every job reads it at the start of its run. Pure rules: when an order is active, which jobs and products it
 * touches, and who may start it. The site never executes an order; it stores it, shows it, and hands it to Claude.
 *
 *   بيشدّد (restrict: stop, don't, lower)   active at once, from any source
 *   بيرخّي (allow: raise, allow, go back)   from the owner on the site: active; from anyone else: waits for his yes («بانتظارك»)
 *   ending an order that tightens           is a loosening: from Claude it waits for the owner's yes too
 */

export const ORDER_EFFECTS = ["restrict", "allow"] as const;
export type OrderEffect = (typeof ORDER_EFFECTS)[number];
export const ORDER_DOMAINS = ["ads", "ops", "all"] as const;
export type OrderDomain = (typeof ORDER_DOMAINS)[number];
export const ORDER_STATUSES = ["pending", "active", "ended", "rejected"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type OrderSource = "ui" | "mcp";

export const EFFECT_AR: Record<OrderEffect, string> = { restrict: "بيشدّد", allow: "بيرخّي" };
export const DOMAIN_AR: Record<OrderDomain, string> = { ads: "إعلانات", ops: "تشغيل", all: "الكل" };

export interface OrderLike {
  status: string;
  effect: string;
  domain: string;
  jobKeys: readonly string[];
  products: readonly string[];
  /** ISO */
  startsAt: string;
  endsAt: string | null;
}

/** An order is in force: it was approved/started, its start has come, and its end (if it has one) has not. */
export function isActive(o: Pick<OrderLike, "status" | "startsAt" | "endsAt">, now: Date): boolean {
  if (o.status !== "active") return false;
  if (Date.parse(o.startsAt) > now.getTime()) return false;
  return !o.endsAt || Date.parse(o.endsAt) > now.getTime();
}

/** An active order whose end has passed: the site closes it by itself (status «ended»). */
export function hasLapsed(o: Pick<OrderLike, "status" | "endsAt">, now: Date): boolean {
  return o.status === "active" && !!o.endsAt && Date.parse(o.endsAt) <= now.getTime();
}

/** Does this order touch this job (and, when given, this product)? An empty list means «all». */
export function appliesTo(o: Pick<OrderLike, "domain" | "jobKeys" | "products">, job: { key: string; domain: string }, productCode?: string): boolean {
  if (o.domain !== "all" && o.domain !== job.domain) return false;
  if (o.jobKeys.length && !o.jobKeys.includes(job.key)) return false;
  if (productCode !== undefined && o.products.length && !o.products.includes(productCode)) return false;
  return true;
}

/** Does this order touch this product (for the product page, where no job is asked)? */
export function touchesProduct(o: Pick<OrderLike, "products">, productCode: string): boolean {
  return !o.products.length || o.products.includes(productCode);
}

/** The status a NEW order starts in: a tightening one is active at once; a loosening one is the owner's alone — anyone else's waits for him. */
export function initialStatus(effect: OrderEffect, by: { source: OrderSource; isOwner: boolean }): "active" | "pending" {
  if (effect === "restrict") return "active";
  return by.source === "ui" && by.isOwner ? "active" : "pending";
}

/** Ending an order that TIGHTENS is a loosening. Only the owner on the site may do it directly; Claude's request waits for his yes. */
export function endNeedsOwner(effect: OrderEffect, by: { source: OrderSource; isOwner: boolean }): boolean {
  return effect === "restrict" && !(by.source === "ui" && by.isOwner);
}

/** «لحد 20/11» or «لحد ما تقول ارجع». */
export function untilWords(endsAt: string | null): string {
  if (!endsAt) return "لحد ما تقول «ارجع»";
  const d = new Date(endsAt);
  return `لحد ${new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(d)}`;
}
