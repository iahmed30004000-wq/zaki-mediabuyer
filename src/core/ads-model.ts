/**
 * THE MODEL OF THE ADS' NUMBERS — the shapes the screens read (products, accounts, the campaign tree with its counts) and the pure functions that turn a row of counts into what a screen
 * shows: every derived number goes through the real calculator (src/core/economics.ts). Nothing here is demo data: the demo records are in src/lib/mock/data.ts (v6 · P8 moved the model out of
 * it, so a screen never imports an example — `mockInUi` of the ratchet is 0). No customer data of any kind lives here.
 */
import { computeTruth, estimateTargets, round2, pct1, type Truth } from "./economics";

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

export function sumCounts(list: Counts[]): Counts {
  const z: Counts = { spend: 0, impressions: 0, clicks: 0, v3s: 0, thru: 0, purchases: 0, orders: 0, mature: 0, confirmed: 0, shipments: 0, delivered: 0, returned: 0 };
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
  /** true when the last real OMS sync is older than 3 h (or never ran): every OMS-based figure is «تقدير» */
  omsStale?: boolean;
}

export function productView(code: string, ds: Dataset) {
  const p = ds.products.find((x) => x.code === code)!;
  const rows = ds.campaigns.filter((x) => x.productCode === code);
  const k = sumCounts(rows.map(campaignCounts));
  return { product: p, counts: k, view: viewOf(k, p), targets: targetsOf(p) };
}

/** All the ads, flattened, with their product and view. */
export function allAds(ds: Dataset) {
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
