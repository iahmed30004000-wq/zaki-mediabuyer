/**
 * THE STANDING ORDERS, the server side (docs/rebuild/04-work.md §5). Create · approve · reject · end · list, every move in the audit. The rules of who
 * may start and end one are pure (src/core/orders.ts). Nothing is deleted: «ارجع» ends an order and it stays in the archive; one whose end passed
 * closes by itself the next time orders are read.
 */
import { z } from "zod";
import type { StandingOrder } from "@prisma/client";
import { ORDER_DOMAINS, ORDER_EFFECTS, appliesTo, endNeedsOwner, initialStatus, isActive, touchesProduct, type OrderEffect, type OrderSource } from "@/core/orders";
import { refuseIfPrivate } from "@/core/push-rows";
import { audit, type Actor } from "./audit";
import { db } from "./db";

const iso = z.string().datetime({ offset: true });
const text = (n: number) => z.string().trim().min(1).max(n);

export const OrderInput = z
  .object({
    text: text(300).describe("الأمر بكلام المالك"),
    effect: z.enum(ORDER_EFFECTS).describe("restrict: بيشدّد (وقّف، لا تعمل، خفّض) — فعّال فوراً · allow: بيرخّي (زيد، اسمح، ارجع) — بينزل قرار للمالك"),
    domain: z.enum(ORDER_DOMAINS).optional().describe("ads · ops · all"),
    job_keys: z.array(text(60)).max(30).optional().describe("مفاتيح المهام اللي بيأثّر عليها (فاضي = كل مهام المجال)"),
    products: z.array(text(30)).max(30).optional().describe("رموز المنتجات (فاضي = كلها)"),
    until: iso.optional().describe("لحد إيمتى (فاضي = لحد ما يقول ارجع)"),
    said_at: iso.optional().describe("إيمتى قال المالك هالكلام"),
  })
  .strict();
export type OrderInputT = z.infer<typeof OrderInput>;

export interface OrderView {
  id: string;
  text: string;
  effect: OrderEffect;
  domain: string;
  jobKeys: string[];
  products: string[];
  startsAt: string;
  endsAt: string | null;
  status: string;
  endedAt: string | null;
  endedBy: string | null;
  endRequested: boolean;
  source: string;
  saidAt: string | null;
  createdAt: string;
}

export const orderView = (o: StandingOrder): OrderView => ({
  id: o.id,
  text: o.text,
  effect: o.effect === "allow" ? "allow" : "restrict",
  domain: o.domain,
  jobKeys: o.jobKeys,
  products: o.products,
  startsAt: o.startsAt.toISOString(),
  endsAt: o.endsAt?.toISOString() ?? null,
  status: o.status,
  endedAt: o.endedAt?.toISOString() ?? null,
  endedBy: o.endedBy,
  endRequested: !!o.endRequestedAt && o.status === "active",
  source: o.source,
  saidAt: o.saidAt?.toISOString() ?? null,
  createdAt: o.createdAt.toISOString(),
});

export class OrderRefused extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Closes the orders whose end has passed («ended», by the system). Cheap: it is called whenever orders are read. */
export async function closeLapsed(now = new Date()): Promise<number> {
  const rows = await db.standingOrder.findMany({ where: { status: "active", endsAt: { lte: now } }, select: { id: true } });
  if (!rows.length) return 0;
  const r = await db.standingOrder.updateMany({ where: { id: { in: rows.map((x) => x.id) }, status: "active" }, data: { status: "ended", endedAt: now, endedBy: "system" } });
  for (const x of rows) await audit({ type: "system" }, "order.lapse", { type: "standing_order", id: x.id }, { after: { status: "ended" } });
  return r.count;
}

/** Creates an order. The status comes from the rules: tightening → active; loosening → active only for the owner on the site, else pending. */
export async function createOrder(input: OrderInputT, by: { actor: Actor; source: OrderSource; isOwner: boolean }, now = new Date()): Promise<OrderView> {
  const refusal = refuseIfPrivate(input.text, ...(input.job_keys ?? []), ...(input.products ?? []));
  if (refusal) throw new OrderRefused(refusal);
  if (input.until && Date.parse(input.until) <= now.getTime()) throw new OrderRefused("until: لازم يكون بالمستقبل");
  const status = initialStatus(input.effect, { source: by.source, isOwner: by.isOwner });
  const row = await db.standingOrder.create({
    data: {
      text: input.text,
      effect: input.effect,
      domain: input.domain ?? "ads",
      jobKeys: input.job_keys ?? [],
      products: input.products ?? [],
      startsAt: now,
      endsAt: input.until ? new Date(input.until) : null,
      status,
      source: by.source,
      saidAt: input.said_at ? new Date(input.said_at) : null,
      createdBy: by.actor.id ?? by.actor.type,
    },
  });
  await audit(by.actor, "order.create", { type: "standing_order", id: row.id }, { after: { effect: row.effect, domain: row.domain, status: row.status, source: row.source } });
  return orderView(row);
}

