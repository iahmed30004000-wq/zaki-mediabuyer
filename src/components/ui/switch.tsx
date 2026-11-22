"use client";

import { cn } from "@/lib/utils";

/** An on/off switch (a real `role="switch"` button): green when it is on («مفعّلة»), grey when off. The touch target is 44px; the track is 44×26 inside it. */
export function Switch({ checked, onCheckedChange, label, disabled, className }: { checked: boolean; onCheckedChange: (checked: boolean) => void; label: string; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn("inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-lg disabled:pointer-events-none disabled:opacity-[.45]", className)}
    >
      <span className={cn("relative block h-[26px] w-11 rounded-full transition-colors", checked ? "bg-ok" : "bg-muted")}>
        <span className={cn("absolute top-[3px] size-5 rounded-full bg-surface-1 transition-all duration-150 motion-reduce:transition-none", checked ? "start-[21px]" : "start-[3px]")} />
      </span>
    </button>
  );
}
