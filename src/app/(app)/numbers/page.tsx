import { FunnelView, PeriodSwitcher, ProductsCompareTable, RangeLine, ReadinessBlock, SummaryChart, TileView, TodaySoFar } from "@/components/numbers/summary";
import { FxNotice } from "@/components/numbers/fx-notice";
import { MarketSwitcher } from "@/components/numbers/market-switcher";
import { SectionTitle } from "@/components/ui/section-title";
import { isMarket, withMarket } from "@/core/markets";
import { missingCount } from "@/core/numbers-readiness";
import { periodQuery } from "@/core/compare";
import { addDays, ammanKey } from "@/core/dates";
import { compareForRole, seesAdsNumbers } from "@/core/numbers-scope";
import { canOpenPath } from "@/core/roles";
import { loadCompare } from "@/lib/compare-view";
import { chartRange, loadEvents } from "@/lib/events-view";
import { loadNumbers } from "@/lib/numbers-view";
import { currentCaller, requirePage } from "@/server/auth";

export const metadata = { title: "الأرقام" };
export const dynamic = "force-dynamic";

/**
 * الأرقام ← الخلاصة (v6 · P6, docs/rebuild-v6/04-numbers.md §7): the period switcher and the line that says when the numbers last moved → four «كنا ← صرنا» tiles (or what is missing for them, in a card) → the
 * big chart of the cost of a real order with what we did on its days → «كل منتج: كنا وصرنا» with its verdict → «رحلة الطلب». Every number is computed by the code and carries its source; the window always
 * ends yesterday, and «اليوم لهلق» is shown on its own, with no difference.
 */
export default async function NumbersPage({ searchParams: searchParamsP }: { searchParams: Promise<{ p?: string; from?: string; to?: string; market?: string }> }) {
  await requirePage(["ads.view", "ops.view"]);
  const me = await currentCaller();
  // the ads' side (spend, cost, products, «شو عملنا») is for a role with `ads.view`; a role that only has the operations' numbers is never handed it (src/core/numbers-scope.ts)
  const ads = !!me && seesAdsNumbers(me.role);
  const search = await searchParamsP;
  const now = new Date();
  const market = isMarket(search.market) ? search.market : null;
  const [loaded, events, today] = await Promise.all([
    loadCompare({ now, period: search, market }),
    ads ? loadEvents(chartRange(now)).catch(() => []) : Promise.resolve([]),
    ads ? loadNumbers({ d: "today", market }, now).catch(() => null) : Promise.resolve(null),
  ]);
  const c = me ? compareForRole(loaded, me.role) : compareForRole(loaded, "MEMBER");
  const canOpen = (href: string) => !!me && canOpenPath(me.role, href);
  const query = withMarket(periodQuery({ period: c.period, from: c.range.from, to: c.range.to }), market);
  return (
    <div className="space-y-6">
      {c.demo ? <p className="rounded-card border border-dashed border-warn/50 bg-warn/5 p-3 text-base text-warn">بيانات تجريبية — أرقام مثال بنفس الحسابات.</p> : null}
      <div className="space-y-2">
        <PeriodSwitcher period={c.period} from={c.range.from} to={c.range.to} yesterday={addDays(ammanKey(now), -1)} />
        <MarketSwitcher market={market} />
        <RangeLine line={c.freshness.line} range={c.range} prev={c.prev} />
      </div>
      <FxNotice codes={c.missingRates ?? []} unplaced={c.unplacedPushed ?? []} />

      <section className="space-y-3" data-tour="kpis" aria-label="وين كنا وكيف صرنا">
        {c.allMissing ? (
          <ReadinessBlock c={c} canOpen={canOpen} />
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {c.tiles.map((t) => (
              <TileView key={t.key} t={t} />
            ))}
          </div>
        )}
        {today ? <TodaySoFar spend={today.totals.current.spend} orders={today.totals.current.ordersIn} cost={today.totals.current.costPerOrder} facts={c.facts} /> : null}
      </section>

      {ads ? <SummaryChart c={c} events={events} now={now} /> : null}

      {ads ? (
        <section className="space-y-3" data-tour="products" aria-label="كل منتج: كنا وصرنا">
          <SectionTitle hint={`آخر ${c.range.days === 1 ? "يوم" : `${c.range.days} يوم`} مقابل اللي قبلهم`} href={`/numbers/products${query ? `?${query}` : ""}`} linkLabel="كل الأرقام">
            كل منتج: كنا وصرنا
          </SectionTitle>
          <ProductsCompareTable rows={c.products} query={query} />
        </section>
      ) : null}

      <FunnelView steps={c.funnel} />

      {!c.allMissing && missingCount(c.readiness) > 0 ? <ReadinessBlock c={c} canOpen={canOpen} /> : null}
    </div>
  );
}
