/**
 * capi.send (spec 9.1 / T4.3) — every 15 minutes, as the spec says («إرسال أول بأول»):
 *   1. enqueue: each order's earned events become rows keyed `oms-<order>-<status>` — the same event can never be
 *      queued twice (unique key), and Meta dedupes on the same id;
 *   2. drop what is past 7 days before sending (one stale event can sink a whole batch);
 *   3. ask the OMS for the identifiers behind `capi_ref`, hash them in memory, send, forget them.
 * Nothing goes to Meta in dry_run; the rows wait as «pending» until the live link is opened.
 */
import { db } from "@/server/db";
import { getSetting } from "@/server/settings";
import { bodyOf, eventsOf, sendable, type Channel } from "@/core/capi";
import { readCapiIdentifiers, type OmsOptions } from "@/adapters/oms";
import { MetaApiError, type MetaClient } from "@/meta/client";

const DAY = 86_400_000;
const MAX_ATTEMPTS = 3;

export async function enqueueCapi(now = new Date()) {
  const purchaseOn = String(await getSetting("capi.purchase_on")) === "delivered" ? "delivered" : "confirmed";
  const orders = await db.attributedOrder.findMany({ where: { updatedAt: { gte: new Date(now.getTime() - 8 * DAY) }, isFake: false } });
  const rows = orders.flatMap((o) =>
    eventsOf({ omsOrderId: o.omsOrderId, confirmedAt: o.confirmedAt, shippedAt: o.shippedAt, deliveredAt: o.deliveredAt, returnedAt: o.returnedAt, canceledAt: o.canceledAt, orderValue: Number(o.orderValue), collected: o.collected === null ? null : Number(o.collected), isFake: o.isFake }, purchaseOn).map((e) => {
      const s = sendable(e.eventTime, now);
      return { eventId: e.eventId, omsOrderId: o.omsOrderId, eventName: e.eventName, channel: o.channel, eventTime: e.eventTime, value: e.value, currency: o.currency, state: s === "ok" ? "pending" : "expired", error: s === "ok" ? null : s === "expired" ? "أقدم من 7 أيام" : "وقت بالمستقبل" };
    }),
  );
  const { count } = await db.capiEvent.createMany({ data: rows, skipDuplicates: true });
  return { orders: orders.length, events: rows.length, queued: count };
}

export interface SendOptions {
  meta: MetaClient | null;
  oms: OmsOptions | null;
  datasetId: string | null;
  /** Meta's Test Events code: the first real event is tried there (spec 9.1) */
  testEventCode?: string | null;
  now?: Date;
  limit?: number;
}

export async function sendCapi(o: SendOptions) {
  const now = o.now ?? new Date();
  const stats = { sent: 0, rejected: 0, expired: 0, skipped: 0, waiting: 0 };
  const pending = await db.capiEvent.findMany({ where: { state: "pending" }, orderBy: { eventTime: "asc" }, take: o.limit ?? 500 });
  const fresh = [];
  for (const e of pending) {
    if (sendable(e.eventTime, now) === "ok") fresh.push(e);
    else {
      await db.capiEvent.update({ where: { id: e.id }, data: { state: "expired", error: "أقدم من 7 أيام" } });
      stats.expired++;
    }
  }
  if (!o.meta || !o.oms || !o.datasetId) return { ...stats, waiting: fresh.length, dryRun: true };

  const orders = await db.attributedOrder.findMany({ where: { omsOrderId: { in: [...new Set(fresh.map((e) => e.omsOrderId))] } } });
  const byId = new Map(orders.map((x) => [x.omsOrderId, x]));
  const ids = await readCapiIdentifiers(o.oms, [...new Set(orders.map((x) => x.capiRef).filter((r): r is string => !!r))]);

  const batch: { rowId: string; body: NonNullable<ReturnType<typeof bodyOf>> }[] = [];
  for (const e of fresh) {
    const order = byId.get(e.omsOrderId);
    const body = order?.capiRef
      ? bodyOf({ eventId: e.eventId, eventName: e.eventName, status: "confirmed", eventTime: e.eventTime, value: e.value === null ? null : Number(e.value) }, { omsOrderId: e.omsOrderId, channel: e.channel as Channel, currency: e.currency ?? "USD", lpUrl: order.lpUrl }, ids.get(order.capiRef) ?? {})
      : null;
    if (!body) {
      await db.capiEvent.update({ where: { id: e.id }, data: { state: "skipped", error: "ما في معرّف للمطابقة (الطلب بلا capi_ref أو القناة ناقصها معرّف)" } });
      stats.skipped++;
    } else batch.push({ rowId: e.id, body });
  }

  // Meta takes up to 1,000 events per call; smaller batches keep one bad event from holding many back
  for (let i = 0; i < batch.length; i += 200) {
    const part = batch.slice(i, i + 200);
    try {
      const r = await o.meta.post<{ events_received?: number; fbtrace_id?: string }>(`${o.datasetId}/events`, { data: part.map((p) => p.body), ...(o.testEventCode ? { test_event_code: o.testEventCode } : {}) });
      // only what Meta answered is kept — never the identifiers that were sent
      await db.capiEvent.updateMany({ where: { id: { in: part.map((p) => p.rowId) } }, data: { state: "sent", sentAt: now, datasetId: o.datasetId, response: { events_received: r.events_received ?? null, batch: part.length, fbtrace_id: r.fbtrace_id ?? null }, error: null, attempts: { increment: 1 } } });
      stats.sent += part.length;
    } catch (e) {
      const error = e instanceof MetaApiError ? e.message : String(e);
      for (const p of part) {
        const row = await db.capiEvent.update({ where: { id: p.rowId }, data: { attempts: { increment: 1 }, error: error.slice(0, 500) } });
        if (row.attempts >= MAX_ATTEMPTS || (e instanceof MetaApiError && !e.transient)) {
          await db.capiEvent.update({ where: { id: p.rowId }, data: { state: "rejected" } });
          stats.rejected++;
        }
      }
    }
  }
  return stats;
}

/** The dataset events go to: the first one synced from Meta (one pixel for now), or the env override. */
export async function capiDataset(): Promise<string | null> {
  return process.env.META_DATASET_ID?.trim() || (await db.dataset.findFirst({ orderBy: { createdAt: "asc" } }))?.metaId || null;
}
