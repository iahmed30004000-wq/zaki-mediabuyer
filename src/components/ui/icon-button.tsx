"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> {
  /** What the button does, in Arabic — required: an icon alone says nothing to a screen reader. */
  "aria-label": string;
  /** `danger` is for the full stop only. */
  tone?: "default" | "danger";
  children: React.ReactNode;
}

/** A square icon button: 44×44, always (docs/rebuild-v6/03-look.md §5: a finger, not a cursor). */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(({ className, tone = "default", type = "button", children, ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    className={cn(
      "inline-flex size-11 shrink-0 items-center justify-center rounded-lg transition-[colors,transform] duration-100 active:translate-y-0.5 disabled:pointer-events-none disabled:opacity-[.45] motion-reduce:transition-none motion-reduce:active:translate-y-0",
      tone === "danger" ? "bg-danger text-danger-fg hover:bg-danger/90" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
      className,
    )}
    {...props}
  >
    {children}
  </button>
));
IconButton.displayName = "IconButton";
