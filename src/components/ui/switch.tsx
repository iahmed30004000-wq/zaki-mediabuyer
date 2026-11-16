"use client";

import { cn } from "@/lib/utils";

/** An on/off switch (a real `role="switch"` button). The touch target is 44px; the track is drawn smaller inside it. */
export function Switch({ checked, onCheckedChange, label, disabled, className }: { checked: boolean; onCheckedChange: (checked: boolean) => void; label: string; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn("inline-flex h-10 min-w-11 shrink-0 items-center justify-center rounded-lg disabled:pointer-events-none disabled:opacity-[.45] max-md:h-11", className)}
    >
      <span className={cn("relative block h-6 w-10 rounded-full border border-border transition-colors", checked ? "border-accent bg-accent" : "bg-surface-2")}>
        <span className={cn("absolute top-0.5 size-5 rounded-full bg-surface-1 shadow-card transition-all duration-150 motion-reduce:transition-none", checked ? "start-[18px]" : "start-0.5", !checked && "border border-border")} />
      </span>
    </button>
  );
}
