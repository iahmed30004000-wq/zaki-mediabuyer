import { Suspense } from "react";
import { AdsOrders, AdsTiles, BankCard, HealthCard, NightRoundCard, ProductsVerdictTable, ScaleCandidates } from "@/components/ads/ads-dashboard";
import { SectionSkeleton } from "@/components/home/home-sections";

export const metadata = { title: "الإعلانات" };
export const dynamic = "force-dynamic";

/**
 * الإعلانات ← اللوحة: «كيف ماشية الإعلانات بالحقيقة؟» — four tiles, the products with their verdict, the last night round, the standing
 * orders that touch ads, the video bank, the ad sets that may be raised, and the data health. Every section loads on its own. The numbers are
 * the same loaders as everywhere; the verdict only SHOWS what the night round decides on.
 */
export default function AdsDashboardPage() {
  return (
    <div className="space-y-6">
      <Suspense fallback={<SectionSkeleton rows={1} />}>
        <AdsTiles />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={3} />}>
        <ProductsVerdictTable />
      </Suspense>
      <div className="grid gap-6 lg:grid-cols-2">
        <Suspense fallback={<SectionSkeleton rows={1} />}>
          <NightRoundCard />
        </Suspense>
        <Suspense fallback={<SectionSkeleton rows={1} />}>
          <ScaleCandidates />
        </Suspense>
      </div>
      <Suspense fallback={<SectionSkeleton rows={1} />}>
        <AdsOrders />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={2} />}>
        <BankCard />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={1} />}>
        <HealthCard />
      </Suspense>
    </div>
  );
}
