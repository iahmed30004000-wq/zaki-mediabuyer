import { StockPage } from "@/components/ops/ops-sections";
import { isMarket } from "@/core/markets";
import { requirePage } from "@/server/auth";

export const metadata = { title: "المخزون" };
export const dynamic = "force-dynamic";

/** الأرقام ← المخزون: every product's pieces, daily sales and days it lasts, and the last alert that was sent. */
export default async function NumbersStockPage({ searchParams: searchParamsP }: { searchParams: Promise<{ market?: string }> }) {
  await requirePage("ops.view");
  const asked = (await searchParamsP).market;
  return <StockPage market={isMarket(asked) ? asked : null} />;
}
