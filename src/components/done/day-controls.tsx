"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Printer, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { addDays } from "@/core/dates";
import { cn } from "@/lib/utils";

/** The day switcher — امبارح · اليوم · بكرا · any date — and «شارك» (the PDF of the day, and the summary on Telegram). */
export function DayControls({ day, today }: { day: string; today: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const choices = [
    { key: addDays(today, -1), label: "امبارح" },
    { key: today, label: "اليوم" },
    { key: addDays(today, 1), label: "بكرا" },
  ];
  const custom = !choices.some((c) => c.key === day);

  async function telegram() {
    setBusy(true);
    try {
      const r = await fetch(`/api/done/share?day=${day}`, { method: "POST" });
      const d = (await r.json().catch(() => ({}))) as { error?: string; demo?: boolean };
      if (!r.ok) return toast(d.error ?? "صار خطأ", "error");
      toast(d.demo ? "بالوضع التجريبي ما انبعت شي" : "انبعت الملخص على تيليجرام ✓", d.demo ? "info" : "success");
      setShare(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-tour="day">
      <div role="group" aria-label="اليوم" className="inline-flex max-w-full overflow-x-auto rounded-lg border border-border bg-surface-1 p-1">
        {choices.map((c) => (
          <Link key={c.key} href={`/work/today?day=${c.key}`} aria-current={c.key === day ? "date" : undefined} className={cn("inline-flex min-h-10 max-md:min-h-[44px] shrink-0 items-center rounded-md px-3 text-sm font-medium", c.key === day ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg")}>
            {c.label}
          </Link>
        ))}
        <span className={cn("inline-flex min-h-10 max-md:min-h-[44px] shrink-0 items-center gap-1.5 rounded-md px-2", custom ? "bg-accent text-accent-fg" : "text-fg-muted")}>
          <CalendarDays className="size-3.5" />
          <Input type="date" dir="ltr" aria-label="تاريخ تاني" value={day} onChange={(e) => e.target.value && router.push(`/work/today?day=${e.target.value}`)} className="h-7 w-36 border-0 bg-transparent p-0 text-sm text-inherit" />
        </span>
      </div>
      <div className="relative ms-auto">
        <Button variant="secondary" size="sm" onClick={() => setShare((o) => !o)} aria-expanded={share} className="min-h-10 max-md:min-h-[44px]">
          <Send className="size-3.5" />
          شارك
        </Button>
        {share ? (
          <div className="absolute end-0 top-full z-30 mt-2 w-60 space-y-1.5 rounded-xl border border-border bg-surface-1 p-2 shadow-card">
            <a href={`/print/day?day=${day}`} target="_blank" rel="noreferrer" onClick={() => setShare(false)} className="flex min-h-10 max-md:min-h-[44px] items-center gap-2 rounded-lg px-3 text-sm text-fg hover:bg-surface-2">
              <Printer className="size-4" /> PDF — صفحة للطباعة والحفظ
            </a>
            <button type="button" disabled={busy} onClick={telegram} className="flex min-h-10 max-md:min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-start text-sm text-fg hover:bg-surface-2 disabled:opacity-50">
              <Send className="size-4" /> ملخص على تيليجرام
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
