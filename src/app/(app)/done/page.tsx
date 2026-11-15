import { DayView } from "@/components/done/day-view";
import { ReportsArchive } from "@/components/pages/reports-archive";
import { TabNav } from "@/components/shell/tab-nav";
import { loadDay, readDay } from "@/lib/day-view";

export const metadata = { title: "الإنجاز" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "day", label: "اليوم" },
  { key: "reports", label: "التقارير" },
] as const;

/**
 * الإنجاز: what got done (any day) and what is planned for tomorrow, and the reports — one place, two tabs. The day is the
 * first: «شو خلّصنا، وشو جاي بكرا؟». Old addresses (`/reports`) land on the reports tab.
 */
export default async function DonePage({ searchParams }: { searchParams: { tab?: string; r?: string; day?: string } }) {
  const tab = searchParams.tab === "reports" ? "reports" : "day";
  const data = tab === "day" ? await loadDay(readDay(searchParams.day)) : null;
  return (
    <div className="space-y-6">
      <TabNav tabs={TABS} active={tab} base="/done" label="الإنجاز" />
      {data ? <DayView data={data} /> : <ReportsArchive selectedId={searchParams.r} />}
    </div>
  );
}
