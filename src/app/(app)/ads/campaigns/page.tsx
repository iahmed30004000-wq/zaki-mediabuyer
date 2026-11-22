import { AdsScreen, type AdsSearch } from "@/components/ads/ads-screen";
import { requirePage } from "@/server/auth";

export const metadata = { title: "الحملات" };
export const dynamic = "force-dynamic";

/** الإعلانات ← الحملات: the table (campaign → ad set → ad). */
export default async function CampaignsPage({ searchParams }: { searchParams: AdsSearch }) {
  await requirePage("ads.view");
  return <AdsScreen tab="campaigns" searchParams={searchParams} />;
}
