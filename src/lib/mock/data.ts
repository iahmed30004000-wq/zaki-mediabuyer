/**
 * DEMO DATA (`MOCK_MODE=1`) — what every screen shows until Meta and the OMS are connected.
 * The raw counts are invented; every derived number goes through the real calculator
 * (src/core/economics.ts), so what you see is computed exactly as it will be on real data.
 * No customer data of any kind lives here.
 */
import { computeTruth, estimateTargets, round2, pct1, type Truth } from "@/core/economics";

export type Market = "SY" | "JO";

export interface Product {
  code: string;
  name: string;
  market: Market;
  price: number;
  unitCost: number;
  delivery: number;
  returnFee: number;
  codFee: number;
  confirmCost: number;
  stockDays: number;
  /** Real shipments so far (< 50 = the targets are an estimate). */
  shipmentsToDate: number;
}

export const PRODUCTS: Product[] = [
  { code: "TRF01", name: "ماء الكمأة", market: "SY", price: 20, unitCost: 2.2, delivery: 2.5, returnFee: 0, codFee: 0, confirmCost: 0.3, stockDays: 18, shipmentsToDate: 214 },
  { code: "TIN01", name: "قطرة طنين الأذن", market: "SY", price: 18, unitCost: 2.6, delivery: 2.5, returnFee: 1, codFee: 0, confirmCost: 0.3, stockDays: 4, shipmentsToDate: 38 },
  { code: "SCR01", name: "كريم الندبات", market: "SY", price: 17, unitCost: 2.5, delivery: 3, returnFee: 2, codFee: 0.04, confirmCost: 0.3, stockDays: 26, shipmentsToDate: 61 },
  { code: "NFG01", name: "كريم فطريات الأظافر", market: "JO", price: 22, unitCost: 3.1, delivery: 3, returnFee: 2, codFee: 0.02, confirmCost: 0.4, stockDays: 12, shipmentsToDate: 19 },
];

export const productByCode = (code: string) => PRODUCTS.find((p) => p.code === code);

export function targetsOf(p: Product) {
  const e = estimateTargets({ price: p.price, unitCost: p.unitCost, shipping: p.delivery, returnFee: p.returnFee, codFee: p.codFee, confirmCost: p.confirmCost, confirmRate: "0.65", deliveryRate: "0.75", profitMinShare: "0.30" });
  return { tOrder: round2(e.tOrder)!, tConfirmed: round2(e.tConfirmed)!, margin: round2(e.margin)!, losing: e.losing, estimated: p.shipmentsToDate < 50 };
}

// ───────────────────────────── the ad accounts ─────────────────────────────

export interface Account {
  id: string;
  name: string;
  market: Market;
  /** 0 مستشار · 1 حارس · 2 مكبّر محدود · 3 مدير */
  level: 0 | 1 | 2 | 3;
  dailyCap: number;
  spentToday: number;
  plannedToday: number;
  paymentOk: boolean;
  note?: string;
}

export const ACCOUNTS: Account[] = [
  { id: "act_1029", name: "حساب سوريا", market: "SY", level: 1, dailyCap: 260, spentToday: 151.4, plannedToday: 240, paymentOk: true, note: "الدفع من حساب مالي برّا سوريا" },
  { id: "act_2207", name: "حساب الأردن", market: "JO", level: 1, dailyCap: 90, spentToday: 38.2, plannedToday: 80, paymentOk: true },
];

export const LEVEL_AR = ["مستشار", "حارس", "مكبّر محدود", "مدير"] as const;
export const LEVEL_HINT = [
  "بيقترح بس، ولا بيلمس شي.",
  "بيوقف الخاسر ويخفّض لحاله. أي زيادة صرف بموافقتك.",
  "متل الحارس، وكمان بيكبّر بخطوة 20% ضمن السقف.",
  "بيدير كل شي ضمن السقف. (مطفي لهلأ)",
] as const;

// ───────────────────────────── the campaign tree ─────────────────────────────