async function mustFind(id: string): Promise<StandingOrder> {
  const row = await db.standingOrder.findUnique({ where: { id } });
  if (!row) throw new OrderRefused("الأمر مش موجود", 404);
  return row;
}

/** The owner answers a pending order (yes → active, no → rejected), or Claude's request to end an active one (yes → ended, no → it stays). */
export async function decideOrder(id: string, answer: "approve" | "reject", actor: Actor, now = new Date()): Promise<OrderView> {
  const o = await mustFind(id);
  if (o.status === "pending") {
    const row = await db.standingOrder.update({ where: { id }, data: answer === "approve" ? { status: "active", startsAt: now } : { status: "rejected", endedAt: now, endedBy: actor.id ?? actor.type } });
    await audit(actor, answer === "approve" ? "order.approve" : "order.reject", { type: "standing_order", id }, { after: { status: row.status } });
    return orderView(row);
  }
  if (o.status === "active" && o.endRequestedAt) {
    const row = await db.standingOrder.update({ where: { id }, data: answer === "approve" ? { status: "ended", endedAt: now, endedBy: actor.id ?? actor.type } : { endRequestedAt: null, endRequestedBy: null } });
    await audit(actor, answer === "approve" ? "order.end" : "order.keep", { type: "standing_order", id }, { after: { status: row.status } });
    return orderView(row);
  }
  throw new OrderRefused("الأمر مش بانتظار جواب", 409);
}

/**
 * Ends an order. The owner on the site ends any of them at once («ارجع»). Claude asking to end one that TIGHTENS is a loosening: it only
 * leaves a request the owner answers (the order stays in force until he says yes).
 */
export async function endOrder(id: string, by: { actor: Actor; source: OrderSource; isOwner: boolean }, now = new Date()): Promise<{ order: OrderView; ended: boolean }> {
  const o = await mustFind(id);
  if (o.status !== "active" && o.status !== "pending") throw new OrderRefused("الأمر منتهي أصلاً", 409);
  const effect: OrderEffect = o.effect === "allow" ? "allow" : "restrict";
  if (o.status === "active" && endNeedsOwner(effect, { source: by.source, isOwner: by.isOwner })) {
    const row = await db.standingOrder.update({ where: { id }, data: { endRequestedAt: now, endRequestedBy: by.actor.id ?? by.actor.type } });
    await audit(by.actor, "order.end_request", { type: "standing_order", id }, { after: { requested: true } });
    return { order: orderView(row), ended: false };
  }
  const row = await db.standingOrder.update({ where: { id }, data: { status: "ended", endedAt: now, endedBy: by.actor.id ?? by.actor.type } });
  await audit(by.actor, "order.end", { type: "standing_order", id }, { after: { status: "ended" } });
  return { order: orderView(row), ended: true };
}

export interface OrderFilter {
  /** only the ones in force now */
  active?: boolean;
  domain?: "ads" | "ops";
  /** a job (key + domain): only the orders that touch it */
  job?: { key: string; domain: string };
  product?: string;
  /** include ended and rejected ones (the archive) */
  archive?: boolean;
  limit?: number;
}

/** The orders, newest first. Closes the lapsed ones first. `active` keeps only those in force; `archive` adds the ended and rejected. */
export async function listOrders(f: OrderFilter = {}, now = new Date()): Promise<OrderView[]> {
  await closeLapsed(now);
  const rows = await db.standingOrder.findMany({
    where: f.archive ? {} : { status: { in: ["pending", "active"] } },
    orderBy: { createdAt: "desc" },
    take: Math.min(f.limit ?? 100, 300),
  });
  return rows
    .map(orderView)
    .filter((o) => !f.domain || o.domain === f.domain || o.domain === "all")
    .filter((o) => !f.job || appliesTo(o, f.job))
    .filter((o) => !f.product || touchesProduct(o, f.product))
    .filter((o) => !f.active || isActive(o, now));
}

/** What `get_rules` hands Claude: only the orders in force, with the words and the scope. */
export async function standingOrdersForClaude(now = new Date()): Promise<{ id: string; text: string; effect: OrderEffect; domain: string; job_keys: string[]; products: string[]; since: string; until: string | null }[]> {
  return (await listOrders({ active: true }, now)).map((o) => ({ id: o.id, text: o.text, effect: o.effect, domain: o.domain, job_keys: o.jobKeys, products: o.products, since: o.startsAt, until: o.endsAt }));
}

