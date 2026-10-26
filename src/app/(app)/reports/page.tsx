import { Download, ShieldAlert, ShieldCheck } from "lucide-react";
import { Num } from "@/components/mb/num";
import { Panel, Section } from "@/components/mb/section";
import { fmt } from "@/lib/format";
import { CHANGES, PACE, allAds, campaignCounts, productView, sumCounts, viewOf, type Dataset } from "@/lib/mock/data";
import { loadDataset } from "@/lib/source";
import { loadDataHealth, loadReportsView, loadSafety } from "@/lib/launch-view";

export const metadata = { title: "التقارير" };

/** The morning report exactly as Telegram receives it (spec 12.1) — every figure from the calculator. */
function morningReport(ds: Dataset) {
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

export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: { r?: string } }) {
  const [ds, health, safety, reports] = await Promise.all([loadDataset(), loadDataHealth(), loadSafety(), loadReportsView(searchParams.r)]);
  const metrics = health
    ? [
        { l: "نسبة الإسناد", v: health.attributedPct, u: "%" as const, ok: health.attributedPct === null || health.attributedPct >= 80, h: "طلبات الـ OMS اللي إلها رقم إعلان" },
        { l: "أكبر فرق ميتا/حقيقي", v: health.gapWorst?.gap ?? null, u: "%" as const, ok: !health.gapWorst || Math.abs(health.gapWorst.gap) <= 20, h: health.gapWorst ? health.gapWorst.campaign : "تحت 20% سليم", term: "gap" as const },
        { l: "أحداث CAPI مقبولة", v: health.capiAcceptedPct, u: "%" as const, ok: health.capiAcceptedPct === null || health.capiAcceptedPct >= 90, h: `آخر 7 أيام · ${health.capi.sent} انبعت · ${health.capi.pending} بالانتظار · ${health.capi.expired} منتهي` },
        { l: "مرفوض أو بلا معرّف", v: health.capi.rejected + health.capi.skipped, u: undefined, ok: health.capi.rejected === 0, h: `${health.capi.rejected} رفضته ميتا · ${health.capi.skipped} ما إلو معرّف` },
      ]
    : [
        { l: "نسبة الإسناد", v: 86, u: "%" as const, ok: true, h: "طلبات الـ OMS اللي إلها رقم إعلان" },
        { l: "فرق ميتا/حقيقي", v: 8, u: "%" as const, ok: true, h: "تحت 20% سليم", term: "gap" as const },
        { l: "أحداث CAPI مقبولة", v: 97.4, u: "%" as const, ok: true, h: "آخر 24 ساعة" },
        { l: "صرف يتيم", v: 12.63, u: "$" as const, ok: false, h: "حملة بلا رمز منتج" },
      ];
  return (
    <div className="space-y-8">
      <Section title={reports?.selected ? reports.selected.label : "التقرير الصباحي"} hint={reports?.selected ? "من الأرشيف — هيك بالضبط انبعت" : "بيوصل تيليجرام الساعة 9 بتوقيت عمّان/دمشق — هيك بالضبط بيبيّن"}>
        <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
          <Panel>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-fg">{reports?.selected ? reports.selected.text : morningReport(ds)}</pre>
          </Panel>
          <div className="space-y-3">
            <Panel className="space-y-2">
              <p className="text-sm font-semibold text-fg">الأرشيف</p>
              {reports ? (
                reports.archive.length ? (
                  reports.archive.map((r) => (
                    <a key={r.id} href={`/reports?r=${r.id}`} className={`block text-xs hover:text-accent ${reports.selected?.id === r.id ? "font-semibold text-accent" : "text-fg-muted"}`}>
                      {r.label}{r.sent ? " ✓" : ""}
                    </a>
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

      <Section title="صحة البيانات" hint="إذا في أصفر هون، صلّحه أول — كل الأرقام بتعتمد عليه" tour="health">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map((m) => (
            <Panel key={m.l}>
              <p className="text-xs text-fg-muted">{m.l}</p>
              <Num value={m.v} unit={m.u} term={"term" in m ? m.term : undefined} source="truth" big tone={m.ok ? undefined : "warn"} />
              <p className="mt-1 text-[11px] text-fg-muted">{m.h}</p>
            </Panel>
          ))}
        </div>
      </Section>

      {health?.gaps.length ? (
        <Section title="الفرق لكل حملة" hint="ميتا مقابل طلبات الـ OMS من صفحات الهبوط، آخر 7 أيام — الأسوأ أول">
          <Panel className="space-y-2">
            {health.gaps.slice(0, 8).map((g) => (
              <div key={g.campaign} className="flex flex-wrap items-baseline gap-2 text-sm">
                <span dir="ltr" className="font-mono text-xs text-fg">{g.campaign}</span>
                <span className={Math.abs(g.gap) > 20 ? "font-semibold text-warn" : "text-fg-muted"} dir="ltr">{g.gap > 0 ? "+" : ""}{g.gap}%</span>
                <span className="text-xs text-fg-muted">{g.cause}</span>
              </div>
            ))}
          </Panel>
        </Section>
      ) : null}

      <Section title="سلامة الحسابات" hint="الرفض، الدفع، والقيود — أي مشكلة بتنزّل مستوى الحساب لصفر فوراً">
        {safety ? (
          <div className="grid gap-3 md:grid-cols-2">
            {safety.map((a) => (
              <Panel key={a.metaId} className="space-y-2">
                <div className="flex items-start gap-3">
                  {a.verdict === "ok" ? <ShieldCheck className="mt-0.5 size-5 text-ok" /> : <ShieldAlert className={a.verdict === "restricted" ? "mt-0.5 size-5 text-danger" : "mt-0.5 size-5 text-warn"} />}
                  <div className="space-y-1 text-sm">
                    <p className="font-semibold text-fg">{a.name}</p>
                    <p className="text-xs text-fg-muted">{a.status}{a.notes.length ? ` · ${a.notes.join(" · ")}` : " · ولا رفض آخر 24 ساعة · الدفع سليم"}</p>
                    {a.frozenUntil ? <p className="text-xs text-warn">الإنشاء مجمّد لـ {a.frozenUntil}</p> : null}
                  </div>
                </div>
                {a.issues.map((i) => (
                  <details key={i.id} className="rounded-lg border border-border p-2 text-xs">
                    <summary className="cursor-pointer text-fg">
                      <span dir="ltr" className="font-mono">{i.adName}</span> انرفض — {i.reasons}
                    </summary>
                    {i.draft ? <pre className="mt-2 whitespace-pre-wrap font-sans leading-6 text-fg-muted">{i.draft}</pre> : <p className="mt-2 text-fg-muted">المسودة بتنكتب بالفحص الجاي</p>}
                  </details>
                ))}
              </Panel>
            ))}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {ds.accounts.map((a) => (
              <Panel key={a.id} className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 size-5 text-ok" />
                <div className="space-y-1 text-sm">
                  <p className="font-semibold text-fg">{a.name}</p>
                  <p className="text-xs text-fg-muted">ولا رفض آخر 24 ساعة · الدفع سليم · بلا قيود{a.note ? ` · ${a.note}` : ""}</p>
                </div>
              </Panel>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
