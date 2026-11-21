import { Suspense } from "react";
import { ModeSwitch } from "@/components/home/mode-switch";
import { MorningCard } from "@/components/home/morning-card";
import { AlertsSection, DayLineSection, InboxSection, ReportsSection, SectionSkeleton, StatsSection } from "@/components/home/home-sections";
import { isDemo } from "@/core/readiness";
import { loadMorning } from "@/lib/today-view";
import { currentMode } from "@/server/mode";
import { requirePage } from "@/server/auth";

export const metadata = { title: "الرئيسية" };
export const dynamic = "force-dynamic";

/**
 * الرئيسية — the owner's board, in this order: last night's card (only when he comes back), what waits for him, the four numbers of
 * the day, what must not be missed, the day on one line, the last reports. Every section loads on its own behind its own skeleton, so a
 * slow one never holds the rest. The numbers per product are `/products`.
 */
export default async function HomePage() {
  await requirePage();
  const [mode, morning] = await Promise.all([currentMode(), loadMorning()]);
  return (
    <div className="space-y-6">
      <ModeSwitch initial={{ mode: mode.mode, since: mode.since, schedule: mode.schedule }} demo={isDemo(process.env)} />
      {morning ? <MorningCard m={morning} /> : null}
      <Suspense fallback={<SectionSkeleton rows={2} />}>
        <InboxSection />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={1} />}>
        <StatsSection />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={1} />}>
        <AlertsSection />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={1} />}>
        <DayLineSection />
      </Suspense>
      <Suspense fallback={null}>
        <ReportsSection />
      </Suspense>
    </div>
  );
}
