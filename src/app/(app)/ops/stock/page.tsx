import { StockPage } from "@/components/ops/ops-sections";

export const metadata = { title: "المخزون" };
export const dynamic = "force-dynamic";

/** التشغيل ← المخزون: every product's pieces, daily sales and days it lasts, and the last alert that was sent. */
export default function OpsStockPage() {
  return <StockPage />;
}
