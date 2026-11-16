import Link from "next/link";
import { CheckCircle2, CircleDot, CreditCard } from "lucide-react";
import { ApprovalCard } from "@/components/approvals/approval-card";
import { AlertStrip } from "@/components/home/alert-strip";
import { ModeSwitch } from "@/components/home/mode-switch";
import { MorningCard } from "@/components/home/morning-card";
import { NumberCard } from "@/components/home/number-card";
import { ChangeCard } from "@/components/mb/change-card";
import { LevelStars } from "@/components/mb/level-stars";
import { Num } from "@/components/mb/num";
import { PaceBar, Panel, Section } from "@/components/mb/section";
import { fmt } from "@/lib/format";
import { loadChanges, type ChangeView } from "@/lib/changes-view";
import { PACE, SOURCES, allAds } from "@/lib/mock/data";
import { isDemo } from "@/core/readiness";
import { loadEditView } from "@/lib/settings-view";
import { loadDataset } from "@/lib/source";
import { loadMorning, loadToday } from "@/lib/today-view";
import { currentMode } from "@/server/mode";
import { cn } from "@/lib/utils";

export const metadata = { title: "الرئيسية" };
export const dynamic = "force-dynamic";

/**
 * الرئيسية: the owner's board — the mode switch and last night's card, then what must not be missed, what waits, the pace, the best by
 * the truth. (The numbers per product are `/products`.) A screen is real or it is demo, never both. P4 rebuilds it from the kit.
 */
export default async function HomePage() {
  const [changes, mode, morning] = await Promise.all([loadChanges(), currentMode(), loadMorning()]);
  const demo = isDemo(process.env);

  return (
    <div className="space-y-4 sm:space-y-6">
      <ModeSwitch initial={{ mode: mode.mode, since: mode.since, schedule: mode.schedule }} demo={demo} />
      {morning ? <MorningCard m={morning} /> : null}
      <SummaryTab changes={changes} />
    </div>
  );
}

