import Link from "next/link";
import { notFound } from "next/navigation";
import { Groups } from "@/components/numbers/numbers-view";
import { DateSwitcher } from "@/components/shell/date-switcher";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { Stat } from "@/components/ui/stat";
import { costTone } from "@/core/numbers";
import { parseRange } from "@/core/dates";
import { loadNumbers } from "@/lib/numbers-view";
import { loadBoard } from "@/lib/videos-board";

export const dynamic = "force-dynamic";
export const metadata = { title: "منتج" };

/**
 * صفحة المنتج: one product from end to end — the ads (the cost of a real order against its break-even), the operation (all 31 numbers),
 * the stock and the video bank. Every number comes from the same loaders as «المنتجات» — nothing is computed here. «اللي بيأثّر عليه»
 * (the jobs that touch it, the standing orders on it) arrives with P5 and P7.
 */
export default async function ProductPage({ params, searchParams }: { params: { code: string }; searchParams: { d?: string; from?: string; to?: string } }) {
  const code = decodeURIComponent(params.code);
  const range = parseRange(searchParams, new Date());
  const [data, board] = await Promise.all([loadNumbers(searchParams), loadBoard()]);
  const p = data.products.find((x) => x.code === code);
  if (!p) notFound();
  const bp = board.products.find((x) => x.code === code);
  const s = p.current;
  const tone = costTone(s.costPerOrder, data.target, p.breakeven);
  const prevLabel = data.label;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/products" className="text-sm font-semibold text-info hover:underline">
          ← المنتجات
        </Link>
        <h2 className="text-xl font-extrabold text-fg">{p.name}</h2>
        <span dir="ltr" className="font-mono text-xs text-fg-muted">
          {p.code}
        </span>
      </div>
      <DateSwitcher range={range} />

      {p.hasData ? null : <EmptyState title="ما في أرقام لهالمنتج بهالفترة" hint="الأرقام بتيجي من ميتا والـ OMS، أو لما Claude يبعتها. جرّب فترة تانية." />}

      <section className="space-y-3">
        <SectionTitle href={`/ads/campaigns?product=${encodeURIComponent(p.code)}`} linkLabel="حملاته">
          الإعلانات
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="الصرف" value={s.spend} unit="$" term="spend" />
          <Stat label="طلبات حقيقية" value={s.ordersIn} term="realOrders" />
          <Stat
            label="تكلفة الطلب الحقيقي"
            value={s.costPerOrder}
            unit="$"
            term="costPerOrder"
            note={p.breakeven !== null ? `نقطة التعادل ${p.breakeven}$` : "ناقص نقطة التعادل — اكتبها بالمنتجات"}
            {...(tone === "ok" ? { tone: "ok" as const } : tone === "warn" ? { tone: "warn" as const } : tone === "danger" ? { tone: "danger" as const } : {})}
          />
          <Stat label="نسبة التأكيد" value={s.confirmRate} unit="%" term="confirmRateDay" />
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle>التشغيل</SectionTitle>
        <div className="rounded-card border border-border bg-surface-1 p-4">
          <Groups p={p} compare={false} target={data.target} prevLabel={prevLabel} />
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle href="/ads/videos" linkLabel="الفيديوهات">
          المخزون والفيديو
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="القطع الباقية" value={s.stockUnits} term="stockUnits" />
          <Stat label="أيام التغطية" value={s.stockCover} term="stockCover" />
          <Stat label="البنك من 50" value={bp ? bp.bank.count : null} term="bankCount" note={bp ? `ناقص ${bp.bank.short}` : "ما في بنك لهالمنتج"} />
          <Stat label="رابحين" value={bp ? bp.winners.length : null} term="bankCount" note={bp ? `تعبانين ${bp.tiredCount}` : undefined} />
        </div>
      </section>

      <div>
        <ButtonLink href="/products" variant="secondary">
          كل المنتجات
        </ButtonLink>
      </div>
    </div>
  );
}
