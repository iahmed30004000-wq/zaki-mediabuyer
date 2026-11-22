"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/input";
import { addDays } from "@/core/dates";
import { cn } from "@/lib/utils";

/**
 * The day switcher of «جدول اليوم»: امبارح · اليوم · بكرا · any date. The day is in the address (`?day=`), so the back button and a shared link land on the same day; `keep` carries the
 * filters (`who`, `domain`) over. The day is the WORKING day (06:00 to 06:00): at 3 in the morning «اليوم» is still the evening before.
 */
export function DaySwitch({ day, today, keep }: { day: string; today: string; keep: string }) {
  const router = useRouter();
  const href = (d: string) => `/tasks/day?day=${d}${keep}`;
  const choices = [
    { key: addDays(today, -1), label: "امبارح" },
    { key: today, label: "اليوم" },
    { key: addDays(today, 1), label: "بكرا" },
  ];
  const custom = !choices.some((c) => c.key === day);
  return (
    <div role="group" aria-label="اليوم" className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-border bg-surface-1 p-1">
      {choices.map((c) => (
        <Link key={c.key} href={href(c.key)} aria-current={c.key === day ? "date" : undefined} className={cn("inline-flex h-10 shrink-0 items-center rounded-xl px-4 text-sm font-bold max-md:h-11", c.key === day ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg")}>
          {c.label}
        </Link>
      ))}
      <span className={cn("inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-2 max-md:h-11", custom ? "bg-accent text-accent-fg" : "text-fg-muted")}>
        <CalendarDays className="size-4" aria-hidden />
        <Input type="date" dir="ltr" aria-label="تاريخ تاني" value={day} onChange={(e) => e.target.value && router.push(href(e.target.value))} className="h-8 w-36 border-0 bg-transparent p-0 text-sm text-inherit" />
      </span>
    </div>
  );
}
