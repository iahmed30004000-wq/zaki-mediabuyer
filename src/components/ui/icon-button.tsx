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

/** A square icon button: 40×40 (44×44 on touch screens). */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(({ className, tone = "default", type = "button", children, ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    className={cn(
      "inline-flex size-10 max-md:size-11 shrink-0 items-center justify-center rounded-lg transition-[colors,transform] duration-150 active:scale-[.98] disabled:pointer-events-none disabled:opacity-[.45] max-md:size-11 motion-reduce:transition-none",
      tone === "danger" ? "bg-danger text-danger-fg hover:bg-danger/90" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
      className,
    )}
    {...props}
  >
    {children}
  </button>
));
IconButton.displayName = "IconButton";
