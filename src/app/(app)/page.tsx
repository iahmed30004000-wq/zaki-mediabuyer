import { Suspense } from "react";
import { cookies } from "next/headers";
import { ModeSwitch } from "@/components/home/mode-switch";
import { MorningCard } from "@/components/home/morning-card";
import { NeedsSection, NumbersSection, ResultsSection, SectionSkeleton, UpcomingSection } from "@/components/home/home-sections";
import { RunningNow, WhoWorks } from "@/components/home/live-sections";
import { homePlan } from "@/core/home";
import { isDemo } from "@/core/readiness";
import { NAV_COOKIE, navMapFor } from "@/lib/nav";
import { loadMorning } from "@/lib/today-view";
import { currentMode } from "@/server/mode";
import { currentCaller, requirePage } from "@/server/auth";

export const metadata = { title: "الرئيسية" };
export const dynamic = "force-dynamic";

/**
 * الرئيسية (v6 · P5, docs/rebuild-v6/02-screens.md §2) — «شو صاير هلق، وشو بدّه مني؟». The sections in this order, an empty one not drawn (except the first and the fourth):
 *   0 صباح الخير   only the first time he opens it after «نايم»: what finished, what stopped, what was missed
 *   1 بدّها منك    the decisions, the runs that stopped or were missed, the alerts that ask something of him
 *   2 شغّالة هلق   a card for every run that is going (follows the live answer)
 *   3 مين شغّال    a lamp and a line for every agent
 *   4 وين كنا وكيف صرنا   four «كنا ← صرنا» tiles, or what is missing for them
 *   5 الجاي اليوم  the first four moments to come
 *   6 آخر النتائج  the last three results
 * Every section loads behind its own skeleton, so a slow one never holds the others. A role is given only the sections whose screens it may open (`homePlan`). The wide صاحي / نايم
 * switch is no longer here: it lives in the «⋯» of the header (the old map, which has no «⋯», keeps it here).
 */
export default async function HomePage() {
  await requirePage();
  // requirePage has already sent anybody who is not signed in to the door: the fallback is only for the type
  const role = (await currentCaller())?.role ?? "VIEWER";
  const plan = homePlan(role);
  const oldMap = navMapFor((await cookies()).get(NAV_COOKIE)?.value, role) === "old";
  const [mode, morning] = await Promise.all([oldMap ? currentMode() : Promise.resolve(null), loadMorning()]);
  return (
    <div className="space-y-6">
      {mode ? <ModeSwitch initial={{ mode: mode.mode, since: mode.since, schedule: mode.schedule }} demo={isDemo(process.env)} /> : null}
      {morning ? <MorningCard m={morning} /> : null}
      <Suspense fallback={<SectionSkeleton rows={2} />}>
        <NeedsSection plan={plan} />
      </Suspense>
      {plan.tasks ? (
        <>
          <RunningNow />
          <WhoWorks />
        </>
      ) : null}
      {plan.numbers ? (
        <Suspense fallback={<SectionSkeleton rows={1} />}>
          <NumbersSection plan={plan} />
        </Suspense>
      ) : null}
      {plan.tasks ? (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Suspense fallback={null}>
            <UpcomingSection />
          </Suspense>
          <Suspense fallback={null}>
            <ResultsSection />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}
