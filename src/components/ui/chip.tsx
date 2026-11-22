import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A small tag (a step number, a filter, a kind). `off` strikes it through — a step that was switched off. 12px: a badge, never a sentence. */
export function Chip({ children, off = false, className }: { children: ReactNode; off?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-fg-muted",
        off && "line-through opacity-60",
        className,
      )}
    >
      {children}
    </span>
  );
}
