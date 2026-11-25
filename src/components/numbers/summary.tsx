import Link from "next/link";
import { Num } from "@/components/mb/num";
import { PeriodSwitcher } from "@/components/numbers/period-switcher";
import { TrendPanel, type TrendMetric } from "@/components/numbers/trend-panel";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Delta } from "@/components/ui/delta";
import { Pill } from "@/components/ui/pill";
import { ProductName } from "@/components/ui/product-name";
import { ReadinessCard } from "@/components/ui/readiness-card";
import { SectionTitle } from "@/components/ui/section-title";
import { WasNow } from "@/components/ui/was-now";
import { splitMarks, type ChartEvent } from "@/core/chart-events";
import { sourceAfter } from "@/core/freshness";
import { periodQuery, type FunnelStepCompare, type MetricKey, type ProductCompare, type WasNow as Tile } from "@/core/compare";
import { addDays, ammanKey, daysBetween } from "@/core/dates";
import { productHref } from "@/core/markets";
import { fmt } from "@/lib/format";
import type { CompareData } from "@/lib/compare-view";

export const UNIT = { usd: "$", count: "", pct: "%" } as const;
export const SOURCE = { real: "truth", meta: "meta", estimate: "estimate" } as const;

/** The tile of a number, drawn from the computed `WasNow`: the words and the colour came from the code, this only places them. */
export function TileView({ t }: { t: Tile }) {
  return (
    <WasNow
      label={t.label}
      now={t.now}
      was={t.was}
      unit={UNIT[t.unit]}
      term={t.term}
      source={SOURCE[t.source]}
      delta={t.words ? { words: t.words, tone: t.tone } : null}
      series={t.series}
      missing={t.missing}
      provisional={t.provisional}
      digits={t.digits}
    />
  );
}

/** «اليوم لهلق»: today as it stands, on its own and with no difference — the day is not finished, so it takes no part in the comparison. */
export function TodaySoFar({ spend, orders, cost, facts }: { spend: number | null; orders: number | null; cost: number | null; facts: CompareData["facts"] }) {
  if (spend === null && orders === null) return null;
  const real = SOURCE[sourceAfter("real", facts)];
  return (
    <p className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-card border border-border bg-surface-1 px-4 py-3 text-base text-fg-muted" aria-label="اليوم لهلق">
      <b className="text-fg">اليوم لهلق</b>
      <span className="inline-flex items-center gap-1.5">
        طلبات <Num value={orders} unit="" term="realOrders" source={real} />
      </span>
      <span className="inline-flex items-center gap-1.5">
        صرف <Num value={spend} unit="$" term="spend" source="meta" />
      </span>
      {cost !== null ? (
        <span className="inline-flex items-center gap-1.5">
          تكلفة الطلب <Num value={cost} unit="$" term="costPerOrder" source={real} />
        </span>
      ) : null}
      <span className="text-sm">لسا ما خلص، فما بيدخل بالمقارنة</span>
    </p>
  );
}

const METRICS: { key: MetricKey; short: string; title: string; unit: "$" | "%" | "" }[] = [
  { key: "realCost", short: "التكلفة", title: "تكلفة الطلب الحقيقي", unit: "$" },
  { key: "orders", short: "الطلبات", title: "طلبات حقيقية باليوم", unit: "" },
  { key: "confirmRate", short: "التأكيد", title: "نسبة التأكيد", unit: "%" },
  { key: "spend", short: "الصرف", title: "الصرف باليوم", unit: "$" },
];

/** The big chart with what we did on its days. The break-even and the target are the owner's lines: not drawn until he writes them. */
export function SummaryChart({ c, events, now }: { c: CompareData; events: readonly ChartEvent[]; now: Date }) {
  const today = ammanKey(now);
  const to = addDays(today, -1);
  const from = addDays(to, -29);
  const { marks, rest } = splitMarks(events);
  const metrics: TrendMetric[] = METRICS.map((m) => {
    const tile = c.tiles.find((t) => t.key === m.key);
    return {
      key: m.key,
      short: m.short,
      title: m.title,
      unit: m.unit,
      values: c.series[m.key] ?? [],
      empty: tile?.missing ? `ما في خط: ${tile.missing}` : "ما في أيام كفاية بأرقام لرسم الخط — بيطلع لما يتجمّع يومين أو أكتر",
      ...(m.key === "realCost" ? { breakEven: c.breakeven, target: c.target } : {}),
    };
  });
  return <TrendPanel metrics={metrics} marks={marks.map((k) => ({ index: daysBetween(from, k.day), text: k.text, href: k.href }))} rest={rest.map((r) => ({ day: r.day, text: r.text, href: r.href }))} today={today} />;
}

const VERDICT_TONE = { neutral: "neutral", ok: "ok", warn: "warn", danger: "danger" } as const;

