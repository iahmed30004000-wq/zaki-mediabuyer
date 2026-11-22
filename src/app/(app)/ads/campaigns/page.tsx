import { AdsScreen, type AdsSearch } from "@/components/ads/ads-screen";
import { requirePage } from "@/server/auth";

export const metadata = { title: "الحملات" };
export const dynamic = "force-dynamic";

/** الإعلانات ← الحملات: the table (campaign → ad set → ad). */
export default async function CampaignsPage({ searchParams: searchParamsP }: { searchParams: Promise<AdsSearch> }) {
  await requirePage("ads.view");
  const searchParams = await searchParamsP;
  return <AdsScreen tab="campaigns" searchParams={searchParams} />;
}
