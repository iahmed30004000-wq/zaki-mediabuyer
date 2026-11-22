"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import type { ApprovalView } from "@/server/approvals";
import { safeFetch } from "@/lib/call";

export type DecideAction = "approve" | "reject" | "postpone" | "cancel";

export const DONE_TEXT: Record<DecideAction, string> = {
  approve: "انوافق ✓ — Claude بيقراها بالتشغيل الجاي وبينفّذ جوّا القواعد",
  reject: "انرفض — Claude ما رح يعيد الطلب",
  postpone: "تأجّل — بيرجع يطلع بالوقت اللي حددته",
  cancel: "انلغى الطلب",
};

/** The owner's answer to one request: POST /api/approvals/:id, then the page re-reads itself. */
export function useDecide(id: string, after?: (a: ApprovalView, action: DecideAction) => void) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  const decide = async (action: DecideAction, extra: { until?: "15m" | "1h" | "morning"; note?: string } = {}) => {
    if (busy) return null;
    setBusy(true);
    try {
      const r = await safeFetch(`/api/approvals/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
      const d = (await r.json().catch(() => ({}))) as { error?: string; approval?: ApprovalView; demo?: boolean };
      if (!r.ok) {
        toast(d.error ?? "صار خطأ", "error");
        return null;
      }
      toast(d.demo ? "بالوضع التجريبي ما تغيّر شي" : DONE_TEXT[action], d.demo ? "info" : "success");
      if (d.approval) after?.(d.approval, action);
      router.refresh();
      return d.approval ?? null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, decide };
}