/** «كل منتج: كنا وصرنا»: the cost of a real order before and now with the difference in words, the orders of a day, and the verdict of the owner's own numbers. A missing cost says why. */
export function ProductsCompareTable({ rows, query }: { rows: readonly ProductCompare[]; query: string }) {
  const cols: Column<ProductCompare>[] = [
    { key: "name", header: "المنتج", cell: (r) => <Link href={productHref(r, query)} className="inline-flex min-h-11 items-center hover:underline"><ProductName name={r.name} code={r.code} /></Link> },
    { key: "was", header: "التكلفة: كنا", numeric: true, hideOnMobile: true, cell: (r) => (r.cost.was === null ? "—" : fmt(r.cost.was, "$")) },
    {
      key: "now",
      header: "التكلفة: صرنا",
      numeric: true,
      cell: (r) =>
        r.cost.now === null ? (
          <span className="text-sm text-fg-muted [direction:rtl]">{r.cost.missing ?? "ما في رقم"}</span>
        ) : (
          <span className="inline-flex flex-wrap items-center justify-end gap-2">
            <span className="font-display font-bold">{fmt(r.cost.now, "$")}</span>
            {r.cost.words ? <Delta words={r.cost.words} tone={r.cost.tone} /> : null}
          </span>
        ),
    },
    {
      key: "orders",
      header: "طلبات باليوم",
      numeric: true,
      cell: (r) =>
        r.orders.now === null ? (
          <span className="text-sm text-fg-muted [direction:rtl]">{r.orders.missing ?? "ما في رقم"}</span>
        ) : (
          <span className="inline-flex flex-wrap items-baseline justify-end gap-x-2">
            <span className="font-display font-bold">{fmt(r.orders.now, "", r.orders.digits ?? 0)}</span>
            {r.orders.was === null ? null : <span className="text-sm text-fg-muted [direction:rtl]">كنا {fmt(r.orders.was, "", r.orders.digits ?? 0)}</span>}
          </span>
        ),
    },
    { key: "verdict", header: "الحكم", cell: (r) => <Pill tone={VERDICT_TONE[r.verdict.tone]}>{r.verdict.label}</Pill> },
  ];
  return (
    <DataTable
      columns={cols}
      rows={rows}
      rowKey={(r) => r.key ?? r.code}
      label="كل منتج: كنا وصرنا"
      empty={<p className="rounded-card border border-dashed border-border p-4 text-base text-fg-muted">ما في منتج إله أرقام بهالفترة. لما توصل أرقام الطلبات والصرف بتطلع هون.</p>}
    />
  );
}

/** «رحلة الطلب»: of every 100 orders that came in, how many were confirmed, shipped and delivered — now, with «كنا» and the difference in points. */
export function FunnelView({ steps }: { steps: readonly FunnelStepCompare[] }) {
  const known = steps.some((s) => s.now !== null);
  return (
    <section className="space-y-3" data-tour="funnel" aria-label="رحلة الطلب">
      <SectionTitle hint="من كل 100 طلب دخلوا">رحلة الطلب</SectionTitle>
      {known ? (
        <ol className="m-0 grid list-none grid-cols-2 gap-3 p-0 lg:grid-cols-4">
          {steps.map((s) => (
            <li key={s.key} className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface-1 p-4">
              <span className="text-sm font-semibold text-fg-muted">{s.label}</span>
              <span dir="ltr" className="font-display text-3xl font-extrabold tabular-nums text-fg">
                {s.now === null ? "—" : fmt(s.now, "", Number.isInteger(s.now) ? 0 : 1)}
              </span>
              {s.key === "in" ? (
                <span className="text-sm text-fg-muted">الأساس</span>
              ) : s.now === null ? (
                <span className="text-sm text-fg-muted">ما في عدد لهالمرحلة بالفترة</span>
              ) : (
                <>
                  <span className="text-sm text-fg-muted">
                    كنا <span dir="ltr" className="font-display tabular-nums">{s.was === null ? "—" : fmt(s.was, "", Number.isInteger(s.was) ? 0 : 1)}</span>
                  </span>
                  {s.words ? <Delta words={s.words} tone={s.tone} /> : null}
                </>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-card border border-dashed border-border p-4 text-base text-fg-muted">ما في طلبات بالفترة لنحسب رحلتها. لما يوصل سحب نظام الطلبات بتطلع هون.</p>
      )}
    </section>
  );
}

/** What the numbers need, when something is missing; when all four tiles are missing it stands in place of them. */
export function ReadinessBlock({ c, canOpen }: { c: CompareData; canOpen: (href: string) => boolean }) {
  const rows = c.readiness.map((r) => ({ ...r, action: r.action && canOpen(r.action.href) ? r.action : null }));
  return <ReadinessCard rows={rows} />;
}

/**
 * The lines under the switcher: when the numbers last moved and where each side comes from; the window and the one before it (the dates are written left to right, whatever the page's direction, so
 * «2026-11-15» is never read backwards). The window always ends yesterday: the day that is not finished takes no part in a comparison.
 */
export function RangeLine({ line, range, prev }: { line: string; range: { from: string; to: string }; prev: { from: string; to: string } }) {
  const day = (d: string) => (
    <bdi dir="ltr" className="font-display tabular-nums">
      {d}
    </bdi>
  );
  return (
    <div className="space-y-0.5 text-sm text-fg-muted">
      <p>{line}</p>
      <p>
        الفترة من {day(range.from)} لـ {day(range.to)}، ومقابلها من {day(prev.from)} لـ {day(prev.to)} · بتخلص عند أمس
      </p>
    </div>
  );
}

export { PeriodSwitcher, periodQuery };
