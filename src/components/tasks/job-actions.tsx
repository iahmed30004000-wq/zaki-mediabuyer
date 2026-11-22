"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { waitingText } from "@/core/handoff";
import { callJson } from "@/lib/call";

interface Answer {
  ok?: boolean;
  demo?: boolean;
  created?: boolean;
  since?: string;
  /** a recipe: the site carried it out right now, and this is how it ended */
  site?: boolean;
  status?: "ok" | "failed";
  summary?: string;
}

/** The job's own switch (it turns the job off — nothing is deleted): «مفعّلة» ↔ «مطفية». The save carries nothing but the switch. */
export function JobSwitch({ jobKey, enabled, canSwitch, label }: { jobKey: string; enabled: boolean; canSwitch: boolean; label?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  if (!canSwitch) return null;
  return (
    <label className="inline-flex items-center gap-2 text-base font-semibold text-fg">
      <Switch
        checked={enabled}
        disabled={busy}
        label={label ?? (enabled ? "المهمة مفعّلة — اضغط لتطفيها" : "المهمة مطفية — اضغط لتفعّلها")}
        onCheckedChange={async (on) => {
          setBusy(true);
          try {
            const r = await callJson<Answer>(`/api/workflow/${encodeURIComponent(jobKey)}`, { method: "PATCH", body: { enabled: on } });
            if (!r.ok) return toast(r.error ?? "صار خطأ", "error");
            if (r.data?.demo) return toast("بالوضع التجريبي ما تغيّر شي", "info");
            toast(on ? "اشتغلت المهمة" : "انطفت المهمة", "success");
            router.refresh();
          } finally {
            setBusy(false);
          }
        }}
      />
      {enabled ? "مفعّلة" : "مطفية"}
    </label>
  );
}

/** «شغّلها هلق»: asks the job's agent to run it now. Pressed again while the first request waits, it says for how long it has waited instead of asking twice. */
export function RunNowButton({ jobKey, size = "lg", variant = "primary" }: { jobKey: string; size?: "sm" | "md" | "lg"; variant?: "primary" | "secondary" }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size={size}
      variant={variant}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await callJson<Answer>(`/api/workflow/${encodeURIComponent(jobKey)}/run`, { method: "POST" });
          if (!r.ok) return toast(r.error ?? "صار خطأ", "error");
          if (r.data?.demo) return toast("بالوضع التجريبي ما تغيّر شي", "info");
          if (r.data?.site) {
            toast(r.data.status === "failed" ? `اشتغلت من الموقع ووقفت: ${r.data.summary ?? ""}`.trim() : `اشتغلت من الموقع ✓ ${r.data.summary ?? ""}`.trim(), r.data.status === "failed" ? "error" : "success");
            router.refresh();
            return;
          }
          const since = r.data?.created === false && r.data.since ? Math.max(0, Math.round((Date.now() - Date.parse(r.data.since)) / 60_000)) : null;
          toast(since !== null ? `مطلوبة ${waitingText(since)} — لسا ما حدا استلمها` : "انطلبت — بتشتغل بأقرب فرصة", since !== null ? "info" : "success");
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      <Play className="size-4" aria-hidden />
      شغّلها هلق
    </Button>
  );
}

/** The switch of one step of a job: the site flips that one step as it is NOW, so two quick switches do not undo each other. */
export function StepSwitch({ jobKey, stepId, enabled }: { jobKey: string; stepId: string; enabled: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Switch
      checked={enabled}
      disabled={busy}
      label={enabled ? "الخطوة شغّالة — اضغط لتطفيها" : "الخطوة مطفية — اضغط لتشغّلها"}
      onCheckedChange={async (on) => {
        setBusy(true);
        try {
          const r = await callJson<Answer>(`/api/jobs/${encodeURIComponent(jobKey)}/steps/${encodeURIComponent(stepId)}`, { method: "POST", body: { enabled: on } });
          if (!r.ok) return toast(r.error ?? "صار خطأ", "error");
          if (r.data?.demo) return toast("بالوضع التجريبي ما تغيّر شي", "info");
          toast(on ? "اشتغلت الخطوة" : "انطفت الخطوة", "success");
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}
