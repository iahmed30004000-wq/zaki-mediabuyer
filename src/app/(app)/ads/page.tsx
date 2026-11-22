import { Suspense } from "react";
import { AdsQuickLinks } from "@/components/ads/ads-links";
import { AdsScreen, type AdsSearch } from "@/components/ads/ads-screen";
import { requirePage } from "@/server/auth";

export const metadata = { title: "الإعلانات" };
export const dynamic = "force-dynamic";

/**
 * الإعلانات (v6 · P6, docs/rebuild-v6/02-screens.md §5): the campaigns table, straight — campaign ← ad set ← ad, with «إطلاق». Above it two links: the ad sets that may be raised, and the data health. The old
 * dashboard was distributed: its tiles and the verdict of each product are in «الأرقام»; the last night round is in the results; the video bank is the first tab of the videos.
 */
export default async function AdsPage({ searchParams: searchParamsP }: { searchParams: Promise<AdsSearch> }) {
  await requirePage("ads.view");
  const searchParams = await searchParamsP;
  return (
    <div className="space-y-4">
      <Suspense fallback={null}>
        <AdsQuickLinks />
      </Suspense>
      <AdsScreen tab="campaigns" searchParams={searchParams} />
    </div>
  );
}
