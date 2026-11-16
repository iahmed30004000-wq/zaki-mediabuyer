import { AdsScreen, type AdsSearch } from "@/components/ads/ads-screen";

export const metadata = { title: "الاختبارات" };
export const dynamic = "force-dynamic";

/** الإعلانات ← الاختبارات: each test with its hypothesis, status and result. */
export default function TestsPage({ searchParams }: { searchParams: AdsSearch }) {
  return <AdsScreen tab="tests" searchParams={searchParams} />;
}
