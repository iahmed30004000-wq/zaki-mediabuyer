import { AdsScreen, type AdsSearch } from "@/components/ads/ads-screen";

export const metadata = { title: "الإعلانات" };
export const dynamic = "force-dynamic";

/** الإعلانات ← اللوحة. Until P8 builds the dashboard it shows the per-product view of the ads table. */
export default function AdsPage({ searchParams }: { searchParams: AdsSearch }) {
  return <AdsScreen tab="products" searchParams={searchParams} />;
}
