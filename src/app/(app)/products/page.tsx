import { ProductsScreen } from "@/components/numbers/products-screen";
import { requirePage } from "@/server/auth";

export const metadata = { title: "المنتجات" };
export const dynamic = "force-dynamic";

/**
 * المنتجات (the old address, kept until P8 moves it to «الأرقام ← المنتجات»): the same screen. The old `?d=today|yesterday|7d` choices are read as the nearest window that ends yesterday:
 * anything it does not know is the last seven days.
 */
export default async function ProductsPage({ searchParams: searchParamsP }: { searchParams: Promise<{ p?: string; d?: string; from?: string; to?: string }> }) {
  await requirePage("ads.view");
  const { d, ...rest } = await searchParamsP;
  // an address from before P6 says `d=yesterday` or `d=custom`: the comparison windows are written `p=1` / `p=custom`
  const p = rest.p ?? (d === "yesterday" ? "1" : d === "custom" ? "custom" : undefined);
  return <ProductsScreen search={{ ...rest, ...(p ? { p } : {}) }} />;
}
