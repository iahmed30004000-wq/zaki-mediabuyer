import type { RowStatus } from "@/core/ads-model";
import { cn } from "@/lib/utils";

const STATUS: Record<RowStatus, { label: string; cls: string }> = {
  active: { label: "شغّال", cls: "bg-ok/10 text-ok" },
  learning: { label: "بيتعلّم", cls: "bg-info/10 text-info" },
  paused: { label: "موقوف", cls: "bg-surface-2 text-fg-muted" },
  untested: { label: "لم يُختبر", cls: "border border-dashed border-border text-fg-muted" },
  rejected: { label: "مرفوض", cls: "bg-danger/10 text-danger" },
};

export const STATUS_LABEL: Record<RowStatus, string> = { active: STATUS.active.label, learning: STATUS.learning.label, paused: STATUS.paused.label, untested: STATUS.untested.label, rejected: STATUS.rejected.label };

export function StatusChip({ status }: { status: RowStatus }) {
  const s = STATUS[status];
  return <span className={cn("inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-sm font-semibold", s.cls)}>{s.label}</span>;
}