export interface Counts {
  spend: number;
  impressions: number;
  clicks: number;
  v3s: number;
  thru: number;
  purchases: number;
  conversations?: number;
  orders: number;
  mature: number;
  confirmed: number;
  shipments: number;
  delivered: number;
  returned: number;
}

export type RowStatus = "active" | "paused" | "learning" | "untested" | "rejected";

export interface AdRow {
  id: string;
  name: string;
  status: RowStatus;
  counts: Counts;
  /** The rule that acted on it, in the owner's words. */
  note?: string;
}
export interface AdSetRow {
  id: string;
  name: string;
  status: RowStatus;
  dailyBudget: number;
  learning: { events: number; of: number };
  ads: AdRow[];
}
export interface CampaignRow {
  id: string;
  account: string;
  name: string;
  productCode: string | null;
  status: RowStatus;
  adsets: AdSetRow[];
  /** A name the parser could not read. */
  needsNaming?: boolean;
}

const c = (spend: number, impressions: number, clicks: number, v3s: number, thru: number, purchases: number, orders: number, mature: number, confirmed: number, shipments: number, delivered: number, returned: number, conversations?: number): Counts => ({
  spend, impressions, clicks, v3s, thru, purchases, orders, mature, confirmed, shipments, delivered, returned, conversations,
});

export const CAMPAIGNS: CampaignRow[] = [
  {
    id: "c1", account: "act_1029", name: "SY_TRF01_WEB_SCALE_261012_C01", productCode: "TRF01", status: "active",
    adsets: [
      {
        id: "s1", name: "BROAD_ADV_SP_CPT0012_v1", status: "active", dailyBudget: 40, learning: { events: 50, of: 50 },
        ads: [
          { id: "a1", name: "CR00147_H07_HER_LP1", status: "active", counts: c(120, 31200, 520, 10900, 2400, 26, 30, 30, 22, 21, 16, 5) },
          { id: "a2", name: "CR00152_H03_ING_LP1", status: "active", counts: c(84, 22800, 410, 7300, 1500, 17, 19, 18, 13, 12, 9, 3) },
        ],
      },
      {
        id: "s2", name: "BROAD_ADV_VP_CPT0015_v1", status: "learning", dailyBudget: 25, learning: { events: 23, of: 50 },
        ads: [
          { id: "a3", name: "CR00160_H01_PRB_LP2", status: "active", counts: c(46, 14100, 160, 3900, 610, 6, 7, 5, 3, 3, 2, 1) },
          { id: "a4", name: "CR00161_H05_HER_LP2", status: "untested", counts: c(3.2, 900, 6, 210, 30, 0, 0, 0, 0, 0, 0, 0) },
        ],
      },
    ],
  },
  {
    id: "c2", account: "act_1029", name: "SY_TIN01_MSG_CRT_261021_C01", productCode: "TIN01", status: "active",
    adsets: [
      {
        id: "s3", name: "BROAD_ADV_AJ_CPT0021_v1", status: "active", dailyBudget: 20, learning: { events: 31, of: 50 },
        ads: [
          { id: "a5", name: "CR00171_H02_PRB_LP1", status: "active", counts: c(38, 9800, 140, 2900, 520, 0, 11, 9, 6, 5, 4, 1, 64) },
          { id: "a6", name: "CR00174_H08_ING_LP1", status: "paused", counts: c(9.1, 3100, 22, 480, 60, 0, 0, 0, 0, 0, 0, 0, 7), note: "وقف لأنه صرف 9.10$ بلا ولا طلب" },
        ],
      },
    ],
  },
  {
    id: "c3", account: "act_1029", name: "كمأة جديد - نسخة 3", productCode: null, status: "paused", needsNaming: true,
    adsets: [{ id: "s4", name: "Ad set 1", status: "paused", dailyBudget: 10, learning: { events: 4, of: 50 }, ads: [{ id: "a7", name: "فيديو 14", status: "paused", counts: c(12.5, 4100, 30, 900, 120, 1, 1, 1, 0, 0, 0, 0) }] }],
  },
  {
    id: "c4", account: "act_2207", name: "JO_NFG01_WEB_TEST_261019_C01", productCode: "NFG01", status: "learning",
    adsets: [
      {
        id: "s5", name: "BROAD_ADV_SP_CPT0031_v1", status: "learning", dailyBudget: 30, learning: { events: 12, of: 50 },
        ads: [
          { id: "a8", name: "CR00181_H04_EAS_LP1", status: "active", counts: c(41, 8900, 150, 2500, 450, 5, 8, 6, 4, 3, 2, 0) },
          { id: "a9", name: "CR00183_H06_TRS_LP1", status: "active", counts: c(29, 6700, 70, 1300, 160, 1, 2, 2, 0, 0, 0, 0) },
        ],
      },
    ],
  },
];

