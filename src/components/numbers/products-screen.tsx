import { NumbersView } from "@/components/numbers/numbers-view";
import { PeriodSwitcher } from "@/components/numbers/period-switcher";
import { RangeLine } from "@/components/numbers/summary";
import { comparePeriod, periodQuery } from "@/core/compare";
import { addDays, ammanKey, previousRange } from "@/core/dates";
import { freshness } from "@/core/freshness";
import { isDemo } from "@/core/readiness";
import { can } from "@/core/roles";
import { loadNumbers } from "@/lib/numbers-view";
import { loadSourceFacts } from "@/lib/source-facts";
import { currentCaller } from "@/server/auth";

/**
 * «الأرقام ← المنتجات» (v6 · P6): every number of the window, per product and in total, each with the window before it and the difference in words — the same screen the old «المنتجات» address shows until P8
 * moves it. The window always ends yesterday (a day that is not finished takes no part in a comparison); the choice lives in the address.
 */
export async function ProductsScreen({ search }: { search: { p?: string; from?: string; to?: string } }) {
  const now = new Date();
  const w = comparePeriod(search, now);
  const [data, me] = await Promise.all([loadNumbers({ d: "custom", from: w.from, to: w.to }, now), currentCaller()]);
  const facts = await loadSourceFacts({ now, products: data.products });
  // «ألصق أرقام» is the owner's, on real data: it starts from yesterday (the closed day)
  const pasteDay = me && !me.demo && !isDemo(process.env) && can(me.role, "owner_only") ? addDays(ammanKey(now), -1) : undefined;
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <PeriodSwitcher period={w.period} from={w.from} to={w.to} yesterday={addDays(ammanKey(now), -1)} />
        <RangeLine line={freshness(facts).line} range={w} prev={previousRange(w)} />
      </div>
      <NumbersView data={data} facts={facts} query={`d=custom&from=${w.from}&to=${w.to}`} linkQuery={periodQuery(w)} {...(pasteDay ? { pasteDay } : {})} />
    </div>
  );
}
