"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  /** The words beside the box. Without it the box needs an `aria-label`. */
  label?: string;
}

/** A checkbox in the theme's colours; the whole row (box + words) is the 44px touch target. */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(({ label, className, ...props }, ref) => (
  <label className={cn("inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm text-fg max-md:min-h-11", props.disabled && "cursor-not-allowed opacity-[.45]", className)}>
    <input ref={ref} type="checkbox" className="size-5 shrink-0 cursor-[inherit] rounded-md border-border accent-accent" {...props} />
    {label ? <span>{label}</span> : null}
  </label>
));
Checkbox.displayName = "Checkbox";
