"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { waitingText } from "@/core/handoff";
import type { WfGraph } from "@/core/workflow";
import { safeFetch } from "@/lib/call";

async function call(url: string, method: string, body?: unknown): Promise<{ error: string | null; demo: boolean; note?: string }> {
  const r = await safeFetch(url, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const d = (await r.json().catch(() => ({}))) as { error?: string; demo?: boolean; created?: boolean; since?: string };
  // asking again while a request is open: say for how long it has been waiting, not that it was «asked»
  const note = d.created === false && d.since ? `مطلوبة ${waitingText(Math.max(0, Math.round((Date.now() - Date.parse(d.since)) / 60_000)))} — لسا ما حدا استلمها` : undefined;
  return { error: r.ok ? null : (d.error ?? "صار خطأ"), demo: !!d.demo, ...(note ? { note } : {}) };
}

/** The job's own switch (the kill switch of that job — nothing is deleted) and «شغّلها هلأ» (hands it to Claude through the queue). */
export function JobControls({ jobKey, enabled, canSwitch, canRun }: { jobKey: string; enabled: boolean; canSwitch: boolean; canRun: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function run<T>(f: () => Promise<{ error: string | null; demo: boolean; note?: string }>, done: string) {
    setBusy(true);
    try {
      const r = await f();
      if (r.error) return toast(r.error, "error");
      toast(r.demo ? "بالوضع التجريبي ما تغيّر شي" : (r.note ?? done), r.demo ? "info" : r.note ? "info" : "success");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {canSwitch ? (
        <label className="inline-flex items-center gap-2 text-sm font-semibold text-fg">
          <Switch checked={enabled} disabled={busy} label={enabled ? "المهمة شغّالة — اضغط لتطفيها" : "المهمة مطفية — اضغط لتشغّلها"} onCheckedChange={(v) => void run(() => call(`/api/workflow/${jobKey}`, "PATCH", { enabled: v }), v ? "اشتغلت المهمة" : "انطفت المهمة")} />
          {enabled ? "شغّالة" : "مطفية"}
        </label>
      ) : null}
      {canRun ? (
        <Button variant="secondary" loading={busy} onClick={() => void run(() => call(`/api/workflow/${jobKey}/run`, "POST"), "انطلب من Claude — بيشغّلها بأقرب فرصة")}>
          <Play className="size-4" aria-hidden />
          شغّلها هلأ
        </Button>
      ) : null}
    </div>
  );
}

/** The switch of one branch: the server flips that one step of the drawing as it is NOW (not the drawing this page loaded), so two quick switches do not undo each other. */
export function BranchSwitch({ jobKey, nodeId, disabled }: { jobKey: string; graph?: WfGraph; nodeId: string; disabled: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Switch
      checked={!disabled}
      disabled={busy}
      label={disabled ? "الفرع مطفي — اضغط لتشغّله" : "الفرع شغّال — اضغط لتطفيه"}
      onCheckedChange={async (on) => {
        setBusy(true);
        try {
          const r = await call(`/api/jobs/${jobKey}/steps/${encodeURIComponent(nodeId)}`, "POST", { enabled: on });
          if (r.error) return toast(r.error, "error");
          toast(r.demo ? "بالوضع التجريبي ما تغيّر شي" : on ? "اشتغل الفرع" : "انطفى الفرع", r.demo ? "info" : "success");
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}
