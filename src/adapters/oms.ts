/**
 * THE OMS ADAPTER (spec 9.2) — read only. Orders with the ad they came from, and the product numbers.
 * The contract: `/api/v1`, a token per system, amounts as decimal strings, no customer name / phone / address in
 * any answer (`capi_ref` is an encrypted reference only CAPI code opens). Anything that looks like a phone in a
 * field is refused, not stored.
 */
import { z } from "zod";
import { maturesAt } from "@/core/maturity";
import { parseAdName, parseCampaignName } from "@/core/naming";

export const OmsOrder = z.object({
  order_id: z.string(),
  product_code: z.string(),
  country: z.string(),
  channel: z.string(),
  ad_id: z.string().nullable().optional(),
  adset_id: z.string().nullable().optional(),
  campaign_id: z.string().nullable().optional(),
  ad_name: z.string().nullable().optional(),
  landing_page: z.string().nullable().optional(),
  status: z.enum(["new", "confirmed", "shipped", "delivered", "returned", "canceled"]),
  created_at: z.string(),
  confirmed_at: z.string().nullable().optional(),
  shipped_at: z.string().nullable().optional(),
  delivered_at: z.string().nullable().optional(),
  returned_at: z.string().nullable().optional(),
  canceled_at: z.string().nullable().optional(),
  order_value: z.string(),
  collected: z.string().nullable().optional(),
  currency: z.string(),
  is_fake: z.boolean().optional(),
  capi_ref: z.string().nullable().optional(),
});
export type OmsOrder = z.infer<typeof OmsOrder>;

const Page = z.object({ items: z.array(OmsOrder), next_cursor: z.string().nullable().optional() });

export const OmsProduct = z.object({
  code: z.string(),
  name: z.string(),
  aliases: z.array(z.string()).optional(),
  unit_cost_usd: z.string(),
  price_options: z.array(z.object({ price: z.string() })).optional(),
  stock_days: z.number().nullable().optional(),
  delivery_fee: z.string(),
  return_fee: z.string(),
  cod_fee_pct: z.string(),
});
export type OmsProduct = z.infer<typeof OmsProduct>;

export interface OmsOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
}

async function get(o: OmsOptions, path: string) {
  const res = await (o.fetch ?? fetch)(`${o.baseUrl.replace(/\/$/, "")}/api/v1${path}`, {
    headers: { authorization: `Bearer ${o.token}`, "x-request-id": crypto.randomUUID() },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`OMS ${path.split("?")[0]} answered ${res.status}`);
  return res.json();
}

/** Every order updated since `since`, following the cursor. */
export async function readOrders(o: OmsOptions, since: Date): Promise<OmsOrder[]> {
  const out: OmsOrder[] = [];
  let cursor: string | null | undefined;
  do {
    const q = new URLSearchParams({ updated_since: since.toISOString() });
    if (cursor) q.set("cursor", cursor);
    const page = Page.parse(await get(o, `/orders/attribution?${q}`));
    out.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor);
  return out;
}

export async function readProducts(o: OmsOptions): Promise<OmsProduct[]> {
  const data = await get(o, "/products?fields=code,name,aliases,unit_cost_usd,price_options,stock_days,delivery_fee,return_fee,cod_fee_pct");
  return z.array(OmsProduct).parse(Array.isArray(data) ? data : (data as { items: unknown }).items);
}

const PHONE = /(?:\+|00)\d{8,}|\b0?[79]\d{8}\b/;

/**
 * How an order is tied to an ad, best first (spec 5.7): the ad id from the link / first message, else the ad name
 * (CR code), else the campaign's naming (product level only), else none — and the method is stored, so every
 * number derived from it says «حقيقي» or «تقدير».
 */
export function attributionOf(o: OmsOrder): { method: "ad_id" | "naming" | "none"; creativeCode: string | null } {
  if (o.ad_id) return { method: "ad_id", creativeCode: o.ad_name ? parseAdName(o.ad_name)?.creativeCode ?? null : null };
  const byAd = o.ad_name ? parseAdName(o.ad_name) : null;
  if (byAd) return { method: "naming", creativeCode: byAd.creativeCode };
  if (o.campaign_id && parseCampaignName(o.campaign_id)) return { method: "naming", creativeCode: null };
  return { method: "none", creativeCode: null };
}

/** The row stored for an order — refuses anything that smells of a phone number in a free field. */
export function toAttributedOrder(o: OmsOrder, confirmWindowH: number) {
  for (const v of [o.ad_name, o.landing_page]) if (v && PHONE.test(v)) throw new Error(`order ${o.order_id}: a phone-like value in a public field — refused`);
  const created = new Date(o.created_at);
  const d = (v: string | null | undefined) => (v ? new Date(v) : null);
  return {
    omsOrderId: o.order_id,
    productCode: o.product_code,
    market: o.country,
    channel: o.channel,
    adId: o.ad_id ?? null,
    adSetId: o.adset_id ?? null,
    campaignId: o.campaign_id ?? null,
    adName: o.ad_name ?? null,
    lpUrl: o.landing_page ?? null,
    method: attributionOf(o).method,
    status: o.status,
    createdAtOms: created,
    confirmedAt: d(o.confirmed_at),
    shippedAt: d(o.shipped_at),
    deliveredAt: d(o.delivered_at),
    returnedAt: d(o.returned_at),
    canceledAt: d(o.canceled_at),
    orderValue: o.order_value,
    collected: o.collected ?? null,
    currency: o.currency,
    isFake: o.is_fake ?? false,
    capiRef: o.capi_ref ?? null,
    matureAt: maturesAt(created, confirmWindowH),
  };
}
