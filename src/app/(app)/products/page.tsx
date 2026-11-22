import { NumbersView } from "@/components/numbers/numbers-view";
import { DateSwitcher } from "@/components/shell/date-switcher";
import { can } from "@/core/roles";
import { addDays, ammanKey, parseRange } from "@/core/dates";
import { isDemo } from "@/core/readiness";
import { loadNumbers } from "@/lib/numbers-view";
import { currentCaller, requirePage } from "@/server/auth";

export const metadata = { title: "المنتجات" };
export const dynamic = "force-dynamic";

/**
 * المنتجات: every number of the day, per product and in total, for the date range the switcher says (it was «اليوم ← الأرقام»).
 * P4 rebuilds it from the kit and adds a page per product.
 */
export default async function ProductsPage({ searchParams }: { searchParams: { d?: string; from?: string; to?: string } }) {
  await requirePage("ads.view");
  const range = parseRange(searchParams, new Date());
  const [data, me] = await Promise.all([loadNumbers(searchParams), currentCaller()]);
  // «ألصق أرقام» is the owner's, on real data: it starts from yesterday (the closed day)
  const pasteDay = me && !me.demo && !isDemo(process.env) && can(me.role, "owner_only") ? addDays(ammanKey(new Date()), -1) : undefined;
  const query = range.key === "custom" ? `d=custom&from=${range.from}&to=${range.to}` : `d=${range.key}`;
  return (
    <div className="space-y-4">
      <DateSwitcher range={range} />
      <NumbersView data={data} query={query} pasteDay={pasteDay} />
    </div>
  );
}
