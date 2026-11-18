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
import { PEOPLE } from "./tasks";

export const PUSH_LEVELS = ["account", "campaign", "adset", "ad", "product", "person"] as const;
export type PushLevel = (typeof PUSH_LEVELS)[number];
/** The levels the paste screen offers (a team member's day is Claude's to push, not a table to paste). */
export const PASTE_LEVELS = ["account", "campaign", "adset", "ad", "product"] as const;

const count = z.number().int().nonnegative().max(1_000_000_000);
const money = z.number().nonnegative().max(1_000_000_000);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ بصيغة YYYY-MM-DD");
const text = (max: number) => z.string().trim().min(1).max(max);
/** An identifier (a Meta id, an account, a product code): a closed alphabet, never read as free text — a long id with a run of zeros is not a phone. */
const ident = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/, "المعرّف حروف إنجليزية وأرقام و _ . : - بس");

/** One offer's line of a product's day: how many orders took it, with how many pieces each (for the upsell rate) and what they came to. */
const OfferLine = z.object({ offer: text(80).describe("اسم العرض (مثلاً: قطعة، 2+هدية، 3 بسعر…)"), orders: count, pieces: count.optional().describe("عدد القطع بالطلب الواحد من هالعرض"), revenue: money.optional() }).strict();
const ReasonLine = z.object({ reason: text(80), count }).strict();

/** One row. Every field except the three that say «which object, which day» is optional: send what you have. */
export const MetricRow = z
  .object({
    date: day.describe("يوم الرقم — يوم العمل بتوقيت عمّان (Asia/Amman)، مثلاً 2026-11-14"),
    level: z.enum(PUSH_LEVELS).describe("مستوى الصف: account | campaign | adset | ad | product | person (أرقام موظف ليوم)"),
    id: ident.describe("رقم ميتا للعنصر (act_… أو رقم الحملة/المجموعة/الإعلان)، أو رمز المنتج لما يكون المستوى product"),
    hour: count.max(23).optional().describe("ساعة اللقطة (0–23) إذا الأرقام تراكمية لحد هالساعة. نفس اليوم بيتحدّث، ما بيتكرر"),
    name: text(200).optional().describe("اسم العنصر كما هو بميتا"),
    parent_id: ident.optional().describe("رقم الأب: المجموعة ← حملتها، الإعلان ← مجموعته، الحملة ← حسابها"),
    account_id: ident.optional().describe("رقم الحساب الإعلاني act_…"),
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
    // ── الحقيقة (الـ OMS) — بالإعلان: عدّاد الطلبات المنسوبة له. بالمنتج: يوم المنتج كامل (الأرقام v4.1) ──
    real_orders: count.optional().describe("الطلبات الحقيقية (هواتف فريدة) برقم هالإعلان أو المنتج بهاليوم — مستوى ad أو product بس"),
    confirmed: count.optional().describe("منها المؤكد"),
    mature_orders: count.optional().describe("منها الناضج (مرّ عليه 24 ساعة) — للإعلان"),
    shipped: count.optional(),
    delivered: count.optional(),
    returned: count.optional(),
    collected: money.optional().describe("المحصّل بالدولار من المُسلَّم"),
    channel: z.enum(["website", "whatsapp", "messenger"]).optional().describe("قناة الطلبات (الافتراضي website)"),
    // ── يوم المنتج (v4.1 «الأرقام») — مستوى product بس ──
    orders_in: count.optional().describe("طلبات الموقع الحقيقية اللي إجت بهاليوم (نفس real_orders)"),
    unique_customers: count.optional().describe("هواتف فريدة من الطلبات — الفرق عن orders_in هو التكرار المحذوف"),
    rejected: count.optional().describe("المرفوض بهاليوم"),
    cancelled: count.optional().describe("الملغي بهاليوم"),
    waiting: count.optional().describe("لسا بانتظار التأكيد (حالة وقت القراءة)"),
    reject_reasons: z.array(ReasonLine).max(8).optional().describe("أكتر أسباب الرفض: [{reason, count}]"),
    shipped_orders: count.optional().describe("الطلبات اللي انشحنت بهاليوم"),
    shipped_pieces: count.optional().describe("مجموع الكمية (quantity) للطلبات اللي انشحنت بهاليوم"),
    out_for_delivery: count.optional().describe("خارجة للتوصيل (حالة وقت القراءة)"),
    stuck: count.optional().describe("عالقة أكتر من 7 أيام (حالة وقت القراءة)"),
    revenue_shipped: money.optional().describe("مجموع totalAmount للطلبات اللي انشحنت بهاليوم"),
    expected_revenue: money.optional().describe("إذا حسبتها عندك (الموقع بيحسب لحاله من revenue_shipped ونسبة التسليم)"),
    offer_breakdown: z.array(OfferLine).max(12).optional().describe("الطلبات لكل عرض: [{offer, orders, pieces?, revenue?}]"),
    aov: money.optional().describe("متوسط قيمة الطلب بهاليوم"),
    stock_units: count.optional().describe("القطع الباقية بالمخزون"),
    // ── موظف ليوم (مستوى person فقط): id = مفتاح الموظف من دليل الفريق ──
    claims: count.optional().describe("person: المسكات (الطلبات اللي مسكها)"),
    no_answer: count.optional().describe("person: ما ردّ"),
    no_answer_fast: count.optional().describe("person: ما ردّ بأقل من دقيقة"),
    first_claim_sec: count.optional().describe("person: سرعة أول مسكة بالثواني"),
    stuck_48h: count.optional().describe("person: عالق فوق 48 ساعة"),
    reactivated: count.optional().describe("person: الطلبات اللي رجّعها للحياة"),
  })
  .strict();
