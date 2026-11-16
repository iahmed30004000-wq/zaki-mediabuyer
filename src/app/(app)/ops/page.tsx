import { Suspense } from "react";
import { SectionSkeleton } from "@/components/home/home-sections";
import { FunnelSection, LeakSection, OpsJobs, OpsOrders, StockSummary, TeamSummary } from "@/components/ops/ops-sections";

export const metadata = { title: "التشغيل" };
export const dynamic = "force-dynamic";

/**
 * التشغيل ← اللوحة: «كيف ماشي التأكيد والشحن والمخزون؟» — the order's road, the leak, the confirmation team, the stock cover, the operations jobs
 * and the standing orders that touch them. Read only: no button changes an order or a shipment. A section whose numbers were never sent says so or
 * is not shown — nothing is made up.
 */
export default function OpsDashboardPage() {
  return (
    <div className="space-y-6">
      <Suspense fallback={<SectionSkeleton rows={1} />}>
        <FunnelSection />
      </Suspense>
      <Suspense fallback={null}>
        <LeakSection />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={2} />}>
        <TeamSummary />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={2} />}>
        <StockSummary />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={2} />}>
        <OpsJobs />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={1} />}>
        <OpsOrders />
      </Suspense>
    </div>
  );
}
