import { Suspense } from "react";
import { SectionSkeleton } from "@/components/home/home-sections";
import { ConfirmPage, FunnelSection, LeakSection, OpsJobs, OpsOrders, ShippingPage } from "@/components/ops/ops-sections";
import { MarketSwitcher } from "@/components/numbers/market-switcher";
import { isMarket } from "@/core/markets";
import { requirePage } from "@/server/auth";

export const metadata = { title: "التأكيد والشحن" };
export const dynamic = "force-dynamic";

/**
 * الأرقام ← التأكيد والشحن (v6 · P6): what the old «التشغيل» had on three screens, on one page with sections — the road of an order, the leak, the confirmation team and the reasons for rejection, the
 * shipping (what did not land, what is stuck and returned), the operations jobs and the standing orders that touch them. Read only: no button changes an order or a shipment. A section whose numbers
 * Claude never sent says so, in words, or is not drawn — nothing is made up.
 */
export default async function NumbersOpsPage({ searchParams: searchParamsP }: { searchParams: Promise<{ market?: string }> }) {
  await requirePage("ops.view");
  const asked = (await searchParamsP).market;
  const market = isMarket(asked) ? asked : null;
  return (
    <div className="space-y-8">
      <MarketSwitcher market={market} />
      <Suspense fallback={<SectionSkeleton rows={1} />}>
        <FunnelSection market={market} />
      </Suspense>
      <Suspense fallback={null}>
        <LeakSection />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={2} />}>
        <ConfirmPage />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={2} />}>
        <ShippingPage market={market} />
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
