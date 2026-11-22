import { ProductsScreen } from "@/components/numbers/products-screen";
import { productsWindow } from "@/core/legacy-links";
import { requirePage } from "@/server/auth";

export const metadata = { title: "المنتجات" };
export const dynamic = "force-dynamic";

/**
 * الأرقام ← المنتجات: every number per product with «كنا ← صرنا» always shown. An address from before v6 (`/products?d=yesterday`) arrives here by redirect with its query: the old
 * `d=today|yesterday|7d` choices are read as the nearest window that ends yesterday, and anything it does not know is the last seven days.
 */
export default async function NumbersProductsPage({ searchParams: searchParamsP }: { searchParams: Promise<{ p?: string; d?: string; from?: string; to?: string }> }) {
  await requirePage("ads.view");
  const { d, ...rest } = await searchParamsP;
  // the comparison windows are written `p=1` / `p=custom`; the old choice `d=yesterday` or `d=custom` is read as one of them
  const p = productsWindow(rest.p, d);
  return <ProductsScreen search={{ ...rest, ...(p ? { p } : {}) }} />;
}
