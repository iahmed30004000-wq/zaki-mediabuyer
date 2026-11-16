"use client";

import { useState } from "react";
import { Bot, Check, ChevronDown, Clock, X, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ApprovalView } from "@/server/approvals";
import { useDecide } from "./use-decide";

export const URGENCY: Record<ApprovalView["urgency"], { icon: string; label: string; cls: string }> = {
  red: { icon: "🔴", label: "بيرنّ", cls: "bg-danger/10 text-danger" },
  orange: { icon: "🟠", label: "إشعار", cls: "bg-warn/10 text-warn" },
  yellow: { icon: "🟡", label: "صامت", cls: "bg-surface-2 text-fg-muted" },
};

export function minutesLeft(iso: string | null, now = Date.now()): number | null {
  return iso ? Math.round((new Date(iso).getTime() - now) / 60_000) : null;
}

export function timeText(mins: number | null): string | null {
  if (mins === null) return null;
  if (mins <= 0) return "انتهى";
  return mins < 60 ? `بعد ${mins} دقيقة` : mins < 1440 ? `بعد ${Math.round(mins / 60)} ساعة` : `بعد ${Math.round(mins / 1440)} يوم`;
}

/** «ليش؟»: the whole analysis behind a request — the decision, the analysis, what happens if yes and if no, the recommendation. */
export function Why({ a }: { a: ApprovalView }) {
  const rows: [string, string | undefined][] = [
    ["القرار", a.analysis?.decision],
    ["التحليل", a.analysis?.analysis],
    ["المآل إذا نعم", a.analysis?.if_yes],
    ["المآل إذا لأ", a.analysis?.if_no],
    ["التوصية", a.analysis?.recommendation],
  ];
  const shown = rows.filter(([, v]) => v);
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-border bg-surface-2/60 p-3 text-sm leading-6">
      <p className="text-fg">{a.why}</p>
      {shown.map(([k, v]) => (
        <div key={k}>
          <p className="text-xs font-semibold text-fg-muted">{k}</p>
          <p className="whitespace-pre-wrap text-fg">{v}</p>
        </div>
      ))}
      {!shown.length ? <p className="text-xs text-fg-muted">Claude ما بعت تحليل أكتر من السطر فوق.</p> : null}
    </div>
  );
}

/** The four answers: موافق · رفض · أجّل (15 دقيقة / ساعة / الصبح) · ألغِ الطلب — each one tap, the postpone two. */
export function AnswerButtons({ id, big = false, after }: { id: string; big?: boolean; after?: Parameters<typeof useDecide>[1] }) {
  const { busy, decide } = useDecide(id, after);
  const [later, setLater] = useState(false);
  const size = big ? "min-h-16 text-base" : "min-h-10 max-md:min-h-[44px]";
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Button disabled={busy} onClick={() => decide("approve")} className={cn(size, "col-span-2 sm:col-span-1")}>
          <Check className="size-4" />
          موافق
        </Button>
        <Button disabled={busy} variant="secondary" onClick={() => decide("reject")} className={size}>
          <X className="size-4" />
          رفض
        </Button>
        <Button disabled={busy} variant="secondary" onClick={() => setLater((v) => !v)} aria-expanded={later} className={size}>
          <Clock className="size-4" />
          أجّل
          <ChevronDown className={cn("size-3.5 transition-transform", later && "rotate-180")} />
        </Button>
        <Button disabled={busy} variant="ghost" onClick={() => decide("cancel")} className={size}>
          <Ban className="size-4" />
          ألغِ الطلب
        </Button>
      </div>
      {later ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="أجّل لـ">
          {([["15m", "15 دقيقة"], ["1h", "ساعة"], ["morning", "الصبح"]] as const).map(([until, label]) => (
            <Button key={until} disabled={busy} variant="secondary" size="sm" onClick={() => decide("postpone", { until })} className="min-h-10 max-md:min-h-[44px] flex-1">
              {label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** One request for the owner's decision, as a card (المهام · اليوم). */
export function ApprovalCard({ approval, compact = false }: { approval: ApprovalView; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const u = URGENCY[approval.urgency];
  const open_ = approval.status === "pending" || approval.status === "postponed";
  const left = timeText(minutesLeft(approval.expiresAt));
  return (
    <article className={cn("rounded-card border bg-surface-1 p-4 shadow-card", approval.urgency === "red" && open_ ? "border-danger/40" : "border-border")}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={cn("rounded-md px-1.5 py-0.5 font-semibold", u.cls)}>
          {u.icon} {u.label}
        </span>
        {approval.source === "mcp" ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-fg-muted" title="الطلب جاي من Claude عبر الربط">
            <Bot className="size-3" />
            Claude
          </span>
        ) : null}
        {approval.kind ? <span dir="ltr" className="font-mono text-fg-muted">{approval.kind}</span> : null}
        <span className="ms-auto text-fg-muted">{left ? `ينتهي ${left}` : ""}</span>
      </div>
      <h3 className="mt-2 text-base font-semibold leading-6 text-fg">{approval.title}</h3>
      <p className="text-sm leading-6 text-fg-muted">{approval.why}</p>

      {approval.amount !== null || approval.numbers.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {approval.amount !== null ? (
            <span dir="ltr" className="rounded-md bg-warn/10 px-2 py-1 text-sm font-bold tabular-nums text-warn">
              ${approval.amount}
            </span>
          ) : null}
          {approval.numbers.map((n) => (
            <span key={n.label} className="rounded-md bg-surface-2 px-2 py-1 text-fg">
              <span className="text-fg-muted">{n.label}: </span>
              <span dir="ltr" className="font-semibold tabular-nums">{n.value}</span>
            </span>
          ))}
        </div>
      ) : null}

      {approval.status === "postponed" && approval.postponedUntil ? <p className="mt-2 text-xs text-warn">مأجّل — بيرجع {timeText(minutesLeft(approval.postponedUntil))}</p> : null}

      {open ? <Why a={approval} /> : null}
      <div className="mt-3 space-y-3">
        {open_ ? <AnswerButtons id={approval.id} big={!compact} /> : <p className="text-xs text-fg-muted">{approval.status}</p>}
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-xs font-medium text-accent hover:underline">
          {open ? "سكّر" : "ليش؟"}
        </button>
      </div>
    </article>
  );
}
