import Link from "next/link";
import { DayBoardView, DoneLines } from "@/components/tasks/day-board-view";
import { DaySwitch } from "@/components/tasks/day-switch";
import { LiveRefresh } from "@/components/tasks/live";
import { Chip } from "@/components/ui/chip";
import { SectionTitle } from "@/components/ui/section-title";
import { isKey } from "@/core/dates";
import { DOMAIN_AR, type JobDomain } from "@/core/jobs";
import { workdayBounds } from "@/core/timeline";
import { dayBoard } from "@/lib/tasks-view";
import { requirePage } from "@/server/auth";
import { cn } from "@/lib/utils";

export const metadata = { title: "جدول اليوم" };
export const dynamic = "force-dynamic";

/**
 * المهام ← جدول اليوم: the board of the working day (06:00 → 06:00, Amman). Every moment of every job has one word — خلصت · شغّالة · واقفة · فاتت · جاية — and the line of its result; the day, the
 * person and the area are in the address. Under the board, what was done in the same hours, the same line said once.
 */
export default async function TasksDayPage({ searchParams: searchParamsP }: { searchParams: Promise<{ day?: string; who?: string; domain?: string }> }) {
  await requirePage("work.view");
  const sp = await searchParamsP;
  const now = new Date();
  const day = isKey(sp.day) ? sp.day : workdayBounds(now).key;
  const who = /^[a-z][a-z0-9_-]{1,31}$/.test(sp.who ?? "") ? (sp.who as string) : null;
  const domain: JobDomain | null = sp.domain === "ads" || sp.domain === "ops" ? sp.domain : null;
  const view = await dayBoard(day, { now, who, domain });
  const keep = `${who ? `&who=${who}` : ""}${domain ? `&domain=${domain}` : ""}`;
  const href = (next: { who?: string | null; domain?: string | null }) => {
    const w = next.who === undefined ? who : next.who;
    const d = next.domain === undefined ? domain : next.domain;
    return `/tasks/day?day=${day}${w ? `&who=${w}` : ""}${d ? `&domain=${d}` : ""}`;
  };
  const chip = (on: boolean) => cn("h-10 max-md:h-11 px-3 text-sm", on && "border-accent bg-accent text-accent-fg");
  return (
    <div className="space-y-5">
      <LiveRefresh />
      <DaySwitch day={day} today={view.today} keep={keep} />
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="فلتر">
        {([null, "ads", "ops"] as const).map((d) => (
          <Link key={d ?? "all"} href={href({ domain: d })} aria-current={d === domain ? "true" : undefined}>
            <Chip className={chip(d === domain)}>{d ? DOMAIN_AR[d] : "كل المجالات"}</Chip>
          </Link>
        ))}
        {view.who.map((w) => (
          <Link key={w.key} href={href({ who: w.key === who ? null : w.key })} aria-current={w.key === who ? "true" : undefined}>
            <Chip className={chip(w.key === who)}>{w.label}</Chip>
          </Link>
        ))}
      </div>
      <p role="status" className="font-display text-lg font-bold text-fg">
        {view.headline || "ما في مواعيد"}
      </p>
      <DayBoardView entries={view.entries} label="جدول اليوم" />
      {view.demo ? null : (
        <section className="space-y-3">
          <SectionTitle hint="من 6 الصبح لـ 6 الصبح، والسطر المتكرر بينذكر مرة.">اللي انعمل</SectionTitle>
          <DoneLines lines={view.done} />
        </section>
      )}
    </div>
  );
}