export type MetricRowT = z.infer<typeof MetricRow>;

/** What a «person» row may carry (a team member's numbers for one day — employees, never customers). `confirmed` `rejected` `delivered` `reject_reasons` are shared with the product day. */
export const PERSON_FIELDS = ["claims", "confirmed", "rejected", "no_answer", "no_answer_fast", "first_claim_sec", "stuck_48h", "reactivated", "delivered", "reject_reasons"] as const;
const PERSON_ONLY = ["claims", "no_answer", "no_answer_fast", "first_claim_sec", "stuck_48h", "reactivated"] as const;
const ROW_BASE = ["date", "level", "id", "name"] as const;

/** Fields that describe a whole product's day: they only make sense on a «product» row. */
export const PRODUCT_DAY_ONLY = ["orders_in", "unique_customers", "rejected", "cancelled", "waiting", "reject_reasons", "shipped_orders", "shipped_pieces", "out_for_delivery", "stuck", "revenue_shipped", "expected_revenue", "offer_breakdown", "aov", "stock_units"] as const;

export interface RowProblem {
  index: number;
  error: string;
}

/** Splits what was sent into rows that can be stored and rows that cannot, each refusal saying why (in Arabic). */
export function checkRows(raw: unknown[], people: readonly string[] = PEOPLE.map((p) => p.key)): { rows: { index: number; row: MetricRowT }[]; problems: RowProblem[] } {
  const rows: { index: number; row: MetricRowT }[] = [];
  const problems: RowProblem[] = [];
  raw.forEach((r, index) => {
    const p = MetricRow.safeParse(r);
    if (!p.success) {
      problems.push({ index, error: p.error.issues.map((i) => `${i.path.join(".") || "الصف"}: ${i.message}`).join(" · ").slice(0, 300) });
      return;
    }
    // the free-text fields only: the identifiers have their own closed alphabet (above)
    const hits = privacyHits([p.data.name, p.data.product, p.data.status, ...(p.data.offer_breakdown ?? []).map((o) => o.offer), ...(p.data.reject_reasons ?? []).map((x) => x.reason)].filter(Boolean).join(" \n "));
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
    if (p.data.level === "person") {
      // a team member's day: the id must be a key of the team directory (never a guess), and nothing of ads or products rides along
      if (!people.includes(p.data.id)) {
        problems.push({ index, error: `id: «${p.data.id}» مش معروف بدليل الفريق — المفاتيح: ${people.join("، ")}` });
        return;
      }
      const stray = Object.keys(p.data).find((k) => p.data[k as keyof MetricRowT] !== undefined && !(ROW_BASE as readonly string[]).includes(k) && !(PERSON_FIELDS as readonly string[]).includes(k));
      if (stray) {
        problems.push({ index, error: `${stray}: مش من أرقام الموظف (${PERSON_FIELDS.join(" · ")})` });
        return;
      }
      rows.push({ index, row: p.data });
      return;
    }
    const personOnly = PERSON_ONLY.find((k) => p.data[k] !== undefined);
    if (personOnly) {
      problems.push({ index, error: `${personOnly}: هالحقل لأرقام الموظف — ابعته بصف مستواه person` });
      return;
    }
    const misplaced = PRODUCT_DAY_ONLY.find((k) => p.data[k] !== undefined);
    if (misplaced && p.data.level !== "product") {
      problems.push({ index, error: `${misplaced}: هالحقل لليوم الكامل للمنتج — ابعته بصف مستواه product` });
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
    scenario_file_id: text(120).optional().describe("ملف سيناريو الفيديو بدرايف (03_السيناريوهات) — بيظهر رابطه على بطاقة الفيديو وبيروح مع كل طلب لهيرمز"),
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

// ───────────────────────────── a product's whole day (v4.1 «الأرقام») ─────────────────────────────

/** The ProductDay columns a «product» row carries — only what was sent, so a later push never wipes what an earlier one said. */
export interface ProductDayPatch {
  spend?: number;
  impressions?: number;
  linkClicks?: number;
  pixelPurchases?: number;
  ordersIn?: number;
  uniqueCustomers?: number;
  confirmed?: number;
  rejected?: number;
  cancelled?: number;
  waiting?: number;
  rejectReasons?: { reason: string; count: number }[];
  offerBreakdown?: { offer: string; orders: number; pieces?: number; revenue?: number }[];
  aov?: number;
  shippedOrders?: number;
  shippedPieces?: number;
  outForDelivery?: number;
  delivered?: number;
  returned?: number;
  stuck?: number;
  revenueShipped?: number;
  expectedRevenue?: number;
  stockUnits?: number;
}

/** `orders_in` and `real_orders` are the same number said two ways; `shipped_orders` and `shipped` too — the longer name wins. */
export function productDayPatch(r: MetricRowT): ProductDayPatch | null {
  if (r.level !== "product") return null;
  const ads = insightPatch(r);
  const p: ProductDayPatch = {};
  const put = <K extends keyof ProductDayPatch>(k: K, v: ProductDayPatch[K] | undefined) => {
    if (v !== undefined) p[k] = v;
  };
  put("spend", ads?.spend);
  put("impressions", ads?.impressions);
  put("linkClicks", ads?.linkClicks);
  put("pixelPurchases", ads?.purchases);
  put("ordersIn", r.orders_in ?? r.real_orders);
  put("uniqueCustomers", r.unique_customers);
  put("confirmed", r.confirmed);
  put("rejected", r.rejected);
  put("cancelled", r.cancelled);
  put("waiting", r.waiting);
  put("rejectReasons", r.reject_reasons);
  put("offerBreakdown", r.offer_breakdown);
  put("aov", r.aov);
  put("shippedOrders", r.shipped_orders ?? r.shipped);
  put("shippedPieces", r.shipped_pieces);
  put("outForDelivery", r.out_for_delivery);
  put("delivered", r.delivered);
  put("returned", r.returned);
  put("stuck", r.stuck);
  put("revenueShipped", r.revenue_shipped);
  put("expectedRevenue", r.expected_revenue);
  put("stockUnits", r.stock_units);
  return Object.keys(p).length ? p : null;
}
