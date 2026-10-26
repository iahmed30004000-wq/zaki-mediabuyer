/**
 * THE WEEKLY REVIEW (spec 12.2, T5.3) — pure: the week against the last one per product, the rankings by concept,
 * angle, hook, page and landing page (each with its sample warning), the pixel ↔ OMS ↔ delivered reconciliation,
 * the lessons worth keeping, and how often the system's own decisions held. The text is built here too, so every
 * figure in the report is the code's.
 */
export interface ProductWeek {
  code: string;
  name: string;
  spend: number;
  orders: number;
  matureOrders: number;
  confirmed: number;
  shipments: number;
  delivered: number;
  profit: number;
}

export interface ProductCompare extends ProductWeek {
  C: number | null;
  D: number | null;
  profitPerDelivered: number | null;
  costPerConfirmed: number | null;
  last: { spend: number; confirmed: number; delivered: number; profitPerDelivered: number | null; costPerConfirmed: number | null } | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const div = (a: number, b: number) => (b > 0 ? a / b : null);

export function compareWeeks(thisWeek: ProductWeek[], lastWeek: ProductWeek[]): ProductCompare[] {
  return thisWeek
    .map((p) => {
      const l = lastWeek.find((x) => x.code === p.code);
      return {
        ...p,
        C: div(p.confirmed, p.matureOrders),
        D: div(p.delivered, p.shipments),
        profitPerDelivered: p.delivered ? r2(p.profit / p.delivered) : null,
        costPerConfirmed: p.confirmed ? r2(p.spend / p.confirmed) : null,
        last: l ? { spend: l.spend, confirmed: l.confirmed, delivered: l.delivered, profitPerDelivered: l.delivered ? r2(l.profit / l.delivered) : null, costPerConfirmed: l.confirmed ? r2(l.spend / l.confirmed) : null } : null,
      };
    })
    .sort((a, b) => b.spend - a.spend);
}

export interface RankRow {
  key: string;
  spend: number;
  confirmed: number;
  cost: number | null;
  /** fewer than the minimum confirmed: shown, never trusted */
  smallSample: boolean;
}

export function rankBy(rows: { key: string; spend: number; confirmed: number }[], minConfirmed = 5): RankRow[] {
  const merged = new Map<string, { spend: number; confirmed: number }>();
  for (const r of rows) {
    const m = merged.get(r.key) ?? { spend: 0, confirmed: 0 };
    m.spend += r.spend;
    m.confirmed += r.confirmed;
    merged.set(r.key, m);
  }
  return [...merged.entries()]
    .map(([key, m]) => ({ key, spend: r2(m.spend), confirmed: m.confirmed, cost: m.confirmed ? r2(m.spend / m.confirmed) : null, smallSample: m.confirmed < minConfirmed }))
    .sort((a, b) => Number(a.smallSample) - Number(b.smallSample) || (a.cost ?? Infinity) - (b.cost ?? Infinity));
}

export interface Lesson {
  key: string;
  text: string;
  evidence: string;
}

export const DIMENSION_AR: Record<string, string> = { concept: "المفهوم", angle: "الزاوية", hook: "الخطّاف", page: "الصفحة", lp: "صفحة الهبوط" };

/** A lesson = within one dimension, a key with enough sample that is ≥ 15% cheaper per confirmed than the median. */
export function lessonsFrom(rankings: Record<string, RankRow[]>): Lesson[] {
  const out: Lesson[] = [];
  for (const [dim, rows] of Object.entries(rankings)) {
    const ok = rows.filter((r) => !r.smallSample && r.cost !== null);
    if (ok.length < 2) continue;
    const costs = ok.map((r) => r.cost!).sort((a, b) => a - b);
    const median = costs.length % 2 ? costs[(costs.length - 1) / 2]! : (costs[costs.length / 2 - 1]! + costs[costs.length / 2]!) / 2;
    const best = ok[0]!;
    if (best.cost! <= median * 0.85) {
      out.push({
        key: `${dim}:${best.key}`,
        text: `${DIMENSION_AR[dim] ?? dim} ${best.key} أرخص مؤكد هالأسبوع: ${best.cost!.toFixed(2)}$ مقابل الوسيط ${r2(median).toFixed(2)}$`,
        evidence: `${best.confirmed} مؤكد ناضج · صرف ${best.spend.toFixed(2)}$ · من ${ok.length} بعيّنة كافية`,
      });
    }
  }
  return out;
}

export interface DecisionRow {
  source: string;
  kind: string;
  state: string;
  executedAt: Date | null;
  rolledBackAt: Date | null;
}

/** How often the code's own automatic decisions held: executed by a rule and not undone within 72 h. */
export function decisionAccuracy(rows: DecisionRow[]): { auto: number; heldPct: number | null; undone: number } {
  const auto = rows.filter((r) => r.source === "rule" && (r.state === "executed" || r.state === "rolled_back") && r.executedAt);
  const undone = auto.filter((r) => r.state === "rolled_back" && r.rolledBackAt && r.rolledBackAt.getTime() - r.executedAt!.getTime() <= 72 * 3_600_000).length;
  return { auto: auto.length, heldPct: auto.length ? Math.round(((auto.length - undone) / auto.length) * 1000) / 10 : null, undone };
}

const usd = (n: number | null) => (n === null ? "—" : `${n.toFixed(2)}$`);
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
const arrow = (now: number | null, before: number | null, lowerIsBetter = false) => {
  if (now === null || before === null || before === 0) return "";
  const d = Math.round(((now - before) / before) * 100);
  if (d === 0) return " (=)";
  const good = lowerIsBetter ? d < 0 : d > 0;
  return ` (${d > 0 ? "+" : ""}${d}% ${good ? "▲" : "▼"})`;
};

export interface WeeklyInput {
  title: string;
  products: ProductCompare[];
  rankings: Record<string, RankRow[]>;
  reconciliation: { pixelPurchases: number; omsWebOrders: number; delivered: number };
  changes: { auto: number; approved: number; rejected: number; rolledBack: number; pending: number };
  tests: string[];
  lessons: Lesson[];
  winners: string[];
  fatigued: string[];
  plan: string[];
  accuracy?: { auto: number; heldPct: number | null; undone: number };
}

export function weeklyText(w: WeeklyInput): string {
  const top = (dim: string) => (w.rankings[dim] ?? []).slice(0, 3).map((r) => `${r.key} ${usd(r.cost)}${r.smallSample ? " (عيّنة صغيرة)" : ""}`).join(" · ") || "—";
  return [
    w.title,
    "(الحقيقة على الطلبات الناضجة | المقارنة بالأسبوع الماضي)",
    "",
    "1) لكل منتج:",
    ...(w.products.length
      ? w.products.map((p) => `   ${p.name}: صرف ${usd(r2(p.spend))}${arrow(p.spend, p.last?.spend ?? null)} · مؤكد ${p.confirmed}${arrow(p.confirmed, p.last?.confirmed ?? null)} · تكلفة المؤكد ${usd(p.costPerConfirmed)}${arrow(p.costPerConfirmed, p.last?.costPerConfirmed ?? null, true)} · C ${pct(p.C)} · D ${pct(p.D)} · ربح المُسلَّم ${usd(p.profitPerDelivered)}${arrow(p.profitPerDelivered, p.last?.profitPerDelivered ?? null)}`)
      : ["   ما في صرف هالأسبوع"]),
    "2) الترتيب على تكلفة المؤكد:",
    `   المفهوم: ${top("concept")}`,
    `   الزاوية: ${top("angle")}`,
    `   الخطّاف: ${top("hook")}`,
    `   الصفحات: ${top("page")}`,
    `   صفحات الهبوط: ${top("lp")}`,
    `3) المطابقة: Purchase بكسل ${w.reconciliation.pixelPurchases} ↔ طلبات OMS من الموقع ${w.reconciliation.omsWebOrders} ↔ مُسلَّم منها ${w.reconciliation.delivered}`,
    `4) القرارات: ${w.changes.auto} تلقائي · ${w.changes.approved} بموافقتك · ${w.changes.rejected} رفضتها · ${w.changes.rolledBack} انرجعت · ${w.changes.pending} لسا بانتظارك`,
    `5) الاختبارات: ${w.tests.length ? w.tests.join(" | ") : "ما خلص اختبار هالأسبوع"}`,
    `6) الإبداعات: رابحة ${w.winners.join(" · ") || "—"} · متعبة ${w.fatigued.join(" · ") || "—"}`,
    `7) دروس الأسبوع: ${w.lessons.length ? w.lessons.map((l) => l.text).join(" | ") : "ما في درس بعيّنة كافية"}`,
    `8) خطة الأسبوع الجاي: ${w.plan.join(" · ") || "—"}`,
    ...(w.accuracy ? [`9) دقة قرارات النظام: ${w.accuracy.auto} قرار تلقائي · ${w.accuracy.heldPct ?? "—"}% ضلّت (${w.accuracy.undone} انرجعت خلال 72 ساعة)`] : []),
  ].join("\n");
}
