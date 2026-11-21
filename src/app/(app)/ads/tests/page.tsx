import { AdsScreen, type AdsSearch } from "@/components/ads/ads-screen";
import { requirePage } from "@/server/auth";

export const metadata = { title: "الاختبارات" };
export const dynamic = "force-dynamic";

/** الإعلانات ← الاختبارات: each test with its hypothesis, status and result. */
export default async function TestsPage({ searchParams }: { searchParams: AdsSearch }) {
  await requirePage("ads.view");
  return <AdsScreen tab="tests" searchParams={searchParams} />;
}
