/**
 * WHAT CLAUDE PUSHES (v4 · A) — rows of numbers per object per day, checked and shaped here before anything is stored.
 * Pure: no database, no clock (the caller passes `now`). The rows come from the owner's Ads Manager, OMS and stock
 * sheets read by Claude through the browser (until the official APIs are linked), so:
 *
 *   - nothing is guessed: a number that was not sent stays as it was; a missing CPM is computed from spend and
 *     impressions, never invented;
 *   - nothing about a customer can come in: the schema is closed (an unknown key is refused, `phone` included), and any
 *     text field is read by the same privacy filter the models are behind (src/gateway/privacy.ts);
 *   - the real-orders tally is turned into plain order rows (`planOrders`) so every rule, report and ladder that reads
 *     AttributedOrder works on pushed numbers exactly as on the OMS's — and CAPI never sends them (method «mcp»).
 */
import { z } from "zod";
import { privacyHits } from "@/gateway/privacy";

export const PUSH_LEVELS = ["account", "campaign", "adset", "ad", "product"] as const;
export type PushLevel = (typeof PUSH_LEVELS)[number];

const count = z.number().int().nonnegative().max(1_000_000_000);
const money = z.number().nonnegative().max(1_000_000_000);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ بصيغة YYYY-MM-DD");
const text = (max: number) => z.string().trim().min(1).max(max);

/** One row. Every field except the three that say «which object, which day» is optional: send what you have. */
export const MetricRow = z
  .object({
    date: day.describe("يوم الرقم (يوم حساب الإعلانات)، مثلاً 2026-11-14"),
    level: z.enum(PUSH_LEVELS).describe("مستوى الصف: account | campaign | adset | ad | product"),
    id: text(64).describe("رقم ميتا للعنصر (act_… أو رقم الحملة/المجموعة/الإعلان)، أو رمز المنتج لما يكون المستوى product"),
    hour: count.max(23).optional().describe("ساعة اللقطة (0–23) إذا الأرقام تراكمية لحد هالساعة. نفس اليوم بيتحدّث، ما بيتكرر"),
    name: text(200).optional().describe("اسم العنصر كما هو بميتا"),
    parent_id: text(64).optional().describe("رقم الأب: المجموعة ← حملتها، الإعلان ← مجموعته، الحملة ← حسابها"),
    account_id: text(64).optional().describe("رقم الحساب الإعلاني act_…"),
    product: text(40).optional().describe("رمز المنتج (إذا ما انفهم من اسم الحملة)"),
    status: text(40).optional().describe("ACTIVE | PAUSED | …"),
    budget_daily: money.optional().describe("الميزانية اليومية بالدولار"),
    start_time: z.string().trim().min(8).max(40).optional().describe("وقت بداية الصرف (ISO) — منه بتنحسب «أيام التشغيل»"),
    ads_count: count.optional().describe("عدد الإعلانات (للحملة/المجموعة)"),
    // ── التسليم (ميتا) ──
    spend: money.optional().describe("الصرف بالدولار (قبل رسوم البطاقة)"),
    impressions: count.optional(),
    reach: count.optional(),
    link_clicks: count.optional(),
    outbound_clicks: count.optional(),
    lpv: count.optional().describe("مشاهدات صفحة الهبوط"),
    pixel_purchases: count.optional().describe("Purchase بالبكسل (رقم ميتا — مش القرار)"),
    conversations: count.optional(),
    video_3s: count.optional(),
    thruplays: count.optional(),
    frequency: z.number().nonnegative().max(1000).optional(),
    cpm: money.optional().describe("إذا ما بعت impressions، بنحسبها من الصرف والـ CPM"),
    ctr: z.number().nonnegative().max(100).optional().describe("CTR الرابط بالمية — بيحسب النقرات إذا ما انبعتت"),
    // ── الحقيقة (الـ OMS) ──
    real_orders: count.optional().describe("الطلبات الحقيقية (هواتف فريدة) برقم هالإعلان بهاليوم — مستوى ad أو product بس"),
    confirmed: count.optional().describe("منها المؤكد"),
    mature_orders: count.optional().describe("منها الناضج (مرّ عليه 24 ساعة)"),
    shipped: count.optional(),
    delivered: count.optional(),
    returned: count.optional(),
    collected: money.optional().describe("المحصّل بالدولار من المُسلَّم"),
    channel: z.enum(["website", "whatsapp", "messenger"]).optional().describe("قناة الطلبات (الافتراضي website)"),
  })
  .strict();
