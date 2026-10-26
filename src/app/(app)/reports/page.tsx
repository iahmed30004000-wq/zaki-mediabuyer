import { Download, ShieldCheck } from "lucide-react";
import { Num } from "@/components/mb/num";
import { Panel, Section } from "@/components/mb/section";
import { fmt } from "@/lib/format";
import { ACCOUNTS, CAMPAIGNS, CHANGES, PACE, allAds, campaignCounts, productView, sumCounts, viewOf } from "@/lib/mock/data";

export const metadata = { title: "التقارير" };

/** The morning report exactly as Telegram receives it (spec 12.1) — every figure from the calculator. */
function morningReport() {
  const all = sumCounts(CAMPAIGNS.map(campaignCounts));
  const v = viewOf(all, undefined);
  const products = ["TRF01", "TIN01", "SCR01", "NFG01"].map(productView).filter((p) => p.counts.spend > 0);
  const best = allAds().filter((x) => x.view.enoughData && x.view.costPerConfirmed !== null).sort((a, b) => a.view.costPerConfirmed! - b.view.costPerConfirmed!).slice(0, 3);
  const auto = CHANGES.filter((c) => c.auto && c.state === "executed");
  const pending = CHANGES.filter((c) => c.state === "pending_approval");
  const orphan = CAMPAIGNS.filter((c) => !c.productCode).reduce((s, c) => s + campaignCounts(c).spend * 1.01, 0);
  return [
    "تقرير الإعلانات — الاثنين 26 تشرين الأول",
    "(الإسناد: 7d click | أمس رقم مبدئي | الحقيقة على الطلبات الناضجة)",
    "",
    `1) الحساب: صرف أمس ${fmt(PACE.spentToday, "$")} (خطة ${fmt(PACE.plannedToday, "$", 0)}) · طلبات ${all.orders} · مؤكد ${all.confirmed} · تكلفة المؤكد ${fmt(v.costPerConfirmed, "$")}`,
    "2) لكل منتج:",
    ...products.map((p) => `   ${p.product.name}: صرف ${fmt(p.view.spend, "$")} · تكلفة المؤكد ${fmt(p.view.costPerConfirmed, "$")} (السقف ${fmt(p.view.ceiling, "$")}) · ربح المُسلَّم ${fmt(p.view.profitPerDelivered, "$")} [${p.targets.estimated ? "تقدير" : "حقيقي"}]`),
    "3) أفضل 3 إعلانات:",
    ...best.map((b) => `   ${b.ad.name.split("_")[0]} · صرف ${fmt(b.view.spend, "$")} · مؤكد ${fmt(b.view.costPerConfirmed, "$")} · Hook ${fmt(b.view.hook, "%")}`),
    "5) قرارات الأمان:",
    ...auto.map((c) => `   ${c.sentence}`),
    `7) بانتظار موافقتك: ${pending.length} تغييرات (+${fmt(pending.reduce((s, c) => s + c.spendDeltaDaily, 0), "$", 0)} باليوم) [افتح بالموقع]`,
    `8) صحة البيانات: نسبة الإسناد 86% · فرق ميتا/حقيقي ${v.gap ?? "—"}% · صرف يتيم ${fmt(orphan, "$")}`,
  ].join("\n");
}

export default function ReportsPage() {
  return (
    <div className="space-y-8">
      <Section title="التقرير الصباحي" hint="بيوصل تيليجرام الساعة 9 بتوقيت عمّان/دمشق — هيك بالضبط بيبيّن">
        <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
          <Panel>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-fg">{morningReport()}</pre>
          </Panel>
          <div className="space-y-3">
            <Panel className="space-y-2">
              <p className="text-sm font-semibold text-fg">الأرشيف</p>
              {["الأسبوعي — السبت 24/10", "الصباحي — الأحد 25/10", "الصباحي — السبت 24/10", "الشهري — أيلول"].map((r) => (
                <p key={r} className="text-xs text-fg-muted">{r}</p>
              ))}
            </Panel>
            <a href="/api/export" className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-surface-1 text-sm font-medium text-fg hover:bg-surface-2">
              <Download className="size-4" /> تصدير Excel (مع شرح كل مؤشر)
            </a>
          </div>
        </div>
      </Section>

      <Section title="صحة البيانات" hint="إذا في أصفر هون، صلّحه أول — كل الأرقام بتعتمد عليه" tour="health">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { l: "نسبة الإسناد", v: 86, u: "%" as const, ok: true, h: "طلبات الـ OMS اللي إلها رقم إعلان" },
            { l: "فرق ميتا/حقيقي", v: 8, u: "%" as const, ok: true, h: "تحت 20% سليم", term: "gap" as const },
            { l: "أحداث CAPI مقبولة", v: 97.4, u: "%" as const, ok: true, h: "آخر 24 ساعة" },
            { l: "صرف يتيم", v: 12.63, u: "$" as const, ok: false, h: "حملة بلا رمز منتج" },
          ].map((m) => (
            <Panel key={m.l}>
              <p className="text-xs text-fg-muted">{m.l}</p>
              <Num value={m.v} unit={m.u} term={m.term} source="truth" big tone={m.ok ? undefined : "warn"} />
              <p className="mt-1 text-[11px] text-fg-muted">{m.h}</p>
            </Panel>
          ))}
        </div>
      </Section>

      <Section title="سلامة الحسابات" hint="الرفض، الدفع، والقيود — أي مشكلة بتنزّل مستوى الحساب لصفر فوراً">
        <div className="grid gap-3 md:grid-cols-2">
          {ACCOUNTS.map((a) => (
            <Panel key={a.id} className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 size-5 text-ok" />
              <div className="space-y-1 text-sm">
                <p className="font-semibold text-fg">{a.name}</p>
                <p className="text-xs text-fg-muted">ولا رفض آخر 24 ساعة · الدفع سليم · بلا قيود{a.note ? ` · ${a.note}` : ""}</p>
              </div>
            </Panel>
          ))}
        </div>
      </Section>
    </div>
  );
}
