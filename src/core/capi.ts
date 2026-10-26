/**
 * CONVERSION EVENTS BACK TO META (spec 9.1 «حدث تحويل» / T4.3) — the truth teaches Meta who really buys.
 * Pure: which event an order status makes, its unique id (Meta dedupes on it, we never send it twice), the 7-day
 * limit (an older event is refused by Meta and can sink the whole batch, so it is dropped before sending), and the
 * exact body per channel. Customer identifiers arrive at send time, are hashed here and never stored.
 */
import { createHash } from "node:crypto";

export type OrderStatus = "new" | "confirmed" | "shipped" | "delivered" | "returned" | "canceled";
export type Channel = "website" | "whatsapp" | "messenger";

export interface PlannedEvent {
  eventId: string;
  eventName: string;
  status: OrderStatus;
  eventTime: Date;
  /** the money of the event: the order value on confirm, what was collected on delivery */
  value: number | null;
}

export interface OrderForCapi {
  omsOrderId: string;
  confirmedAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  returnedAt: Date | null;
  canceledAt: Date | null;
  orderValue: number;
  collected: number | null;
  isFake: boolean;
}

/** Every event an order has earned so far (spec 9.1 table); «Purchase» on confirm by default, or on delivery. */
export function eventsOf(o: OrderForCapi, purchaseOn: "confirmed" | "delivered" = "confirmed"): PlannedEvent[] {
  if (o.isFake) return [];
  const out: PlannedEvent[] = [];
  const add = (status: OrderStatus, at: Date | null, name: string, value: number | null) => {
    if (at) out.push({ eventId: `oms-${o.omsOrderId}-${status}`, eventName: name, status, eventTime: at, value });
  };
  add("confirmed", o.confirmedAt, purchaseOn === "confirmed" ? "Purchase" : "OrderConfirmed", o.orderValue);
  add("shipped", o.shippedAt, "OrderShipped", null);
  add("delivered", o.deliveredAt, purchaseOn === "delivered" ? "Purchase" : "OrderDelivered", o.collected ?? o.orderValue);
  add("canceled", o.canceledAt, "OrderCanceled", null);
  add("returned", o.returnedAt, "OrderReturned", null);
  return out;
}

export const MAX_AGE_DAYS = 7;

/** Too old (Meta refuses past 7 days — a small margin kept) or in the future (a clock error): never sent. */
export function sendable(eventTime: Date, now: Date): "ok" | "expired" | "future" {
  const age = now.getTime() - eventTime.getTime();
  if (age > MAX_AGE_DAYS * 86_400_000 - 3_600_000) return "expired";
  if (age < -5 * 60_000) return "future";
  return "ok";
}

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
/** Meta's phone rule: digits only, with the country code, no + or leading zeros. */
export const hashPhone = (e164: string) => sha(e164.replace(/\D/g, "").replace(/^0+/, ""));
export const hashExternal = (ref: string) => sha(ref.trim().toLowerCase());

export interface Identifiers {
  phone_e164?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  external_ref?: string | null;
  ctwa_clid?: string | null;
  waba_id?: string | null;
  page_id?: string | null;
  psid?: string | null;
}

export interface CapiBody {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: "website" | "business_messaging";
  messaging_channel?: "whatsapp" | "messenger";
  event_source_url?: string;
  user_data: Record<string, unknown>;
  custom_data: Record<string, unknown>;
}

/** The body for one event. Returns null when the channel's required identifiers are missing (nothing to match on). */
export function bodyOf(e: PlannedEvent, o: { omsOrderId: string; channel: Channel; currency: string; lpUrl?: string | null }, ids: Identifiers): CapiBody | null {
  const custom_data: Record<string, unknown> = { order_id: o.omsOrderId, ...(e.value !== null ? { currency: o.currency, value: Number(e.value.toFixed(2)) } : {}) };
  const base = { event_name: e.eventName, event_time: Math.floor(e.eventTime.getTime() / 1000), event_id: e.eventId, custom_data };
  if (o.channel === "whatsapp") {
    if (!ids.ctwa_clid || !ids.waba_id) return null;
    return { ...base, action_source: "business_messaging", messaging_channel: "whatsapp", user_data: { whatsapp_business_account_id: ids.waba_id, ctwa_clid: ids.ctwa_clid } };
  }
  if (o.channel === "messenger") {
    if (!ids.page_id || !ids.psid) return null;
    return { ...base, action_source: "business_messaging", messaging_channel: "messenger", user_data: { page_id: ids.page_id, page_scoped_user_id: ids.psid } };
  }
  const user_data: Record<string, unknown> = {};
  if (ids.phone_e164) user_data.ph = [hashPhone(ids.phone_e164)];
  if (ids.fbc) user_data.fbc = ids.fbc;
  if (ids.fbp) user_data.fbp = ids.fbp;
  if (ids.external_ref) user_data.external_id = [hashExternal(ids.external_ref)];
  if (!Object.keys(user_data).length) return null;
  return { ...base, action_source: "website", ...(o.lpUrl ? { event_source_url: o.lpUrl } : {}), user_data };
}

/** The share Meta accepted, for «صحة البيانات» (S10): accepted ÷ (accepted + rejected); expired counted apart. */
export function capiHealth(counts: Record<string, number>): { acceptedPct: number | null; expired: number; rejected: number; pending: number } {
  const ok = counts.sent ?? 0;
  const bad = counts.rejected ?? 0;
  return { acceptedPct: ok + bad ? Math.round((ok / (ok + bad)) * 1000) / 10 : null, expired: counts.expired ?? 0, rejected: bad, pending: counts.pending ?? 0 };
}