export type MetricRowT = z.infer<typeof MetricRow>;

export interface RowProblem {
  index: number;
  error: string;
}

/** Splits what was sent into rows that can be stored and rows that cannot, each refusal saying why (in Arabic). */
export function checkRows(raw: unknown[]): { rows: { index: number; row: MetricRowT }[]; problems: RowProblem[] } {
  const rows: { index: number; row: MetricRowT }[] = [];
  const problems: RowProblem[] = [];
  raw.forEach((r, index) => {
    const p = MetricRow.safeParse(r);
    if (!p.success) {
      problems.push({ index, error: p.error.issues.map((i) => `${i.path.join(".") || "الصف"}: ${i.message}`).join(" · ").slice(0, 300) });
      return;
    }
    const hits = privacyHits([p.data.name, p.data.product, p.data.status, p.data.parent_id, p.data.account_id].filter(Boolean).join(" \n "));
    if (hits.length) {
      problems.push({ index, error: `انرفض: النص فيه ${hits.map((h) => ({ phone: "رقم هاتف", email: "إيميل", token: "مفتاح" })[h]).join(" و")} — ما بيدخل بيانات زبون ولا مفاتيح` });
      return;
    }
    const d = new Date(`${p.data.date}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== p.data.date) {
      problems.push({ index, error: "date: تاريخ مش صحيح" });
      return;
    }
    if (p.data.real_orders !== undefined && p.data.level !== "ad" && p.data.level !== "product") {
      problems.push({ index, error: "real_orders: الطلبات الحقيقية بتنبعت على مستوى ad أو product بس" });
      return;
    }
    rows.push({ index, row: p.data });
  });
  return { rows, problems };
}

// ───────────────────────────── Meta's side: the numbers of delivery ─────────────────────────────

/** The InsightDaily columns this row carries — only what was sent (or could be computed), so an update never zeroes a number. */
export interface InsightPatch {
  spend?: number;
  impressions?: number;
  reach?: number;
  frequency?: number;
  linkClicks?: number;
  outboundClicks?: number;
  lpv?: number;
  purchases?: number;
  conversations?: number;
  video3s?: number;
  thruplays?: number;
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

export function insightPatch(r: MetricRowT): InsightPatch | null {
  const p: InsightPatch = {};
  if (r.spend !== undefined) p.spend = round(r.spend, 2);
  if (r.impressions !== undefined) p.impressions = r.impressions;
  if (r.reach !== undefined) p.reach = r.reach;
  if (r.link_clicks !== undefined) p.linkClicks = r.link_clicks;
  if (r.outbound_clicks !== undefined) p.outboundClicks = r.outbound_clicks;
  if (r.lpv !== undefined) p.lpv = r.lpv;
  if (r.pixel_purchases !== undefined) p.purchases = r.pixel_purchases;
  if (r.conversations !== undefined) p.conversations = r.conversations;
  if (r.video_3s !== undefined) p.video3s = r.video_3s;
  if (r.thruplays !== undefined) p.thruplays = r.thruplays;
  // computed, never invented: CPM → impressions (needs spend); CTR → link clicks (needs impressions); impressions ÷ reach → frequency
  if (p.impressions === undefined && r.cpm && r.cpm > 0 && p.spend !== undefined) p.impressions = Math.round((p.spend / r.cpm) * 1000);
  if (p.linkClicks === undefined && r.ctr !== undefined && p.impressions !== undefined) p.linkClicks = Math.round((p.impressions * r.ctr) / 100);
  if (r.frequency !== undefined) p.frequency = round(r.frequency);
  else if (p.impressions !== undefined && p.reach && p.reach > 0) p.frequency = round(p.impressions / p.reach);
  return Object.keys(p).length ? p : null;
}

/** «Days running»: whole days since it started (the day it started is day 1). Null when the start is not known. */
export function daysRunning(startTime: Date | null | undefined, now: Date): number | null {
  if (!startTime) return null;
  const a = Date.UTC(startTime.getUTCFullYear(), startTime.getUTCMonth(), startTime.getUTCDate());
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

/** Meta's start_time (ISO with an offset) or a plain date → a Date; null when it cannot be read. */
export function parseStart(s: string | undefined): Date | null {
  if (!s) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Any spelling of a Meta status → the uppercase word the rest of the system reads (PAUSED · ACTIVE · …). */
export function normalizeStatus(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const u = s.trim().toUpperCase().replace(/[\s-]+/g, "_");
  const ar: Record<string, string> = { شغال: "ACTIVE", شغّال: "ACTIVE", موقوف: "PAUSED", موقف: "PAUSED", مرفوض: "DISAPPROVED" };
  return ar[s.trim()] ?? u;
}

// ───────────────────────────── the OMS's side: the real orders, as plain order rows ─────────────────────────────

export interface OrderTally {
  orders: number;
  confirmed?: number;
  mature?: number;
  shipped?: number;
  delivered?: number;
  returned?: number;
  collected?: number;
}

export type PlannedStatus = "new" | "confirmed" | "shipped" | "delivered" | "returned";

export interface PlannedOrder {
  /** 1-based: with the object and the day it is the order's whole identity, so a second push replaces, never adds */
  index: number;
  status: PlannedStatus;
  /** past the confirmation window: it may count in the confirm rate (6.6). Every confirmed order is mature. */
  mature: boolean;
  /** cash collected on this order (delivered ones only), or null when the push did not say */
  collected: number | null;
}

/**
 * N orders with the counts that were sent: returned, delivered, in transit, confirmed only, and the rest still new.
 * The counts are made consistent without ever inventing an order: delivered/returned imply shipped, shipped implies
 * confirmed, and nothing exceeds N. `mature` defaults to «all of them» for a day that is over and to «the confirmed
 * ones» for a day still running (the caller says which with `dayIsOver`).
 */
export function planOrders(t: OrderTally, dayIsOver: boolean): PlannedOrder[] {
  const n = Math.max(0, Math.floor(t.orders));
  const returned = Math.min(t.returned ?? 0, n);
  const delivered = Math.min(t.delivered ?? 0, n - returned);
  const shipped = Math.min(Math.max(t.shipped ?? 0, delivered + returned), n);
  const confirmed = Math.min(Math.max(t.confirmed ?? 0, shipped), n);
  const mature = Math.min(Math.max(t.mature ?? (dayIsOver ? n : confirmed), confirmed), n);
  const status = (i: number): PlannedStatus => (i < returned ? "returned" : i < returned + delivered ? "delivered" : i < shipped ? "shipped" : i < confirmed ? "confirmed" : "new");
  const each = delivered > 0 && t.collected !== undefined ? round(t.collected / delivered, 2) : null;
  return Array.from({ length: n }, (_, i) => {
    const s = status(i);
    return { index: i + 1, status: s, mature: i < mature, collected: s === "delivered" ? each : null };
  });
}

/** The id of a pushed order: stable per object, day and position, and visibly not an OMS id. */
export function pushedOrderId(level: PushLevel, objectId: string, date: string, index: number): string {
  return `mcp:${level}:${objectId}:${date}:${index}`;
}
export const PUSHED_ORDER_PREFIX = "mcp:";

// ───────────────────────────── stock and videos ─────────────────────────────

export const StockRow = z
  .object({
    product: text(40).describe("رمز المنتج"),
    units: count.optional().describe("القطع المتوفرة"),
    days_cover: z.number().nonnegative().max(10_000).describe("أيام التغطية بمعدل البيع الحالي"),
    as_of: z.string().trim().min(8).max(40).optional().describe("وقت القراءة (ISO) — الافتراضي هلأ"),
  })
  .strict();
export type StockRowT = z.infer<typeof StockRow>;

export const VIDEO_STATUSES = ["bank", "requested", "ready", "uploaded", "testing", "winner", "fatigued", "dropped"] as const;

export const VideoRow = z
  .object({
    job: text(40).describe("رقم الـ JOB"),
    v_name: text(60).describe("اسم الفيديو V…"),
    product: text(40).describe("رمز المنتج"),
    drive_file_id: text(120).optional(),
    meta_video_id: text(64).optional(),
    status: z.enum(VIDEO_STATUSES).optional().describe("bank | requested | ready | uploaded | testing | winner | fatigued | dropped"),
    notes: z.string().trim().max(300).optional(),
  })
  .strict();
export type VideoRowT = z.infer<typeof VideoRow>;

/** The same privacy net for any short free text a tool takes. Returns an Arabic refusal, or null when it is clean. */
export function refuseIfPrivate(...texts: (string | undefined | null)[]): string | null {
  const hits = privacyHits(texts.filter(Boolean).join(" \n "));
  return hits.length ? `انرفض: النص فيه ${hits.map((h) => ({ phone: "رقم هاتف", email: "إيميل", token: "مفتاح" })[h]).join(" و")} — ما بيدخل بيانات زبون ولا مفاتيح` : null;
}
