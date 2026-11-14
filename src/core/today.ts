/**
 * «اليوم» — the arithmetic of the home screen (v3 · B), pure: the four numbers (spend, real orders, cost per real
 * order, estimated profit) compared across today, yesterday and the 7-day average, and the alerts that must never be
 * missed. The code computes; nothing here reads a database or a clock.
 *
 *   تكلفة الطلب الحقيقي = (الصرف + رسوم البطاقة) ÷ الطلبات الحقيقية من الـ OMS (أو من أرقام Claude لحد ما ينربط)
 *   الربح التقديري      = الطلبات × هامش الطلب المتوقع للمنتج − الصرف الفعلي  (تقدير — بيصير حقيقي لما تتسلّم الشحنات)
 */
import type { Urgency } from "./mode";
import { breakevenOf, type CampaignRules } from "./rules-v2";
import { stockUrgency } from "./stock-alerts";

export interface DayNumbers {
  /** Meta spend plus the card's fee, USD */
  spend: number | null;
  /** real orders (OMS) placed that day */
  orders: number | null;
  costPerOrder: number | null;
  /** estimated profit (see above); null when no product has numbers yet */
  profit: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function costPerOrder(spend: number, orders: number): number | null {
  return orders > 0 ? r2(spend / orders) : null;
}

/** How much a number moved, as a share of the base; `flat` inside ±2%. Null when there is nothing to compare with. */
export function change(now: number | null, base: number | null): { pct: number | null; dir: "up" | "down" | "flat" } {
  if (now === null || base === null || base === 0) return { pct: null, dir: "flat" };
  const pct = r2(((now - base) / Math.abs(base)) * 100);
  return { pct, dir: Math.abs(pct) < 2 ? "flat" : pct > 0 ? "up" : "down" };
}

/** The mean of whole days. Cost per order is total spend over total orders (never a mean of ratios). Days without data are left out. */
export function averageDays(days: DayNumbers[]): DayNumbers {
  const withSpend = days.filter((d) => d.spend !== null);
  if (!withSpend.length) return { spend: null, orders: null, costPerOrder: null, profit: null };
  const spend = withSpend.reduce((s, d) => s + (d.spend ?? 0), 0);
  const orders = withSpend.reduce((s, d) => s + (d.orders ?? 0), 0);
  const profits = withSpend.map((d) => d.profit).filter((p): p is number => p !== null);
  return { spend: r2(spend / withSpend.length), orders: r2(orders / withSpend.length), costPerOrder: costPerOrder(spend, orders), profit: profits.length ? r2(profits.reduce((s, p) => s + p, 0) / profits.length) : null };
}

/** The share of today's spend that went into tests (null with no spend). */
export function testShare(test: number, total: number): number | null {
  return total > 0 ? Math.round((test / total) * 1000) / 1000 : null;
}

/** A campaign stage that is a test (naming spec 5.1): TEST · CRT · AUD · OFR. SCALE is not, and an unreadable name is unknown. */
export const isTestStage = (stage: string | null | undefined): boolean => !!stage && ["TEST", "CRT", "AUD", "OFR"].includes(stage);

export interface TodayAlert {
  key: string;
  tone: "danger" | "warn" | "info";
  text: string;
  href: string;
}

export interface AlertInput {
  /** share of the day's spend in tests, and the limit the owner set (the plan's test share, 20% by default) */
  testShare: number | null;
  testLimit: number;
  /** each product's real cost per order over the judged days (null with no orders), and its orders */
  products: { code: string; name?: string; cost: number | null; orders: number }[];
  /** campaigns that spent past the owner's «no sale» threshold and have no real order */
  zeroOrders: { name: string; spend: number }[];
  /** the newest days of cover per product */
  stock: { code: string; days: number }[];
  rules: CampaignRules;
}

const TONE: Record<Urgency, TodayAlert["tone"]> = { red: "danger", orange: "warn", yellow: "info" };
const ORDER = { danger: 0, warn: 1, info: 2 } as const;

/** The strip at the top of اليوم: what must not be missed. Silent checks stay silent: no break-even typed → no break-even alert. */
export function buildAlerts(i: AlertInput): TodayAlert[] {
  const out: TodayAlert[] = [];
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  if (i.testShare !== null && i.testShare > i.testLimit) {
    out.push({
      key: "test-share",
      tone: i.testShare > i.testLimit * 1.5 ? "danger" : "warn",
      text: `الاختبارات أخدت ${pct(i.testShare)} من صرف اليوم (الحد ${pct(i.testLimit)}) — الأرقام الكبيرة بتنحرق على اختبارات`,
      href: "/ads",
    });
  }
  for (const p of i.products) {
    const be = breakevenOf(i.rules, p.code);
    if (be !== null && p.cost !== null && p.orders > 0 && p.cost > be) {
      out.push({ key: `be:${p.code}`, tone: "danger", text: `${p.name ?? p.code}: تكلفة الطلب الحقيقي ${r2(p.cost)}$ فوق نقطة التعادل (${be}$) آخر ${i.rules.judgeDays} أيام`, href: `/ads?product=${encodeURIComponent(p.code)}` });
    }
  }
  for (const c of i.zeroOrders) out.push({ key: `zero:${c.name}`, tone: "warn", text: `حملة «${c.name}» صرفت ${r2(c.spend)}$ وما إلها ولا طلب حقيقي`, href: "/ads" });
  for (const s of i.stock) {
    const u = stockUrgency(s.days, i.rules.stock);
    if (u) out.push({ key: `stock:${s.code}`, tone: TONE[u], text: `مخزون ${s.code}: بيكفي ${Math.round(s.days * 10) / 10} يوم`, href: `/ads?product=${encodeURIComponent(s.code)}` });
  }
  return out.sort((a, b) => ORDER[a.tone] - ORDER[b.tone]);
}
