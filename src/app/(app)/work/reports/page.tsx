import { ReportsArchive } from "@/components/pages/reports-archive";

export const metadata = { title: "التقارير" };
export const dynamic = "force-dynamic";

/** الشغل ← التقارير: every run report and periodic report, newest first. */
export default function WorkReportsPage({ searchParams }: { searchParams: { r?: string } }) {
  return <ReportsArchive selectedId={searchParams.r} />;
}
