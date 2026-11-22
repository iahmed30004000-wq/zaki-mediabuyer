import { StockPage } from "@/components/ops/ops-sections";
import { requirePage } from "@/server/auth";

export const metadata = { title: "المخزون" };
export const dynamic = "force-dynamic";

/** التشغيل ← المخزون: every product's pieces, daily sales and days it lasts, and the last alert that was sent. */
export default async function OpsStockPage() {
  await requirePage("ops.view");
  return <StockPage />;
}
