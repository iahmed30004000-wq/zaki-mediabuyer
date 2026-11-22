import { ProductScreen } from "@/components/numbers/product-screen";
import { requirePage } from "@/server/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "منتج" };

/** الأرقام ← المنتجات ← منتج: one product from end to end. */
export default async function NumbersProductPage({ params: paramsP, searchParams: searchParamsP }: { params: Promise<{ code: string }>; searchParams: Promise<{ p?: string; from?: string; to?: string }> }) {
  await requirePage("ads.view");
  const { code } = await paramsP;
  return <ProductScreen code={decodeURIComponent(code)} search={await searchParamsP} />;
}
