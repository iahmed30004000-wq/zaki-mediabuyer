import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { InboxCard } from "@/components/inbox/inbox-card";
import { AlertStrip } from "@/components/home/alert-strip";
import { DayLineMini } from "@/components/home/day-line";
import { SectionTitle } from "@/components/ui/section-title";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { Pill } from "@/components/ui/pill";
import { change } from "@/core/today";
import { fmt } from "@/lib/format";
import { loadDayLine } from "@/lib/day-line-view";
import { loadNumbers } from "@/lib/numbers-view";
import { loadDataset } from "@/lib/source";
import { loadToday } from "@/lib/today-view";
import { currentCaller } from "@/server/auth";
import { loadInbox } from "@/server/inbox";
import { loadReports } from "@/server/reports";

/** The loading shape of a section: a title line and a block, so a slow section never moves the others. */
export function SectionSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-5 w-32" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-20 w-full rounded-card" />
      ))}
    </div>
  );
}

/** «بانتظارك»: the first three decisions (the same card as the inbox) and the count. */
export async function InboxSection() {
  const caller = await currentCaller();
  const all = caller ? await loadInbox(caller) : [];
  return (
    <section className="space-y-3" data-tour="approvals">
      <SectionTitle {...(all.length > 3 ? { href: "/inbox", linkLabel: `الكل (${all.length})` } : {})}>بانتظارك</SectionTitle>
      {all.length ? (
        <div className="space-y-3">
          {all.slice(0, 3).map((i) => (
            <InboxCard key={i.id} item={i} compact />
          ))}
        </div>
      ) : (
        <p className="flex items-center gap-2 rounded-card border border-border bg-surface-1 p-4 text-sm text-fg-muted">
          <CheckCircle2 className="size-5 text-ok" aria-hidden /> ما في شي بانتظارك ✓
        </p>
      )}
    </section>
  );
}

const yesterdayNote = (v: number | null, unit: "$" | "%" | "") => (v === null ? "أمس: —" : `أمس: ${fmt(v, unit, unit === "$" ? 2 : 0)}`);

/** «أرقام اليوم»: four tiles, each against yesterday. A missing number is «—» with its reason on the «ليش؟». */
export async function StatsSection() {
  const [view, ds, numbers] = await Promise.all([loadToday(), loadDataset(), loadNumbers({ d: "today" })]);
  const cap = ds.accounts.reduce((s, a) => s + a.dailyCap, 0);
  const spent = view.today.spend;
  const costBad = view.today.costPerOrder !== null && view.avg7.costPerOrder !== null && view.today.costPerOrder > view.avg7.costPerOrder * 1.2;
  const rate = numbers.totals.current.confirmRate;
  const ratePrev = numbers.totals.prev.confirmRate;
  const spendUp = change(view.today.spend, view.yesterday.spend);
  return (
    <section className="space-y-3" data-tour="numbers">
      <SectionTitle href="/products" linkLabel="حسب المنتج">
        أرقام اليوم
      </SectionTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="الصرف" value={spent} unit="$" term="spend" note={cap ? `${yesterdayNote(view.yesterday.spend, "$")} · السقف ${fmt(cap, "$", 0)}` : yesterdayNote(view.yesterday.spend, "$")} {...(cap && spent !== null ? { bar: (spent / cap) * 100 } : {})} {...(cap && spent !== null && spent >= cap ? { tone: "danger" as const } : spendUp.dir === "up" && (spendUp.pct ?? 0) > 50 ? { tone: "warn" as const } : {})} />
        <Stat label="طلبات حقيقية" value={view.today.orders} term="realOrders" note={yesterdayNote(view.yesterday.orders, "")} />
        <Stat label="تكلفة الطلب الحقيقي" value={view.today.costPerOrder} unit="$" term="costPerOrder" note={yesterdayNote(view.yesterday.costPerOrder, "$")} {...(costBad ? { tone: "danger" as const } : {})} />
        <Stat label="نسبة التأكيد" value={rate} unit="%" term="confirmRateDay" note={yesterdayNote(ratePrev, "%")} />
      </div>
    </section>
  );
}

/** «لازم تنتبه»: three alerts at most, each one opens the place that fixes it. */
export async function AlertsSection() {
  const view = await loadToday();
  const more = view.alerts.length - 3;
  return (
    <section className="space-y-3">
      <SectionTitle hint={view.missingRules ? `ناقص ${view.missingRules} رقم بقواعد الحملات — بعض الفحوصات صامتة لحد ما تكتبهم` : undefined} {...(view.missingRules ? { href: "/settings#campaign-rules", linkLabel: "اكتبهم" } : {})}>
        لازم تنتبه
      </SectionTitle>
      <AlertStrip alerts={view.alerts.slice(0, 3)} />
      {more > 0 ? <p className="text-xs text-fg-muted">و{more} تنبيه كمان بصحة البيانات والإعلانات.</p> : null}
    </section>
  );
}

/** «اليوم على الخط»: the mini line of the working day, and what runs next. */
export async function DayLineSection() {
  const v = await loadDayLine();
  return (
    <section className="space-y-3">
      <SectionTitle href="/work/today" linkLabel="اليوم كامل">
        اليوم على الخط
      </SectionTitle>
      <div className="rounded-card border border-border bg-surface-1 p-4">
        {v.line.dots.length ? (
          <DayLineMini line={v.line} />
        ) : (
          <p className="text-sm text-fg-muted">
            {v.demo ? "الموقع على بيانات تجريبية — ما في خط حقيقي لسا." : v.scheduled ? "ما في تشغيلات لهاليوم لسا." : "ولا مهمة مجدولة."}{" "}
            <Link href="/work" className="font-semibold text-info hover:underline">
              الشغل
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}

const when = (iso: string) => new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

/** «آخر التقارير»: the last three — job · state · time — each opens its page. Hidden when there is none. */
export async function ReportsSection() {
  const rows = await loadReports({ limit: 3 });
  if (!rows.length) return null;
  return (
    <section className="space-y-3">
      <SectionTitle href="/work/reports" linkLabel="كل التقارير">
        آخر التقارير
      </SectionTitle>
      <ul className="divide-y divide-border rounded-card border border-border bg-surface-1">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={r.href} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-2">
              <span className="text-sm font-bold text-fg">{r.title}</span>
              {r.status ? <Pill tone={r.status === "failed" ? "danger" : r.status === "ok" ? "ok" : "info"}>{r.status === "failed" ? "فشل" : r.status === "ok" ? "خلص" : "شغّال"}</Pill> : null}
              <span className="ms-auto text-xs text-fg-muted">{when(r.at)}</span>
              {r.summary ? <span className="basis-full text-sm text-fg-muted">{r.summary}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
