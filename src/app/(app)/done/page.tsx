import { ReportsArchive } from "@/components/pages/reports-archive";
import { TabNav } from "@/components/shell/tab-nav";
import { EmptyState } from "@/components/ui/card";

export const metadata = { title: "الإنجاز" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "day", label: "اليوم" },
  { key: "reports", label: "التقارير" },
] as const;

/** الإنجاز: what got done (any day) and what is planned for tomorrow, and the reports — one place, two tabs. */
export default function DonePage({ searchParams }: { searchParams: { tab?: string; r?: string } }) {
  const tab = searchParams.tab === "day" ? "day" : "reports";
  return (
    <div className="space-y-6">
      <TabNav tabs={TABS} active={tab} base="/done" label="الإنجاز" />
      {tab === "reports" ? <ReportsArchive selectedId={searchParams.r} /> : <EmptyState title="لسا ما في إنجاز مسجّل" hint="كل شي بينعمل — تشغيل، قرار، مهمة، فيديو — بيطلع هون لحاله." art="empty-decisions" />}
    </div>
  );
}
