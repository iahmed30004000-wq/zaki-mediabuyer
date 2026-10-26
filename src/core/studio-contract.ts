/**
 * THE CONTENT STUDIO CONTRACT (docs/STUDIO_DATA_CONTRACT_AR.md). Pure: the studio pulls one row per (ad, order day)
 * from `GET /api/vidpattern/ad-performance`, exactly in the shape its `crm.py` reads (CRM_CONTRACT.md §1).
 *
 *   ad_name   {MARKET}|{PRODUCT}|{PAGE}|video|{VP id}      SY|TRF01|SP|video|VP-TRF01-0012-v2
 *
 * On Meta an ad keeps OUR name (CR00147_H07_HER_LP1, spec 5.1). The studio finds its script only in the fifth field,
 * so the name it receives is built from the registry (CR##### ↔ VP id) — decision D7. An ad already named the
 * studio's way is passed through as it is on Meta.
 */
import Decimal from "decimal.js";

/** The studio's own pattern (adname._SCRIPT_RX): VP-{code}-{n}-v{v}, a hook version ends in -h{k}. */
export const VP_ID = /^VP-[^|\s]+-\d+-v\d+(?:-h\d+)?$/;
export const SCOPES = ["vp:read", "vp:launch"] as const;
export type Scope = (typeof SCOPES)[number];

/** The studio asks for at most 31 days per call (crm.WINDOW_DAYS). */
export const MAX_WINDOW_DAYS = 31;

export function isVpId(value: string | null | undefined): value is string {
  return !!value && VP_ID.test(value.trim());
}

/** The fifth field of a studio-style name, or null. Never guesses (adname.parse). */
export function vpIdFromAdName(name: string | null | undefined): string | null {
  const fifth = String(name ?? "").split("|")[4]?.trim();
  return isVpId(fifth) ? fifth! : null;
}

const field = (v: string | null | undefined, fallback: string) => (String(v ?? "").replace(/\s+/g, " ").trim().replaceAll("|", "-") || fallback);

export function studioAdName(p: { market: string | null; productCode: string | null; pageCode: string | null; vpId: string }): string {
  return [field(p.market, "XX"), field(p.productCode, "UNKNOWN"), field(p.pageCode, "page"), "video", p.vpId].join("|");
}

/** `since`/`until` as YYYY-MM-DD, both included, at most 31 days. A string in Arabic when it is not acceptable. */
export function parseWindow(since: string | null, until: string | null): { from: Date; to: Date } | string {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!since || !day.test(since) || (until && !day.test(until))) return "التاريخ لازم يكون YYYY-MM-DD";
  const from = new Date(`${since}T00:00:00Z`);
  const to = new Date(`${until ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return "التاريخ لازم يكون YYYY-MM-DD";
  if (to < from) return "until قبل since";
  if ((to.getTime() - from.getTime()) / 86_400_000 + 1 > MAX_WINDOW_DAYS) return `أقصى نطاق ${MAX_WINDOW_DAYS} يوم بالطلب`;
  return { from, to };
}

export interface LinkedAd {
  metaAdId: string;
  adName: string;
}
export interface SpendDay {
  metaAdId: string;
  date: string; // YYYY-MM-DD
  spend: Decimal.Value;
  impressions: number;
  video3s: number;
}
export interface OrderDay {
  metaAdId: string;
  date: string; // the day the order was placed (cohort)
  status: string;
  collected: Decimal.Value | null;
}

export interface PerformanceRow {
  ad_name: string;
  date: string;
  spend: number;
  orders: number;
  delivered: number;
  collected: number;
  delivery_rate: number | null;
  cost_per_delivered: number | null;
  /** 3-second views ÷ impressions: a rate, not a count. */
  engagement: number | null;
}

/**
 * One row per (linked ad, order day) with spend or orders. Spend is Meta's, as Meta reports it (no fx fee): the
 * studio only compares scripts with each other. Fake orders never reach here. No customer field exists in a row.
 */
export function performanceRows(ads: readonly LinkedAd[], spend: readonly SpendDay[], orders: readonly OrderDay[]): PerformanceRow[] {
  const nameOf = new Map(ads.map((a) => [a.metaAdId, a.adName]));
  type Acc = { spend: Decimal; impressions: number; video3s: number; orders: number; delivered: number; collected: number };
  const acc = new Map<string, Acc>();
  const at = (adId: string, date: string) => {
    const k = `${adId}\u0000${date}`;
    if (!acc.has(k)) acc.set(k, { spend: new Decimal(0), impressions: 0, video3s: 0, orders: 0, delivered: 0, collected: 0 });
    return acc.get(k)!;
  };
  for (const s of spend) {
    if (!nameOf.has(s.metaAdId)) continue;
    const a = at(s.metaAdId, s.date);
    a.spend = a.spend.plus(s.spend);
    a.impressions += s.impressions;
    a.video3s += s.video3s;
  }
  for (const o of orders) {
    if (!nameOf.has(o.metaAdId)) continue;
    const a = at(o.metaAdId, o.date);
    a.orders++;
    if (o.status === "delivered") {
      a.delivered++;
      if (o.collected !== null && new Decimal(o.collected).gt(0)) a.collected++;
    }
  }
  const rows: PerformanceRow[] = [];
  for (const [k, a] of acc) {
    if (a.spend.isZero() && a.orders === 0) continue;
    const [adId, date] = k.split("\u0000") as [string, string];
    rows.push({
      ad_name: nameOf.get(adId)!,
      date,
      spend: a.spend.toDecimalPlaces(2).toNumber(),
      orders: a.orders,
      delivered: a.delivered,
      collected: a.collected,
      delivery_rate: a.orders ? new Decimal(a.delivered).div(a.orders).toDecimalPlaces(4).toNumber() : null,
      cost_per_delivered: a.delivered ? a.spend.div(a.delivered).toDecimalPlaces(4).toNumber() : null,
      engagement: a.impressions ? new Decimal(a.video3s).div(a.impressions).toDecimalPlaces(4).toNumber() : null,
    });
  }
  return rows.sort((x, y) => x.date.localeCompare(y.date) || x.ad_name.localeCompare(y.ad_name));
}
