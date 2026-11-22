import { DayLineFull } from "@/components/home/day-line-full";
import { DayControls } from "@/components/done/day-controls";
import { DayView } from "@/components/done/day-view";
import { SectionTitle } from "@/components/ui/section-title";
import { isKey } from "@/core/dates";
import { loadDay } from "@/lib/day-view";
import { loadDayLine } from "@/lib/day-line-view";
import { loadJobs } from "@/lib/jobs-view";
import { workdayBounds } from "@/core/timeline";
import { requirePage } from "@/server/auth";

export const metadata = { title: "اليوم" };
export const dynamic = "force-dynamic";

/**
 * الشغل ← اليوم: the whole working day on a line (06:00 → 06:00 — a night round after midnight stays on its own day), then what got done
 * and what is planned. The day is in the address (`?day=`): yesterday, today, tomorrow, or any date.
 */
export default async function WorkTodayPage({ searchParams }: { searchParams: { day?: string } }) {
  await requirePage("work.view");
  const now = new Date();
  const today = workdayBounds(now).key;
  const day = isKey(searchParams.day) ? searchParams.day : today;
  const [view, jobs, data] = await Promise.all([loadDayLine({ day, now }), loadJobs(now), loadDay(day)]);
  const rows = jobs.jobs.map((j) => ({ key: j.key, number: j.number, name: j.name }));
  return (
    <div className="space-y-6">
      <DayControls day={data.day} today={data.today} />
      <section className="space-y-3">
        <SectionTitle hint="من 6 الصبح لـ 6 الصبح. الليل مظلّل.">اليوم على الخط</SectionTitle>
        {view.demo ? <p className="rounded-card border border-dashed border-border p-4 text-sm text-fg-muted">الموقع على بيانات تجريبية — ما في خط حقيقي لسا.</p> : <DayLineFull line={view.line} rows={rows} now={now} />}
      </section>
      <section className="space-y-3">
        <SectionTitle>اللي انعمل</SectionTitle>
        <DayView data={data} hideControls />
      </section>
    </div>
  );
}
