import { ProductScreen } from "@/components/numbers/product-screen";
import { requirePage } from "@/server/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "منتج" };

/** صفحة المنتج (the old address, kept until P8 moves it to «الأرقام ← المنتجات ← منتج»): the same screen. */
export default async function ProductPage({ params: paramsP, searchParams: searchParamsP }: { params: Promise<{ code: string }>; searchParams: Promise<{ p?: string; d?: string; from?: string; to?: string }> }) {
  await requirePage("ads.view");
  const { code } = await paramsP;
  const { d, ...rest } = await searchParamsP;
  const p = rest.p ?? (d === "yesterday" ? "1" : d === "custom" ? "custom" : undefined);
  return <ProductScreen code={decodeURIComponent(code)} search={{ ...rest, ...(p ? { p } : {}) }} />;
}