/** «الملخص»: the four numbers, what must not be missed, the three short lists, the pace, the best by the truth. */
async function SummaryTab({ changes }: { changes: ChangeView[] }) {
  const [ds, view, edit] = await Promise.all([loadDataset(), loadToday(), loadEditView()]);
  const pending = changes.filter((c) => c.state === "pending_approval");
  const auto = changes.filter((c) => c.state === "executed" && c.auto);
  const links = edit?.links ?? SOURCES;
  const ranked = allAds(ds).filter((x) => x.view.enoughData && x.view.costPerConfirmed !== null);
  const best = [...ranked].sort((a, b) => a.view.costPerConfirmed! - b.view.costPerConfirmed!).slice(0, 3);
  const untested = allAds(ds).filter((x) => x.ad.status === "untested").length;
  const waiting = pending.length + view.approvals.length;
  const pace = edit
    ? { spent: ds.accounts.reduce((s, a) => s + a.spentToday, 0), plan: ds.accounts.reduce((s, a) => s + a.plannedToday, 0), cap: ds.accounts.reduce((s, a) => s + a.dailyCap, 0) }
    : { spent: PACE.spentToday, plan: PACE.plannedToday, cap: PACE.dailyCap };
  const costTone = view.today.costPerOrder === null ? undefined : view.avg7.costPerOrder !== null && view.today.costPerOrder > view.avg7.costPerOrder * 1.2 ? ("danger" as const) : undefined;

  return (
    <div className="space-y-6">

      <Section title="أرقام اليوم" hint="اليوم مقابل أمس ومعدّل آخر 7 أيام — كل رقم بيشرح حاله بضغطة" tour="numbers">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <NumberCard label="الصرف الفعلي" term="spend" unit="$" field="spend" today={view.today} yesterday={view.yesterday} avg7={view.avg7} good="none" />
          <NumberCard label="الطلبات الحقيقية" term="realOrders" unit="" field="orders" today={view.today} yesterday={view.yesterday} avg7={view.avg7} good="up" />
          <NumberCard label="تكلفة الطلب الحقيقي" term="costPerOrder" unit="$" field="costPerOrder" today={view.today} yesterday={view.yesterday} avg7={view.avg7} good="down" tone={costTone} />
          <NumberCard label="الربح التقديري" term="profitEst" unit="$" field="profit" today={view.today} yesterday={view.yesterday} avg7={view.avg7} good="up" />
        </div>
        {view.testShare !== null ? (
          <p className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            حصة الاختبارات من صرف اليوم: <Num value={Math.round(view.testShare * 1000) / 10} unit="%" term="testShare" tone={view.testShare > view.testLimit ? "danger" : undefined} /> <span>(الحد {Math.round(view.testLimit * 100)}%)</span>
          </p>
        ) : null}
      </Section>

      <Section title="لازم تنتبه" hint={view.missingRules ? `ناقص ${view.missingRules} رقم بقواعد الحملات — بعض الفحوصات صامتة لحد ما تكتبهم` : undefined} link={view.missingRules ? { href: "/settings#campaign-rules", label: "اكتبهم" } : undefined}>
        <AlertStrip alerts={view.alerts} />
      </Section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="بانتظار موافقتك" tour="approvals" link={{ href: "/inbox", label: "كلهم" }}>
          <div className="space-y-3">
            {view.approvals.slice(0, 3).map((a) => <ApprovalCard key={a.id} approval={a} compact />)}
            {pending.slice(0, 3).map((c) => <ChangeCard key={c.id} change={c} />)}
            {!waiting ? (
              <Panel className="flex items-center gap-2 text-sm text-fg-muted">
                <CheckCircle2 className="size-4 text-ok" /> ما في شي بانتظارك.
              </Panel>
            ) : null}
          </div>
        </Section>
        <Section title="متوقف" hint="خطوات واقفة ومين رح يكمّلها" link={{ href: "/work", label: "الشغل" }}>
          <Panel className="divide-y divide-border p-0">
            {view.stalled.map((s) => (
              <Link key={s.key} href={s.href} className="block px-4 py-3 hover:bg-surface-2">
                <p className="text-sm font-medium text-fg">{s.title}</p>
                <p className="text-xs text-fg-muted">{s.detail}</p>
              </Link>
            ))}
            {!view.stalled.length ? <p className="px-4 py-3 text-sm text-fg-muted">ولا شي واقف.</p> : null}
          </Panel>
        </Section>
        <Section title="مهام اليوم" link={{ href: "/work/tasks", label: "كل المهام" }}>
          <Panel className="divide-y divide-border p-0">
            {view.tasks.map((t) => (
              <Link key={t.id} href="/work/tasks" className="flex items-start gap-2 px-4 py-3 hover:bg-surface-2">
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", t.priority === "urgent" || t.priority === "high" ? "bg-warn" : "bg-fg-muted/40")} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-fg">{t.title}</span>
                  <span className="block text-xs text-fg-muted">{t.assignee ?? "بلا مسؤول"}</span>
                </span>
              </Link>
            ))}
            {!view.tasks.length ? <p className="px-4 py-3 text-sm text-fg-muted">ما في مهام لليوم.</p> : null}
          </Panel>
        </Section>
      </div>

      <Section title="الوتيرة اليوم" hint="الصرف لهلأ مقابل الخطة (الخط الرمادي) والسقف (الخط الأحمر)" tour="pace">
        <div className="grid gap-3 md:grid-cols-3">
          <Panel className="md:col-span-1">
            <p className="text-xs text-fg-muted">كل الحسابات</p>
            <div className="mt-1 flex items-baseline gap-2">
              <Num value={pace.spent} unit="$" term="spend" big />
              {pace.plan ? <span className="text-xs text-fg-muted">من خطة {fmt(pace.plan, "$", 0)}</span> : null}
            </div>
            {pace.cap ? (
              <div className="mt-3">
                <PaceBar value={pace.spent} plan={pace.plan} cap={pace.cap} />
              </div>
            ) : (
              <p className="mt-2 text-xs text-fg-muted">ما في سقف يومي مكتوب — حطه من «الإعدادات ← المال والسقوف».</p>
            )}
            {!edit ? <p className="mt-2 text-xs text-fg-muted">الشهر: {fmt(PACE.monthSpent, "$", 0)} من {fmt(PACE.monthlyCap, "$", 0)}</p> : null}
          </Panel>
          {ds.accounts.map((a) => (
            <Panel key={a.id}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-fg">{a.name}</p>
                <LevelStars level={a.level} showLabel={false} />
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span dir="ltr" className="text-lg font-semibold tabular-nums text-fg">{fmt(a.spentToday, "$")}</span>
                <span className="text-xs text-fg-muted">{a.dailyCap ? `السقف ${fmt(a.dailyCap, "$", 0)}` : "بلا سقف"}</span>
              </div>
              {a.dailyCap ? (
                <div className="mt-3">
                  <PaceBar value={a.spentToday} plan={a.plannedToday} cap={a.dailyCap} />
                </div>
              ) : null}
              <p className={cn("mt-2 inline-flex items-center gap-1 text-xs", a.paymentOk ? "text-ok" : "text-danger")}>
                <CreditCard className="size-3.5" />
                {a.paymentOk ? "الدفع سليم" : "مشكلة دفع"}
              </p>
            </Panel>
          ))}
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="الأفضل بالحقيقة" hint={`آخر 3 أيام · ${untested} إعلان لسا ما انختبر`} link={{ href: "/ads", label: "كل الإعلانات" }}>
          <Panel className="divide-y divide-border p-0">
            {best.map(({ ad, product, view: v }) => (
              <Link key={ad.id} href={`/ads/campaigns?open=${ad.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface-2">
                <span dir="ltr" className="font-mono text-xs text-fg">{ad.name.split("_")[0]}</span>
                <span className="text-xs text-fg-muted">{product?.name}</span>
                <span className="ms-auto inline-flex items-center gap-3">
                  <Num value={v.costPerConfirmed} unit="$" term="costPerConfirmed" />
                  <span className="text-xs text-fg-muted">السقف {fmt(v.ceiling, "$")}</span>
                </span>
              </Link>
            ))}
            {!best.length ? <p className="px-4 py-3 text-sm text-fg-muted">لسا ما في إعلان عنده بيانات كافية.</p> : null}
          </Panel>
        </Section>

        <Section title="صار لحاله وصحة المصادر" hint="قرارات الأمان آخر 24 ساعة، وحالة كل ربط" tour="auto">
          <Panel className="space-y-3">
            {auto.slice(0, 3).map((c) => <ChangeCard key={c.id} change={c} />)}
            {!auto.length ? <p className="text-sm text-fg-muted">ما صار شي لحاله.</p> : null}
            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              {links.map((s) => (
                <span key={s.key} title={s.detail} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-fg">
                  <CircleDot className={cn("size-3", s.state === "ok" ? "text-ok" : s.state === "late" ? "text-warn" : "text-fg-muted")} />
                  {s.label}
                </span>
              ))}
            </div>
          </Panel>
        </Section>
      </div>
    </div>
  );
}
