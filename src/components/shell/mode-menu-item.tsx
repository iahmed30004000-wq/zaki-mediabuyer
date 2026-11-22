"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { callJson } from "@/lib/call";

interface ModeAnswer {
  mode?: "awake" | "asleep";
  schedule?: { enabled?: boolean };
  demo?: boolean;
  error?: string;
}

/**
 * صاحي / نايم, in the «⋯» of the header (v6 · P5 — it used to be a wide switch on the home). One line that says which one he is now and flips to the other. Awake: jobs run and urgent
 * decisions ring. Asleep: nothing rings, what needs him waits for the morning card, and only the jobs he whitelisted run. The menu mounts its items when it opens, so the state is read
 * then (one small request); until it answers the line is not drawn. Flipping while a schedule is on switches the schedule off (the switch is his last word), and says so.
 */
export function ModeMenuItem() {
  const [mode, setMode] = useState<"awake" | "asleep" | null>(null);
  const [scheduled, setScheduled] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    void callJson<ModeAnswer>("/api/mode", { cache: "no-store" }).then((r) => {
      if (!alive || !r.ok || !r.data?.mode) return;
      setMode(r.data.mode);
      setScheduled(!!r.data.schedule?.enabled);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!mode) return null;
  const next = mode === "awake" ? "asleep" : "awake";

  async function flip() {
    const r = await callJson<ModeAnswer>("/api/mode", { method: "PUT", body: { mode: next, ...(scheduled ? { schedule: { enabled: false } } : {}) } });
    if (!r.ok) return toast(r.error ?? "صار خطأ", "error");
    if (r.data?.demo) return toast("بالوضع التجريبي: الزر ما بيغيّر شي", "info");
    toast(next === "awake" ? "صاحي — الشغل بيمشي والقرارات المهمة بترنّ" : "نايم — ما في رنين، والمهم بيستنى للصبح", "success");
    router.refresh();
  }

  return (
    <DropdownMenuItem onSelect={() => void flip()}>
      {mode === "awake" ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
      {mode === "awake" ? "صاحي — حوّل لنايم" : "نايم — حوّل لصاحي"}
    </DropdownMenuItem>
  );
}