// ───────────────────────────── the truth of a set of counts ─────────────────────────────

export function sumCounts(list: Counts[]): Counts {
  const z = c(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  let conv: number | undefined;
  for (const x of list) {
    (Object.keys(z) as (keyof Counts)[]).forEach((k) => {
      if (k !== "conversations") (z[k] as number) += x[k] as number;
    });
    if (x.conversations !== undefined) conv = (conv ?? 0) + x.conversations;
  }
  return { ...z, conversations: conv };
}

export const adsetCounts = (s: AdSetRow) => sumCounts(s.ads.map((a) => a.counts));
export const campaignCounts = (cmp: CampaignRow) => sumCounts(cmp.adsets.map(adsetCounts));

export function truthOf(k: Counts, p: Product | undefined): Truth {
  const price = p?.price ?? 0;
  return computeTruth({
    spend: k.spend,
    fxFee: "0.01",
    conversations: k.conversations,
    orders: k.orders,
    confirmed: k.confirmed,
    matureOrders: k.mature,
    shipments: k.shipments,
    delivered: k.delivered,
    returned: k.returned,
    collected: k.delivered * price,
    deliveryFees: k.shipments * (p?.delivery ?? 0),
    returnFees: k.returned * (p?.returnFee ?? 0),
    cogsDelivered: k.delivered * (p?.unitCost ?? 0),
    overheadFactor: "0.97",
  });
}

/** What a screen shows for a row: meta numbers, true numbers, and the gap between them. */
export function viewOf(k: Counts, p: Product | undefined) {
  const t = truthOf(k, p);
  const ratio = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);
  // messaging campaigns have no pixel Purchase to compare: no gap, not a 100% one
  const gap = k.orders > 0 && k.conversations === undefined ? ((k.purchases - k.orders) / k.orders) * 100 : null;
  return {
    spend: round2(t.spendWithFee),
    ctr: ratio(k.clicks, k.impressions),
    hook: ratio(k.v3s, k.impressions),
    hold: ratio(k.thru, k.v3s),
    cpaPixel: k.purchases > 0 ? round2(t.spendWithFee.div(k.purchases)) : null,
    orders: k.orders,
    confirmed: k.confirmed,
    open: k.orders - k.mature,
    confirmRate: pct1(t.confirmRate),
    costPerConfirmed: round2(t.costPerConfirmed),
    delivered: k.delivered,
    deliveryRate: pct1(t.deliveryRate),
    returnRate: pct1(t.returnRate),
    ceiling: round2(t.scalingCeiling),
    profit: round2(t.profitAfterCosts),
    profitPerDelivered: round2(t.profitPerDelivered),
    roas: round2(t.trueRoas),
    gap: gap === null ? null : Math.round(gap),
    enoughData: k.impressions >= 3000 && k.spend >= 2 * (p ? targetsOf(p).tOrder : 1),
  };
}
export type RowView = ReturnType<typeof viewOf>;

/** What the screens read: the demo set, or the same shapes built from the database (src/lib/source.ts). */
export interface Dataset {
  products: Product[];
  accounts: Account[];
  campaigns: CampaignRow[];
  /** true when the numbers are the demo ones */
  demo: boolean;
}

