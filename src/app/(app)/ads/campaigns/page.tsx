import { AdsScreen, type AdsSearch } from "@/components/ads/ads-screen";

export const metadata = { title: "الحملات" };
export const dynamic = "force-dynamic";

/** الإعلانات ← الحملات: the table (campaign → ad set → ad). */
export default function CampaignsPage({ searchParams }: { searchParams: AdsSearch }) {
  return <AdsScreen tab="campaigns" searchParams={searchParams} />;
}
