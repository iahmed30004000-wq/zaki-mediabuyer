import { DayView } from "@/components/done/day-view";
import { loadDay, readDay } from "@/lib/day-view";

export const metadata = { title: "اليوم" };
export const dynamic = "force-dynamic";

/** الشغل ← اليوم: what got done (any day) and what is planned for tomorrow. P6 rebuilds it as the day line. */
export default async function WorkTodayPage({ searchParams }: { searchParams: { day?: string } }) {
  const data = await loadDay(readDay(searchParams.day));
  return <DayView data={data} />;
}
