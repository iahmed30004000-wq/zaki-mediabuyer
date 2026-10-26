import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleDot, CreditCard, Info, Sparkles } from "lucide-react";
import { ThemeDecor } from "@/components/theme/theme-decor";
import { ArtSlot } from "@/components/theme/art-slot";
import { EmptyState } from "@/components/ui/card";
import { ChangeCard } from "@/components/mb/change-card";
import { LevelStars } from "@/components/mb/level-stars";
import { Num } from "@/components/mb/num";
import { fmt } from "@/lib/format";
import { PaceBar, Panel, Section } from "@/components/mb/section";
import { ACCOUNTS, ALERTS, CHANGES, PACE, SETUP_STEPS, SOURCES, allAds } from "@/lib/mock/data";
import { cn } from "@/lib/utils";

export const metadata = { title: "اليوم" };

function greeting(now = new Date()) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Amman", hour: "2-digit", hour12: false }).format(now));
  return h < 12 ? "صباح الخير" : h < 18 ? "مسا الخير" : "مسا النور";
}

export default function TodayPage() {
  const pending = CHANGES.filter((c) => c.state === "pending_approval");
  const auto = CHANGES.filter((c) => c.state === "executed" && c.auto);
  const done = SETUP_STEPS.filter((s) => s.done).length;
  const ranked = allAds().filter((x) => x.view.enoughData && x.view.costPerConfirmed !== null);
  const best = [...ranked].sort((a, b) => a.view.costPerConfirmed! - b.view.costPerConfirmed!).slice(0, 3);
  const untested = allAds().filter((x) => x.ad.status === "untested").length;
  const pendingDelta = pending.reduce((s, c) => s + c.spendDeltaDaily, 0);
  const date = new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", weekday: "long", day: "numeric", month: "long" }).format(new Date());

  return (
    <div className="space-y-6">
      {/* The strip: the only decorated part of the page, with the greeting on a scrim. */}
      <div className="relative isolate overflow-hidden rounded-card border border-border bg-surface-1">
        <ThemeDecor kind="strip" />
        <ArtSlot slot="today-strip" className="zk-strip-art absolute inset-0 h-full w-full object-cover" />
        <div className="relative z-10 flex flex-wrap items-center gap-4 p-4 sm:p-5">
          <div className="zk-scrim rounded-xl px-3 py-2">
            <p className="font-display text-xl font-bold text-fg sm:text-2xl">{greeting()} يا أحمد</p>
            <p className="text-xs text-fg-muted">{date} · {pending.length ? `${pending.length} قرار بانتظارك` : "ما في شي بانتظارك"}</p>
          </div>
          {done < SETUP_STEPS.length ? (
            <Link href="/setup" className="zk-scrim ms-auto inline-flex min-h-11 items-center gap-2 rounded-xl border border-accent/40 px-3 text-sm font-medium text-accent hover:bg-accent/10">
              <Sparkles className="size-4" />
              جهّز النظام · {done} من {SETUP_STEPS.length}
              <ArrowLeft className="size-4" />
            </Link>
          ) : null}
        </div>
      </div>

      {/* 1 — pace */}
      <Section title="الوتيرة اليوم" hint="الصرف لهلأ مقابل الخطة (الخط الرمادي) والسقف (الخط الأحمر)" tour="pace">
        <div className="grid gap-3 md:grid-cols-3">
          <Panel className="md:col-span-1">
            <p className="text-xs text-fg-muted">كل الحسابات</p>
            <div className="mt-1 flex items-baseline gap-2">
              <Num value={PACE.spentToday} unit="$" term="spend" big />
              <span className="text-xs text-fg-muted">من خطة {fmt(PACE.plannedToday, "$", 0)}</span>
            </div>
            <div className="mt-3">
              <PaceBar value={PACE.spentToday} plan={PACE.plannedToday} cap={PACE.dailyCap} />
            </div>
            <p className="mt-2 text-xs text-fg-muted">الشهر: {fmt(PACE.monthSpent, "$", 0)} من {fmt(PACE.monthlyCap, "$", 0)}</p>
          </Panel>
          {ACCOUNTS.map((a) => (
            <Panel key={a.id}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-fg">{a.name}</p>
                <LevelStars level={a.level} showLabel={false} />
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span dir="ltr" className="text-lg font-semibold tabular-nums text-fg">{fmt(a.spentToday, "$")}</span>
                <span className="text-xs text-fg-muted">السقف {fmt(a.dailyCap, "$", 0)}</span>
              </div>
              <div className="mt-3">
                <PaceBar value={a.spentToday} plan={a.plannedToday} cap={a.dailyCap} />
              </div>
              <p className={cn("mt-2 inline-flex items-center gap-1 text-xs", a.paymentOk ? "text-ok" : "text-danger")}>
                <CreditCard className="size-3.5" />
                {a.paymentOk ? "الدفع سليم" : "مشكلة دفع"}
              </p>
            </Panel>
          ))}
        </div>
      </Section>

      {/* 2 — what waits for the owner */}
      <Section title="بانتظار موافقتك" hint={pending.length ? `لو وافقت على الكل: ${pendingDelta > 0 ? "+" : ""}${fmt(pendingDelta, "$", 0)} باليوم` : undefined} tour="approvals" link={{ href: "/decisions", label: "كل القرارات" }}>
        {pending.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {pending.map((c) => (
              <ChangeCard key={c.id} change={c} />
            ))}
          </div>
        ) : (
          <Panel className="flex items-center gap-2 text-sm text-fg-muted">
            <CheckCircle2 className="size-4 text-ok" /> ما في شي بانتظارك. النظام بيكمّل الحراسة.
          </Panel>
        )}
      </Section>

      {/* 3 — what the system did on its own */}
      <Section title="صار لحاله" hint="قرارات الأمان آخر 24 ساعة — كل وحدة بسببها وزر رجوع" tour="auto">
        <div className="grid gap-3 lg:grid-cols-2">
          {auto.map((c) => (
            <ChangeCard key={c.id} change={c} />
          ))}
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 4 — best by the truth */}
        <Section title="الأفضل بالحقيقة" hint={`آخر 3 أيام · ${untested} إعلان لسا ما انختبر`} link={{ href: "/ads", label: "كل الإعلانات" }}>
          <Panel className="divide-y divide-border p-0">
            {best.map(({ ad, product, view }) => (
              <Link key={ad.id} href={`/ads?open=${ad.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface-2">
                <span dir="ltr" className="font-mono text-xs text-fg">{ad.name.split("_")[0]}</span>
                <span className="text-xs text-fg-muted">{product?.name}</span>
                <span className="ms-auto inline-flex items-center gap-3">
                  <Num value={view.costPerConfirmed} unit="$" term="costPerConfirmed" />
                  <span className="text-xs text-fg-muted">السقف {fmt(view.ceiling, "$")}</span>
                </span>
              </Link>
            ))}
          </Panel>
        </Section>

        {/* 5 — alerts and sources */}
        <Section title="تنبيهات وصحة المصادر">
          {ALERTS.length === 0 ? <EmptyState title="ما في تنبيهات" hint="كل شي هادي. أي شي بيصير بيوصلك هون وعلى تيليجرام." art="empty-alerts" /> : null}
          <Panel className="space-y-3">
            <ul className="space-y-2">
              {ALERTS.map((a) => {
                const Icon = a.tone === "info" ? Info : AlertTriangle;
                return (
                  <li key={a.id}>
                    <Link href={a.href ?? "#"} className="flex items-start gap-2 rounded-lg p-1 text-sm hover:bg-surface-2">
                      <Icon className={cn("mt-0.5 size-4 shrink-0", a.tone === "danger" ? "text-danger" : a.tone === "warn" ? "text-warn" : "text-info")} />
                      <span className="text-fg">{a.text}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              {SOURCES.map((s) => (
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
