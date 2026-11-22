import { ProductsScreen } from "@/components/numbers/products-screen";
import { requirePage } from "@/server/auth";

export const metadata = { title: "المنتجات" };
export const dynamic = "force-dynamic";

/** الأرقام ← المنتجات: every number per product with «كنا ← صرنا» always shown. */
export default async function NumbersProductsPage({ searchParams: searchParamsP }: { searchParams: Promise<{ p?: string; from?: string; to?: string }> }) {
  await requirePage("ads.view");
  return <ProductsScreen search={await searchParamsP} />;
}
