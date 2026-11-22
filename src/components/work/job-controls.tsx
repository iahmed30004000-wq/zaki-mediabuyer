"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import type { WfGraph } from "@/core/workflow";
import { safeFetch } from "@/lib/call";

async function call(url: string, method: string, body?: unknown): Promise<{ error: string | null; demo: boolean }> {
  const r = await safeFetch(url, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const d = (await r.json().catch(() => ({}))) as { error?: string; demo?: boolean };
  return { error: r.ok ? null : (d.error ?? "صار خطأ"), demo: !!d.demo };
}

/** The job's own switch (the kill switch of that job — nothing is deleted) and «شغّلها هلأ» (hands it to Claude through the queue). */
export function JobControls({ jobKey, enabled, canSwitch, canRun }: { jobKey: string; enabled: boolean; canSwitch: boolean; canRun: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function run<T>(f: () => Promise<{ error: string | null; demo: boolean }>, done: string) {
    setBusy(true);
    try {
      const r = await f();
      if (r.error) return toast(r.error, "error");
      toast(r.demo ? "بالوضع التجريبي ما تغيّر شي" : done, r.demo ? "info" : "success");
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

/** The switch of one branch: it saves a new version of the drawing (the same saving the drawing board uses). */
export function BranchSwitch({ jobKey, graph, nodeId, disabled }: { jobKey: string; graph: WfGraph; nodeId: string; disabled: boolean }) {
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
          const next: WfGraph = { ...graph, nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, disabled: !on } : n)) };
          const r = await call(`/api/workflow/${jobKey}`, "PATCH", { graph: next, note: on ? `شغّلت فرع ${nodeId}` : `طفّيت فرع ${nodeId}` });
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
