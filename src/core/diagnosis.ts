/**
 * THE DAILY DIAGNOSIS (M02, spec 11.4) — pure: each product's funnel from impression to collection over the last 3
 * days, against the account's own median (spec 4: no published benchmarks for Syria/Jordan — the system learns its
 * own), and the ONE weakest step. The agent may reword the cause and the action; the step and the numbers are here.
 */
export type WeakPoint = "impressions" | "hook" | "click" | "lpv" | "order" | "confirm" | "delivery" | "return" | "none";

export interface Funnel {
  code: string;
  impressions: number;
  hooks: number;
  clicks: number;
  lpv: number;
  orders: number;
  matureOrders: number;
  confirmed: number;
  shipments: number;
  delivered: number;
  returned: number;
}

type Rates = Record<Exclude<WeakPoint, "impressions" | "none">, number | null>;

const div = (a: number, b: number) => (b > 0 ? a / b : null);
export function ratesOf(f: Funnel): Rates {
  return {
    hook: div(f.hooks, f.impressions),
    click: div(f.clicks, f.impressions),
    lpv: div(f.lpv, f.clicks),
    order: div(f.orders, f.lpv),
    confirm: div(f.confirmed, f.matureOrders),
    delivery: div(f.delivered, f.shipments),
    return: div(f.returned, f.shipments),
  };
}

/** When the account has fewer than 3 products with data: conservative starting points, replaced by its median. */
export const STARTING_POINTS: Rates = { hook: 0.25, click: 0.01, lpv: 0.7, order: 0.06, confirm: 0.65, delivery: 0.75, return: 0.25 };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : null;
};

export function benchmarks(funnels: Funnel[]): Rates {
  const all = funnels.filter((f) => f.impressions >= 3000).map(ratesOf);
  const out = { ...STARTING_POINTS };
  if (all.length < 3) return out;
  for (const k of Object.keys(out) as (keyof Rates)[]) {
    const m = median(all.map((r) => r[k]).filter((v): v is number => v !== null));
    if (m !== null) out[k] = m;
  }
  return out;
}

const CAUSE: Record<WeakPoint, [string, string]> = {
  impressions: ["ما في عرض كافي — ميزانية صغيرة أو المجموعة لسا بتتعلّم", "استنى أو وحّد المجموعات الصغيرة"],
  hook: ["أول 3 ثواني ما بتوقف الناس", "هوكات جديدة على نفس الجسم"],
  click: ["الناس بتتفرج بس ما بتضغط — العرض أو الدعوة للطلب ضعيفة", "جرّب زاوية تانية أو دعوة أوضح للطلب"],
  lpv: ["الضغطات ما بتوصل الصفحة — الصفحة بطيئة أو الرابط فيه مشكلة", "افحص سرعة صفحة الهبوط والرابط"],
  order: ["الصفحة بتنفتح بس ما بيصير طلب — السعر أو الصفحة نفسها", "جرّب صفحة هبوط تانية (اختبار صفحات)"],
  confirm: ["طلبات كتير ما بتتأكد — زبائن مش جديين أو فريق التأكيد مضغوط", "افحص الطلبات الوهمية وقدرة فريق التأكيد"],
  delivery: ["المؤكد ما بيتسلّم — الشحن أو الزبون بيغيّر رأيه", "راجع شركة الشحن ووقت التوصيل"],
  return: ["مرتجع عالي — توقعات الزبون غير الواقع", "خلّي الإعلان أصدق بوصف المنتج"],
  none: ["ما في نقطة ضعف واضحة", "كمّل، والتكبير حسب السلّم"],
};

export interface Diagnosis {
  product_code: string;
  status: "good" | "watch" | "weak" | "not_enough";
  weak_point: WeakPoint;
  likely_cause: string;
  proposed_action: string;
  sample: string;
}

export function diagnose(f: Funnel, bench: Rates): Diagnosis {
  const sample = `3 أيام · ${f.impressions.toLocaleString("en")} ظهور · ${f.orders} طلب · ${f.confirmed} مؤكد ناضج`;
  if (f.impressions < 3000) return { product_code: f.code, status: "not_enough", weak_point: "impressions", likely_cause: CAUSE.impressions[0], proposed_action: CAUSE.impressions[1], sample };
  const r = ratesOf(f);
  // the shortfall of each step against the benchmark (for returns, the excess); small samples are skipped
  const enough: Record<keyof Rates, boolean> = { hook: f.impressions >= 3000, click: f.impressions >= 5000 || f.clicks >= 50, lpv: f.clicks >= 50, order: f.lpv >= 50, confirm: f.matureOrders >= 10, delivery: f.shipments >= 10, return: f.shipments >= 10 };
  let worst: keyof Rates | null = null;
  let gap = 0;
  for (const k of Object.keys(bench) as (keyof Rates)[]) {
    const v = r[k];
    const b = bench[k];
    if (v === null || b === null || !enough[k]) continue;
    const g = k === "return" ? (v - b) / b : (b - v) / b;
    if (g > gap) {
      gap = g;
      worst = k;
    }
  }
  const weak = worst && gap >= 0.2 ? worst : "none";
  return { product_code: f.code, status: weak === "none" ? "good" : gap >= 0.4 ? "weak" : "watch", weak_point: weak, likely_cause: CAUSE[weak][0], proposed_action: CAUSE[weak][1], sample };
}
