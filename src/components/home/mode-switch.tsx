"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export interface ModeLite {
  mode: "awake" | "asleep";
  since: string | null;
  schedule: { enabled: boolean; awake: string; asleep: string };
}

const since = (iso: string | null) => (iso ? new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : null);

/**
 * The one big switch of اليوم: صاحي / نايم. Awake: jobs run and urgent decisions ring. Asleep: nothing rings, what needs
 * him waits for the morning card, and only the jobs he whitelisted run. Tapping while a schedule is on switches the
 * schedule off (the switch is the owner's last word), and says so.
 */
export function ModeSwitch({ initial, demo }: { initial: ModeLite; demo: boolean }) {
  const [m, setM] = useState(initial);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  async function set(mode: ModeLite["mode"]) {
    if (busy || (mode === m.mode && !m.schedule.enabled)) return;
    setBusy(true);
    try {
      const r = await fetch("/api/mode", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, ...(m.schedule.enabled ? { schedule: { enabled: false } } : {}) }) });
      const d = (await r.json().catch(() => ({}))) as Partial<ModeLite> & { error?: string; demo?: boolean };
      if (!r.ok) return toast(d.error ?? "صار خطأ", "error");
      if (d.demo) {
        setM({ ...m, mode, schedule: { ...m.schedule, enabled: false } });
        return toast("بالوضع التجريبي: الزر بيتغيّر عندك بس", "info");
      }
      setM({ mode: d.mode ?? mode, since: d.since ?? null, schedule: d.schedule ?? m.schedule });
      toast(mode === "awake" ? "صاحي — الشغل بيمشي والقرارات المهمة بترنّ" : "نايم — ما في رنين، والمهم بيستنى للصبح", "success");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const opt = (key: ModeLite["mode"], label: string, Icon: typeof Sun) => (
    <button
      type="button"
      role="radio"
      aria-checked={m.mode === key}
      disabled={busy}
      onClick={() => set(key)}
      className={cn("flex min-h-14 flex-1 items-center justify-center gap-2 rounded-xl text-base font-semibold transition-colors", m.mode === key ? (key === "awake" ? "bg-accent text-accent-fg shadow-card" : "bg-fg text-surface shadow-card") : "text-fg-muted hover:text-fg")}
    >
      <Icon className="size-5" />
      {label}
    </button>
  );

  return (
    <div className="space-y-1.5" data-tour="mode">
      <div role="radiogroup" aria-label="صاحي ولا نايم" className="flex gap-1 rounded-2xl border border-border bg-surface-1 p-1">
        {opt("awake", "صاحي", Sun)}
        {opt("asleep", "نايم", Moon)}
      </div>
      <p className="px-1 text-xs text-fg-muted">
        {m.mode === "awake" ? "الشغل ماشي، والقرارات المهمة بترنّ." : "ما في رنين — المهم بيستنى للصبح، وبس مهام «صلاحيات الليل» بتشتغل."}
        {since(m.since) ? ` · من ${since(m.since)}` : ""}
        {m.schedule.enabled ? ` · الجدول: صاحي ${m.schedule.awake} ← نايم ${m.schedule.asleep}` : ""}
        {demo ? " · (تجريبي)" : ""}
      </p>
    </div>
  );
}
