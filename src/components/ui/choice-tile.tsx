"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface ChoiceTileProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  title: string;
  /** a line under the title */
  hint?: string;
  /** the chosen one (a filled key) */
  pressed?: boolean;
}

/**
 * A big choice (docs/rebuild-v6/03-look.md §7): a key with a title and a line, at least 68 high, for picking one thing out of a few («كل يوم» · «كل أسبوع»).
 * The chosen one is filled with `accent`. A group of tiles is a `role="group"` the caller labels; each tile is a pressed-toggle button.
 */
export const ChoiceTile = React.forwardRef<HTMLButtonElement, ChoiceTileProps>(({ title, hint, pressed = false, className, type = "button", ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    aria-pressed={pressed}
    className={cn(
      "flex min-h-[68px] flex-col items-start justify-center gap-0.5 rounded-xl border px-4 py-3 text-start transition-[colors,transform,box-shadow] duration-100 active:translate-y-0.5 disabled:pointer-events-none disabled:opacity-[.45] motion-reduce:transition-none motion-reduce:active:translate-y-0",
      pressed ? "border-accent bg-accent text-accent-fg shadow-key active:shadow-key-down" : "border-border bg-surface-1 text-fg shadow-key-line active:shadow-key-line-down",
      className,
    )}
    {...props}
  >
    <b className="text-base font-bold">{title}</b>
    {hint ? <span className={cn("text-sm", pressed ? "opacity-80" : "text-fg-muted")}>{hint}</span> : null}
  </button>
));
ChoiceTile.displayName = "ChoiceTile";