export const DEMO: Dataset = { products: PRODUCTS, accounts: ACCOUNTS, campaigns: CAMPAIGNS, demo: true };

export function productView(code: string, ds: Dataset = DEMO) {
  const p = ds.products.find((x) => x.code === code)!;
  const rows = ds.campaigns.filter((x) => x.productCode === code);
  const k = sumCounts(rows.map(campaignCounts));
  return { product: p, counts: k, view: viewOf(k, p), targets: targetsOf(p) };
}

/** All the ads, flattened, with their product and view. */
export function allAds(ds: Dataset = DEMO) {
  return ds.campaigns.flatMap((cmp) =>
    cmp.adsets.flatMap((s) =>
      s.ads.map((a) => {
        const p = cmp.productCode ? ds.products.find((x) => x.code === cmp.productCode) : undefined;
        return { ad: a, adset: s, campaign: cmp, product: p, view: viewOf(a.counts, p) };
      }),
    ),
  );
}

// ───────────────────────────── decisions (ChangeSets) ─────────────────────────────

export type ChangeState = "pending_approval" | "executed" | "rolled_back" | "failed";
export interface ChangeSet {
  id: string;
  state: ChangeState;
  /** Who proposed: a rule, an agent or a person. */
  by: string;
  reasonCode: string;
  /** The sentence the owner reads. */
  sentence: string;
  target: string;
  before: string;
  after: string;
  spendDeltaDaily: number;
  at: string;
  auto: boolean;
}

export const CHANGES: ChangeSet[] = [
  { id: "cs-101", state: "pending_approval", by: "قاعدة التكبير", reasonCode: "S12", sentence: "BROAD_ADV_SP_CPT0012_v1 تكلفة مؤكدها 5.51$ تحت السقف 6.64$ لـ 3 أيام بـ 22 مؤكد. بقترح نزيد ميزانيتها 20%.", target: "BROAD_ADV_SP_CPT0012_v1", before: "40$ باليوم", after: "48$ باليوم", spendDeltaDaily: 8, at: "اليوم 8:30", auto: false },
  { id: "cs-102", state: "pending_approval", by: "خطة الاختبار", reasonCode: "S10", sentence: "حملة اختبار إبداعات جديدة لقطرة الطنين: 3 مفاهيم × 15$ لـ 4 أيام. كلها بتنشأ موقوفة وبتتفعّل بعد التحقق.", target: "SY_TIN01_WEB_CRT_261026_C01", before: "—", after: "3 مجموعات × 15$", spendDeltaDaily: 45, at: "اليوم 8:30", auto: false },
  { id: "cs-097", state: "executed", by: "قاعدة الخاسر", reasonCode: "S01", sentence: "وقّفت CR00174 لأنه صرف 9.10$ (ضعف هدف الطلب) بـ 48 ساعة بلا ولا طلب.", target: "CR00174_H08_ING_LP1", before: "شغّال", after: "موقوف", spendDeltaDaily: -6, at: "أمس 21:40", auto: true },
  { id: "cs-095", state: "executed", by: "قاعدة المخزون", reasonCode: "S06", sentence: "جمّدت التكبير لقطرة الطنين: المخزون بيكفي 4 أيام بس.", target: "TIN01", before: "تكبير مسموح", after: "تكبير مجمّد", spendDeltaDaily: 0, at: "أمس 18:05", auto: true },
  { id: "cs-090", state: "rolled_back", by: "أحمد", reasonCode: "S11", sentence: "رجّعت تخفيض الميزانية على حملة الكمأة — كان بسبب تأخير بيانات.", target: "SY_TRF01_WEB_SCALE_261012_C01", before: "56$", after: "80$", spendDeltaDaily: 24, at: "قبل يومين", auto: false },
];

export const REASON_AR: Record<string, string> = {
  S01: "خاسر بلا طلبات", S02: "تكلفة مؤكد عالية", S03: "مرتجع عالي", S04: "سقف يومي", S05: "قفزة صرف", S06: "مخزون", S07: "قدرة الرد أو التأكيد",
  S08: "تعب إبداع", S09: "رفض أو سياسة", S10: "خطة أسبوعية", S11: "قرار يدوي", S12: "تكبير بالسلّم", S13: "طلبات وهمية", S14: "بيانات متأخرة",
};

