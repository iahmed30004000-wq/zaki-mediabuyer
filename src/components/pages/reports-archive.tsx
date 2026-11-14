import Link from "next/link";
import { Download } from "lucide-react";
import { EmptyState } from "@/components/ui/card";
import { Panel, Section } from "@/components/mb/section";
import { fmt } from "@/lib/format";
import { CHANGES, PACE, allAds, campaignCounts, productView, sumCounts, viewOf, type Dataset } from "@/lib/mock/data";
import { loadDataset } from "@/lib/source";
import { loadReportsView } from "@/lib/launch-view";

/** The demo morning report (MOCK_MODE=1 only) — exactly as Telegram would receive it (spec 12.1). */
function demoMorningReport(ds: Dataset) {
  const all = sumCounts(ds.campaigns.map(campaignCounts));
  const v = viewOf(all, undefined);
  const products = ds.products.map((p) => productView(p.code, ds)).filter((p) => p.counts.spend > 0);
  const best = allAds(ds).filter((x) => x.view.enoughData && x.view.costPerConfirmed !== null).sort((a, b) => a.view.costPerConfirmed! - b.view.costPerConfirmed!).slice(0, 3);
  const auto = CHANGES.filter((c) => c.auto && c.state === "executed");
  const pending = CHANGES.filter((c) => c.state === "pending_approval");
  const orphan = ds.campaigns.filter((c) => !c.productCode).reduce((s, c) => s + campaignCounts(c).spend * 1.01, 0);
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

/** «التقارير» (inside الإنجاز): the stored reports exactly as they were sent, the day's diagnosis, the week's plan, the lessons. */
export async function ReportsArchive({ selectedId }: { selectedId?: string }) {
  const [ds, reports] = await Promise.all([loadDataset(), loadReportsView(selectedId)]);
  return (
    <div className="space-y-8">
      <Section title={reports?.selected ? reports.selected.label : "التقرير الصباحي"} hint={reports?.selected ? "من الأرشيف — هيك بالضبط انبعت" : "بيوصل تيليجرام الساعة 9 بتوقيت عمّان/دمشق — هيك بالضبط بيبيّن"}>
        <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
          {reports && !reports.selected ? (
            <EmptyState title="لسا ما انكتب تقرير" hint="الصباحي الساعة 9:00 والأسبوعي السبت 10:00 — بيطلعوا هون أول ما ينكتبوا." art="empty-alerts" />
          ) : (
            <Panel>
              <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-fg">{reports?.selected ? reports.selected.text : demoMorningReport(ds)}</pre>
            </Panel>
          )}
          <div className="space-y-3">
            <Panel className="space-y-2">
              <p className="text-sm font-semibold text-fg">الأرشيف</p>
              {reports ? (
                reports.archive.length ? (
                  reports.archive.map((r) => (
                    <Link key={r.id} href={`/done?tab=reports&r=${r.id}`} className={`block text-xs hover:text-accent ${reports.selected?.id === r.id ? "font-semibold text-accent" : "text-fg-muted"}`}>
                      {r.label}{r.sent ? " ✓" : ""}
                    </Link>
                  ))
                ) : (
                  <p className="text-xs text-fg-muted">لسا ما انكتب تقرير — الصباحي 9:00 · الأسبوعي السبت 10:00</p>
                )
              ) : (
                ["الأسبوعي — السبت 24/10", "الصباحي — الأحد 25/10", "الصباحي — السبت 24/10", "الشهري — أيلول"].map((r) => (
                  <p key={r} className="text-xs text-fg-muted">{r}</p>
                ))
              )}
            </Panel>
            <a href="/api/export" className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-surface-1 text-sm font-medium text-fg hover:bg-surface-2">
              <Download className="size-4" /> تصدير Excel (مع شرح كل مؤشر)
            </a>
          </div>
        </div>
      </Section>

      {reports?.analysis?.products.length ? (
        <Section title="تشخيص اليوم" hint={`أضعف خطوة بالقمع لكل منتج، مقابل وسيط حسابك · ${reports.analysis.by}`}>
          <Panel className="divide-y divide-border p-0">
            {reports.analysis.products.map((p) => (
              <div key={p.product_code} className="space-y-0.5 px-4 py-3 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <span dir="ltr" className="font-mono text-xs text-fg">{p.product_code}</span>
                  <span className={p.status === "weak" ? "rounded-md bg-warn/10 px-1.5 py-0.5 text-[11px] font-semibold text-warn" : "rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-muted"}>{{ weak: "ضعيف", watch: "انتبه", good: "ماشي", not_enough: "بيانات غير كافية" }[p.status] ?? p.status}</span>
                  <span className="text-xs text-fg-muted">{{ impressions: "الظهور", hook: "الهوك", click: "النقر", lpv: "الوصول للصفحة", order: "الطلب", confirm: "التأكيد", delivery: "التسليم", return: "المرتجع", none: "—" }[p.weak_point] ?? p.weak_point}</span>
                </p>
                <p className="text-fg">{p.likely_cause} ← {p.proposed_action}</p>
                <p className="text-[11px] text-fg-muted">{p.sample}</p>
              </div>
            ))}
          </Panel>
        </Section>
      ) : null}

      {reports?.plan ? (
        <Section title="خطة الأسبوع" hint={`ضمن السقف حرفياً · ${reports.plan.by}`}>
          <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
            <Panel className="space-y-2">
              {reports.plan.lines.map((l) => (
                <div key={`${l.product}-${l.bucket}`} className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span dir="ltr" className="font-mono text-xs text-fg">{l.product}</span>
                  <span className="text-xs text-fg-muted">{l.bucket}</span>
                  <span dir="ltr" className="font-semibold tabular-nums text-fg">{fmt(l.usd, "$")}</span>
                  <span className="basis-full text-xs text-fg-muted">{l.reason}</span>
                </div>
              ))}
              <p className="border-t border-border pt-2 text-sm font-semibold text-fg">المجموع {fmt(reports.plan.total, "$")} باليوم</p>
            </Panel>
            <Panel className="space-y-2 text-xs">
              {reports.plan.risks.length ? <p className="font-semibold text-warn">مخاطر</p> : null}
              {reports.plan.risks.map((r) => <p key={r} className="text-fg-muted">{r}</p>)}
              {reports.plan.needs.length ? <p className="pt-1 font-semibold text-fg">بدنا فيديوهات</p> : null}
              {reports.plan.needs.map((r) => <p key={r} className="text-fg-muted">{r}</p>)}
            </Panel>
          </div>
        </Section>
      ) : null}

      {reports?.lessons.length ? (
        <Section title="سجل الدروس" hint="بيتسجّل درس بس لما العيّنة كافية والفرق ≥ 15% عن الوسيط">
          <Panel className="space-y-2">
            {reports.lessons.map((l) => (
              <div key={`${l.week}-${l.text}`} className="text-sm">
                <p className="text-fg">{l.text}</p>
                <p className="text-xs text-fg-muted">{l.evidence} · أسبوع {l.week}</p>
              </div>
            ))}
          </Panel>
        </Section>
      ) : null}
    </div>
  );
}
