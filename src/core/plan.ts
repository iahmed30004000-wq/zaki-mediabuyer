/**
 * THE WEEKLY PLAN (M03, spec 11.4 / 5.5) — the numbers are the code's: the daily cap split 70% scale · 20% test ·
 * 10% new (the owner's split), scale money shared by profit per DELIVERED order, a product with < 5 days of stock
 * never gets more than it spends now, a losing product gets nothing. The agent only explains and adds risks; the
 * total can never pass the cap because the agent never writes a number.
 */
import { creativeTestBudget } from "./experiments";

export interface PlanProduct {
  code: string;
  name: string;
  /** true profit per delivered order (null = no delivered yet) */
  profitPerDelivered: number | null;
  estimated: boolean;
  losing: boolean;
  stockDays: number | null;
  tOrder: number;
  /** average daily spend over the last 7 days */
  spendNow: number;
}

export interface Allocation {
  product_code: string;
  bucket: "scale" | "test" | "new";
  usd: number;
  reason: string;
}

export interface WeeklyPlan {
  daily_allocation: Allocation[];
  total_usd: number;
  tests: { kind: "creative" | "audience" | "offer" | "product" | "landing"; product_code: string; hypothesis: string; budget_usd: number; days: number }[];
  creative_needs: string[];
  risks: string[];
}

const c2 = (n: number) => Math.floor(n * 100) / 100;

export function planWeek(i: { dailyCap: number; split: { scale: number; test: number; new: number }; products: PlanProduct[] }): WeeklyPlan {
  const out: Allocation[] = [];
  const risks: string[] = [];
  const creative_needs: string[] = [];
  const tests: WeeklyPlan["tests"] = [];

  const scaleMoney = i.dailyCap * i.split.scale;
  const winners = i.products.filter((p) => !p.losing && (p.profitPerDelivered ?? 0) > 0);
  const weight = winners.reduce((n, p) => n + p.profitPerDelivered!, 0);
  let leftover = 0;
  for (const p of winners) {
    let usd = c2((scaleMoney * p.profitPerDelivered!) / weight);
    let reason = `ربح المُسلَّم ${p.profitPerDelivered!.toFixed(2)}$${p.estimated ? " (تقدير)" : ""} — حصته من التكبير على قد ربحه`;
    if (p.stockDays !== null && p.stockDays < 5 && usd > p.spendNow) {
      leftover += usd - c2(p.spendNow);
      usd = c2(p.spendNow);
      reason = `المخزون بيكفي ${p.stockDays} أيام — ما بيزيد عن صرفه الحالي`;
      risks.push(`${p.name}: المخزون قليل (${p.stockDays} أيام)`);
    }
    if (usd > 0) out.push({ product_code: p.code, bucket: "scale", usd, reason });
    creative_needs.push(`${p.name}: 3 فيديوهات جديدة بنفس الزاوية الرابحة عشان ما يتعب`);
  }
  if (!winners.length) risks.push("ولا منتج ربحان بالحقيقة لهلأ — التكبير صفر لحد ما يثبت واحد");
  if (leftover > 0) risks.push(`${leftover.toFixed(2)}$ من التكبير ما انوزّعت (مخزون قليل) — بتضل بالسقف`);

  const testable = i.products.filter((p) => !p.losing && (p.stockDays === null || p.stockDays >= 5));
  const testMoney = i.dailyCap * i.split.test;
  if (testable.length) {
    const each = c2(testMoney / testable.length);
    for (const p of testable) {
      const perSet = creativeTestBudget(p.tOrder);
      if (each < perSet) {
        risks.push(`${p.name}: ميزانية الاختبار ${each.toFixed(2)}$ باليوم أقل من ${perSet}$ اللي بيحتاجها مفهوم واحد`);
        continue;
      }
      const concepts = Math.max(1, Math.floor(each / perSet));
      out.push({ product_code: p.code, bucket: "test", usd: c2(concepts * perSet), reason: `${concepts} مفهوم × ${perSet}$ (أكبر من 15$ و 3 × هدف الطلب)` });
      tests.push({ kind: "creative", product_code: p.code, hypothesis: `مفهوم جديد بيجيب مؤكد أرخص من الحالي لـ ${p.name}`, budget_usd: c2(concepts * perSet * 4), days: 4 });
    }
  }
  for (const p of i.products.filter((x) => x.losing)) risks.push(`${p.name}: خسران بأرقامه الحالية — ولا دولار لحد ما تتغيّر الأسعار أو التكاليف`);

  const newMoney = c2(i.dailyCap * i.split.new);
  if (newMoney >= 15) {
    out.push({ product_code: "NEW", bucket: "new", usd: newMoney, reason: "منتج جديد أو عرض جديد — بس من خطة معتمدة منك" });
    tests.push({ kind: "product", product_code: "NEW", hypothesis: "منتج جديد بيقدر يوصل هدف الطلب بأول 5 أيام", budget_usd: c2(newMoney * 5), days: 5 });
  }

  let total = c2(out.reduce((n, a) => n + a.usd, 0));
  // never above the cap, whatever the rounding did
  while (total > i.dailyCap && out.length) {
    const last = out[out.length - 1]!;
    last.usd = c2(Math.max(0, last.usd - (total - i.dailyCap)));
    total = c2(out.reduce((n, a) => n + a.usd, 0));
  }
  return { daily_allocation: out.filter((a) => a.usd > 0), total_usd: total, tests, creative_needs, risks };
}
