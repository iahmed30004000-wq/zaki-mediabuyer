"use client";

import { useState } from "react";
import { ArrowLeft, Bot, Check, FlaskConical, Undo2, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useMission } from "@/components/mb/mission";
import { REASON_AR, type ChangeState } from "@/lib/mock/data";
import type { ChangeView } from "@/lib/changes-view";
import { cn } from "@/lib/utils";
import { fmt } from "./num";

const STATE_AR: Record<ChangeState, { label: string; cls: string }> = {
  pending_approval: { label: "بانتظارك", cls: "bg-warn/10 text-warn" },
  executed: { label: "تنفّذ", cls: "bg-ok/10 text-ok" },
  rolled_back: { label: "انرجع", cls: "bg-surface-2 text-fg-muted" },
  failed: { label: "فشل", cls: "bg-danger/10 text-danger" },
};

/**
 * One ChangeSet as the owner reads it (spec 18.3): who proposed it and why, before → after, the money it moves per
 * day, and the buttons that fit its state — «جرّب» (simulate), «وافق», «ارفض» for a pending one; «رجّع» for one
 * that ran. Demo mode keeps the result on the card; the real path is /api/changes.
 */
export function ChangeCard({ change }: { change: ChangeView }) {
  const [state, setState] = useState<ChangeState | "rejected">(change.state);
  const [simulated, setSimulated] = useState(false);
  const { toast } = useToast();
  const mission = useMission();
  const delta = change.spendDeltaDaily;
  const ByIcon = change.by === "إنت" || change.by === "أحمد" ? User : Bot;
  const [busy, setBusy] = useState(false);

  /** A real change goes through /api/changes/:id; a demo one only changes this card. */
  const act = async (action: "approve" | "reject" | "rollback"): Promise<ChangeState | "rejected" | null> => {
    if (!change.live) return action === "approve" ? "executed" : action === "reject" ? "rejected" : "rolled_back";
    setBusy(true);
    try {
      const r = await fetch(`/api/changes/${change.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const d = (await r.json()) as { state?: string; error?: string };
      if (!r.ok) {
        toast(d.error ?? "صار خطأ", "error");
        return null;
      }
      return action === "rollback" ? "rolled_back" : (d.state as ChangeState | "rejected");
    } finally {
      setBusy(false);
    }
  };
  const shown = state === "rejected" ? { label: "انرفض", cls: "bg-surface-2 text-fg-muted" } : STATE_AR[state];

  return (
    <article className="rounded-card border border-border bg-surface-1 p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={cn("rounded-md px-1.5 py-0.5 font-semibold", shown.cls)}>{shown.label}</span>
        <span className="inline-flex items-center gap-1 text-fg-muted">
          <ByIcon className="size-3.5" />
          {change.by}
        </span>
        <span className="text-fg-muted">· {REASON_AR[change.reasonCode]} ({change.reasonCode})</span>
        {change.writeMode === "dry_run" ? <span className="rounded-md border border-dashed border-border px-1.5 py-0.5 text-[10px] text-fg-muted" title="تجربة: انسجّل شو كان رح ينبعت لميتا وما انبعت شي">تجريبي</span> : null}
        <span className="ms-auto text-fg-muted">{change.at}</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-fg">{change.sentence}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span dir="ltr" className="rounded-md bg-surface-2 px-2 py-1 font-mono text-xs text-fg-muted">{change.target}</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-fg-muted line-through decoration-fg-muted/40">{change.before}</span>
          <ArrowLeft className="size-3.5 text-fg-muted" />
          <span className="font-semibold text-fg">{change.after}</span>
        </span>
        {delta !== 0 ? (
          <span className={cn("ms-auto rounded-md px-2 py-0.5 text-xs font-bold tabular-nums", delta > 0 ? "bg-warn/10 text-warn" : "bg-ok/10 text-ok")} dir="ltr">
            {delta > 0 ? "+" : "−"}
            {fmt(Math.abs(delta), "$", 0)} / يوم
          </span>
        ) : null}
      </div>

      {simulated && state === "pending_approval" ? (
        <div className="mt-3 rounded-lg border border-info/30 bg-info/5 p-3 text-xs leading-5 text-fg">
          <p className="font-semibold text-info">نتيجة التجربة (ما تغيّر شي بميتا)</p>
          {change.checks ? (
            <ul className="mt-1 space-y-0.5">
              {change.checks.map((c) => (
                <li key={c.key} className={c.ok ? "text-fg" : "text-warn"}>
                  {c.ok ? "✓" : "✗"} {c.note}
                </li>
              ))}
            </ul>
          ) : (
            <p>✓ ضمن السقف اليومي · ✓ ما في تعديل جوهري آخر 72 ساعة · ✓ ما في قاعدة متعارضة · صرف اليوم المتوقع بعدها: {fmt(189.6 + delta, "$")}</p>
          )}
        </div>
      ) : null}

      {state === "pending_approval" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={async () => {
              const next = await act("approve");
              if (!next) return;
              setState(next);
              if (next === "executed") mission({ title: "تمّت ✓", detail: delta > 0 ? `انوافق — الصرف زاد ${fmt(delta, "$", 0)} باليوم، وبنتابع الأثر بعد 24 و72 ساعة` : "انوافق وتنفّذ" });
              else toast("ما تنفّذ — شوف السبب بالسجل", "error");
            }}
            className="min-h-11 flex-1 sm:flex-none"
          >
            <Check className="size-4" />
            وافق
          </Button>
          <Button variant="secondary" onClick={() => setSimulated(true)} className="min-h-11">
            <FlaskConical className="size-4" />
            جرّب أول
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              if (!(await act("reject"))) return;
              setState("rejected");
              toast("انرفض. ما تغيّر شي.", "info");
            }}
            className="min-h-11"
          >
            <X className="size-4" />
            ارفض
          </Button>
        </div>
      ) : state === "executed" ? (
        <div className="mt-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={async () => {
              if (!(await act("rollback"))) return;
              setState("rolled_back");
              mission({ title: "رجعت ✓", detail: "رجعنا للحالة اللي قبل، وانسجّل بالتدقيق" });
            }}
          >
            <Undo2 className="size-4" />
            رجّع
          </Button>
        </div>
      ) : null}
    </article>
  );
}
