import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const PILL_TONES = ["ok", "warn", "info", "danger", "neutral"] as const;
export type PillTone = (typeof PILL_TONES)[number];

const TONE: Record<PillTone, string> = {
  ok: "bg-ok/10 text-ok",
  warn: "bg-warn/10 text-warn",
  info: "bg-info/10 text-info",
  danger: "bg-danger/10 text-danger",
  neutral: "bg-surface-2 text-fg-muted",
};

/** A status badge: 24px, a word (never a dot alone), five tones only. The tone is a STATE (done · running · needs you · stopped), never decoration. */
export function Pill({ tone = "neutral", children, className }: { tone?: PillTone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs font-bold", TONE[tone], className)}>{children}</span>;
}
