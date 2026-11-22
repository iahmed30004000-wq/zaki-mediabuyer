"use client";

import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A view switch (today / yesterday, list / board): a group of native radios, so the arrows move the choice. Four options at most.
 * It only reports the choice; keeping it in the address is the caller's job (03 §7 rule 8).
 */
export function Segmented<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (value: T) => void; options: readonly SegmentOption<T>[]; label: string; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex gap-1 rounded-lg border border-border bg-surface-1 p-1", className)}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <label
            key={o.value}
            className={cn(
              "inline-flex h-10 cursor-pointer items-center justify-center rounded-xl px-4 text-sm font-bold transition-colors max-md:h-11",
              "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-info",
              selected ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg",
            )}
          >
            <input type="radio" className="sr-only" name={`seg-${label}`} checked={selected} value={o.value} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}