// ───────────────────────────── creatives ─────────────────────────────

export type CreativeStage = "inbox" | "review" | "ready" | "live" | "fatigued" | "excluded";
export interface Creative {
  code: string;
  product: string;
  stage: CreativeStage;
  duration: number;
  aspect: "9:16" | "4:5" | "1:1";
  hook?: string;
  angle?: string;
  dialect?: string;
  policy: "green" | "yellow" | "red" | "pending";
  policyNote?: string;
  hookRate?: number;
  holdRate?: number;
  costPerConfirmed?: number;
  dupOf?: string;
}

export const CREATIVES: Creative[] = [
  { code: "CR00190", product: "TRF01", stage: "inbox", duration: 24, aspect: "9:16", policy: "pending" },
  { code: "CR00191", product: "TRF01", stage: "inbox", duration: 31, aspect: "9:16", policy: "pending" },
  { code: "CR00188", product: "TIN01", stage: "review", duration: 19, aspect: "9:16", hook: "سؤال", angle: "المشكلة", dialect: "سوري", policy: "yellow", policyNote: "«مع الاستعمال المنتظم» — مسموح بموافقتك" },
  { code: "CR00186", product: "TRF01", stage: "review", duration: 27, aspect: "4:5", hook: "قصة", angle: "التراث", dialect: "سوري", policy: "red", policyNote: "«وماؤها شفاءٌ للعين» ادعاء علاجي. البديل: «الكمأة، مكوّن تراثي معروف من زمان»" },
  { code: "CR00185", product: "SCR01", stage: "ready", duration: 22, aspect: "9:16", hook: "نتيجة", angle: "السهولة", dialect: "سوري", policy: "green" },
  { code: "CR00147", product: "TRF01", stage: "live", duration: 26, aspect: "9:16", hook: "سؤال", angle: "التراث", dialect: "سوري", policy: "green", hookRate: 34.9, holdRate: 22, costPerConfirmed: 5.51 },
  { code: "CR00152", product: "TRF01", stage: "live", duration: 21, aspect: "9:16", hook: "سر", angle: "المكوّن", dialect: "سوري", policy: "green", hookRate: 32, holdRate: 20.5, costPerConfirmed: 6.53 },
  { code: "CR00171", product: "TIN01", stage: "live", duration: 18, aspect: "9:16", hook: "مشكلة", angle: "المشكلة", dialect: "سوري", policy: "green", hookRate: 29.6, holdRate: 17.9, costPerConfirmed: 6.39 },
  { code: "CR00131", product: "TRF01", stage: "fatigued", duration: 25, aspect: "9:16", hook: "صدمة", angle: "الثقة", dialect: "سوري", policy: "green", hookRate: 21, holdRate: 14, costPerConfirmed: 8.9 },
  { code: "—", product: "TRF01", stage: "excluded", duration: 24, aspect: "9:16", policy: "green", dupOf: "CR00147" },
];

export const STAGE_FLOW: { key: CreativeStage; label: string; hint: string }[] = [
  { key: "inbox", label: "وارد", hint: "وصل من Drive أو الاستديو، عم ينفحص" },
  { key: "review", label: "بانتظارك", hint: "فحص السياسات بدو قرارك" },
  { key: "ready", label: "جاهز", hint: "متسمّي ومفحوص — بينرفع لميتا لحاله وبيصير جاهز للإعلانات" },
  { key: "live", label: "شغّال", hint: "بإعلان نشط" },
  { key: "fatigued", label: "متعب", hint: "بدو هوكات جديدة — انطلبوا من الاستديو" },
];

// ───────────────────────────── health, alerts, set-up ─────────────────────────────

