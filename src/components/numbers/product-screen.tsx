import { notFound } from "next/navigation";
import { FxNotice } from "@/components/numbers/fx-notice";
import { MarketSwitcher } from "@/components/numbers/market-switcher";
import { Groups, Six, StatTile } from "@/components/numbers/numbers-view";
import { isMarket, marketLabel, withMarket } from "@/core/markets";
import { PeriodSwitcher } from "@/components/numbers/period-switcher";
import { RangeLine } from "@/components/numbers/summary";
import { TrendPanel } from "@/components/numbers/trend-panel";
import { OrdersSection } from "@/components/work/orders-section";
import { BackLink } from "@/components/ui/back-link";
import { EmptyState } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { ProductName } from "@/components/ui/product-name";
import { SectionTitle } from "@/components/ui/section-title";
import { Stat } from "@/components/ui/stat";
import { comparePeriod, periodQuery } from "@/core/compare";
import { addDays, ammanKey, previousRange } from "@/core/dates";
import { freshness } from "@/core/freshness";
import { STATS, costTone } from "@/core/numbers";
import { can } from "@/core/roles";
import { productVerdict } from "@/core/verdict";
import { loadNumbers, loadSeries } from "@/lib/numbers-view";
import { loadSourceFacts } from "@/lib/source-facts";
import { loadBoard } from "@/lib/videos-board";
import { currentCaller } from "@/server/auth";
import { listOrders } from "@/server/orders";

const VERDICT_TONE = { neutral: "neutral", ok: "ok", warn: "warn", danger: "danger" } as const;
const stat = (k: (typeof STATS)[number]["key"]) => STATS.find((s) => s.key === k)!;

/**
 * صفحة المنتج (v6 · P6): one product from end to end — the ads (the cost of a real order against its break-even, with its 30-day line), the operation (six numbers, the 31 behind «كل الأرقام»), the stock and the
 * video bank. Every number is a «كنا ← صرنا» tile from the same loaders as the products screen — nothing is computed here. The standing orders on the product are at the foot.
 */
export async function ProductScreen({ code, search }: { code: string; search: { p?: string; from?: string; to?: string; market?: string } }) {
  const now = new Date();
  const w = comparePeriod(search, now);
  const market = isMarket(search.market) ? search.market : null;
  const [data, board, me] = await Promise.all([loadNumbers({ d: "custom", from: w.from, to: w.to, market }, now), loadBoard().catch(() => null), currentCaller()]);
  // a product seen in two markets has a line per market: this page shows ONE of them and says which — never the two folded together
  const lines = data.products.filter((x) => x.code === code);
  const p = lines.find((x) => (x.key ?? x.code) === code) ?? lines[0];
  if (!p) notFound();
  const [read, orders, line] = await Promise.all([loadSourceFacts({ now, products: data.products }), listOrders({ product: code }).catch(() => []), loadSeries("realCost", 30, p.key ?? p.code, now, market).catch(() => [])]);
  const facts = data.missingRates.length ? { ...read, fxMissing: data.missingRates } : read;
  const bp = board?.products.find((x) => x.code === code);
  const q = withMarket(periodQuery(w), market);
  const verdict = productVerdict(p.current.costPerOrder, data.target, p.breakeven);
  const tone = costTone(p.current.costPerOrder, data.target, p.breakeven);
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackLink href={`/numbers/products${q ? `?${q}` : ""}`}>المنتجات</BackLink>
        <h2 className="flex flex-wrap items-center gap-x-3 gap-y-1 font-display text-xl font-extrabold text-fg">
          <ProductName name={p.name} code={p.code} />
          <Pill tone={VERDICT_TONE[verdict.tone]}>{verdict.label}</Pill>
        </h2>
      </div>
      <div className="space-y-2">
        <PeriodSwitcher period={w.period} from={w.from} to={w.to} yesterday={addDays(ammanKey(now), -1)} />
        <MarketSwitcher market={market} />
        <RangeLine line={freshness(facts).line} range={w} prev={previousRange(w)} />
      </div>
      <FxNotice codes={data.missingRates} unplaced={data.unplacedPushed} />
      {p.split && !market ? <p className="rounded-card border border-warn/45 bg-warn/[0.06] p-3 text-base text-fg">هالمنتج ظاهر بأكتر من سوق. الأرقام تحت لـ {marketLabel(p.market)} بس — اختار السوق من فوق لتشوف غيره.</p> : null}

      {p.hasData ? null : <EmptyState title="ما في أرقام لهالمنتج بهالفترة" hint="الأرقام بتيجي من ميتا ونظام الطلبات، أو لما Claude يبعتها. جرّب فترة تانية." />}

      <section className="space-y-3">
        <SectionTitle href={`/ads?product=${encodeURIComponent(p.code)}`} linkLabel="حملاته">
          الإعلانات
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {(["spend", "ordersIn", "costPerOrder", "confirmRate"] as const).map((k) => (
            <StatTile key={k} def={stat(k)} set={p.current} prev={p.prev} facts={facts} tone={k === "costPerOrder" ? tone : undefined} />
          ))}
        </div>
        <p className="text-base text-fg-muted">
          {p.breakeven !== null ? `نقطة التعادل ${p.breakeven}$${data.target !== null ? ` · هدفك ${data.target}$` : ""}` : "ناقص نقطة التعادل — اكتبها بالمنتجات، وبيطلع خطها على الرسم والحكم بيتلوّن."}
        </p>
        <TrendPanel
          metrics={[{ key: "realCost", short: "التكلفة", title: "تكلفة الطلب الحقيقي", unit: "$", values: line, empty: "ما في أيام كفاية بأرقام لرسم الخط — بيطلع لما يتجمّع يومين أو أكتر", breakEven: p.breakeven, target: data.target }]}
          marks={[]}
          rest={[]}
          today={ammanKey(now)}
        />
      </section>

      <section className="space-y-3">
        <SectionTitle>التشغيل</SectionTitle>
        <Six p={p} facts={facts} target={data.target} />
        <details className="rounded-card border border-border bg-surface-1 p-4">
          <summary className="min-h-11 cursor-pointer text-base font-semibold text-info">كل الأرقام</summary>
          <div className="pt-4">
            <Groups p={p} facts={facts} target={data.target} />
          </div>
        </details>
      </section>

      <section className="space-y-3">
        <SectionTitle href="/ads/videos" linkLabel="الفيديوهات">
          المخزون والفيديو
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile def={stat("stockUnits")} set={p.current} prev={p.prev} facts={facts} />
          <StatTile def={stat("stockCover")} set={p.current} prev={p.prev} facts={facts} />
          <Stat label="البنك من 50" value={bp ? bp.bank.count : null} term="bankCount" note={bp ? `ناقص ${bp.bank.short}` : "ما في بنك لهالمنتج"} />
          <Stat label="رابحين" value={bp ? bp.winners.length : null} term="bankCount" note={bp ? `تعبانين ${bp.tiredCount}` : undefined} />
        </div>
      </section>

      <OrdersSection title="أوامر سارية عليه" orders={orders} scope={{ domain: "all", products: [code] }} canCreate={!!me && !me.demo && can(me.role, "orders.restrict")} canEnd={!!me && !me.demo && can(me.role, "owner_only")} />
    </div>
  );
}
