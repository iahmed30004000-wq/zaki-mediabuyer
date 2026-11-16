import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A small tag (a branch number, a filter). `off` strikes it through — a branch that was switched off. */
export function Chip({ children, off = false, className }: { children: ReactNode; off?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs font-semibold text-fg-muted",
        off && "line-through opacity-60",
        className,
      )}
    >
      {children}
    </span>
  );
}