export interface SourceHealth {
  key: string;
  label: string;
  state: "ok" | "late" | "off";
  detail: string;
}
export const SOURCES: SourceHealth[] = [
  { key: "meta", label: "ميتا", state: "ok", detail: "آخر سحب قبل 12 دقيقة" },
  { key: "oms", label: "الـ OMS", state: "ok", detail: "آخر مزامنة قبل 38 دقيقة" },
  { key: "replies", label: "نظام الردود", state: "ok", detail: "37 رسالة بلا رد · أول رد 6 د" },
  { key: "drive", label: "Google Drive", state: "late", detail: "ما انفحص من ساعتين" },
  { key: "telegram", label: "تيليجرام", state: "off", detail: "مش مربوط لسا" },
];

export interface Alert {
  id: string;
  tone: "danger" | "warn" | "info";
  text: string;
  href?: string;
}
export const ALERTS: Alert[] = [
  { id: "al1", tone: "warn", text: "قطرة الطنين: المخزون بيكفي 4 أيام — التكبير مجمّد لحاله.", href: "/ads?product=TIN01" },
  { id: "al2", tone: "warn", text: "حملة «كمأة جديد - نسخة 3» بلا رمز منتج: صرفها 12.63$ يتيم لحد ما تنسمّى.", href: "/ads?tab=naming" },
  { id: "al3", tone: "info", text: "CR00186 مرفوض من الحارس بسبب ادعاء علاجي، وفي بديل جاهز.", href: "/creatives" },
];

export interface SetupStep {
  key: string;
  title: string;
  why: string;
  how: string;
  /** Who does it: the owner by hand, or the system once the value is in .env. */
  who: "owner" | "system";
  done: boolean;
}
export const SETUP_STEPS: SetupStep[] = [
  { key: "meta", title: "اربط فيسبوك", why: "عشان النظام يقرأ أرقام إعلاناتك بالـ API الرسمي، بلا متصفح.", how: "اعمل تطبيق Meta Developer + System User بصلاحيات على حساباتك بس، وحط الأرقام بملف .env.", who: "owner", done: false },
  { key: "oms", title: "اربط الـ OMS", why: "الحقيقة: الطلبات المؤكدة والمُسلَّمة برقم الإعلان.", how: "الـ OMS بيفتح API قراءة (/orders/attribution) بتوكن خاص بالميديا باير.", who: "owner", done: false },
  { key: "tracking", title: "رقم الإعلان مع كل طلب", why: "بدونه الحقيقة بتصير تقدير على مستوى الحملة.", how: "صفحة الهبوط بتحفظ ad_id و fbclid، ونظام الردود بيلقط رقم الإعلان من أول رسالة.", who: "owner", done: false },
  { key: "products", title: "أرقام المنتجات", why: "الحاسبة: السعر، تكلفة الوحدة، التوصيل والمرتجع.", how: "عبّيها من الإعدادات ← المنتجات، أو بتنسحب من الـ OMS.", who: "owner", done: true },
  { key: "caps", title: "السقف اليومي والشهري", why: "ولا دولار فوقه، ولا حملة جديدة بلاه.", how: "من الإعدادات ← المال والسقوف.", who: "owner", done: true },
  { key: "telegram", title: "بوت تيليجرام", why: "التقرير الصباحي الساعة 9 والتنبيهات الفورية.", how: "اعمل بوت من BotFather وحط التوكن ورقم الشات بملف .env.", who: "owner", done: false },
  { key: "drive", title: "مجلد الفيديوهات على Drive", why: "ترمي الفيديو بـ 01_inbox والنظام بيفحصه وبيسمّيه.", how: "Service Account بصلاحية Editor على مجلد المنتجات.", who: "owner", done: false },
  { key: "models", title: "الموديلات", why: "الوكلاء اللي بيكتبوا التقرير وبيشخّصوا.", how: "Ollama على جهازك شغّال (qwen3:4b). الخارجي اختياري.", who: "system", done: true },
];

export const PACE = { spentToday: 189.6, plannedToday: 320, dailyCap: 350, monthSpent: 4120, monthlyCap: 9000 };
