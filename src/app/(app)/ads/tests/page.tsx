import { AdsScreen, type AdsSearch } from "@/components/ads/ads-screen";
import { requirePage } from "@/server/auth";

export const metadata = { title: "الاختبارات" };
export const dynamic = "force-dynamic";

/** الإعلانات ← الاختبارات: each test with its hypothesis, status and result. */
export default async function TestsPage({ searchParams: searchParamsP }: { searchParams: Promise<AdsSearch> }) {
  await requirePage("ads.view");
  const searchParams = await searchParamsP;
  return <AdsScreen tab="tests" searchParams={searchParams} />;
}
