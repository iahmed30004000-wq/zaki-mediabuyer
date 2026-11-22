"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface RadioProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  /** The words beside the button. Without it the radio needs an `aria-label`. */
  label?: string;
  /**
   * Only the input, with no row around it: for a card that IS the radio (the whole card is its `<label>`, the input is hidden with `sr-only` and the card draws the choice — a theme, a plan).
   * The caller owns the look and the touch target then.
   */
  bare?: boolean;
}

/** One radio of a group (give them the same `name`): the arrows move the choice. With `label` the whole row — the button and its words — is the 44px touch target. */
export const Radio = React.forwardRef<HTMLInputElement, RadioProps>(({ label, bare = false, className, ...props }, ref) => {
  if (bare) return <input ref={ref} type="radio" className={className} {...props} />;
  return (
    <label className={cn("inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm text-fg max-md:min-h-11", props.disabled && "cursor-not-allowed opacity-[.45]", className)}>
      <input ref={ref} type="radio" className="size-5 shrink-0 cursor-[inherit] accent-accent" {...props} />
      {label ? <span>{label}</span> : null}
    </label>
  );
});
Radio.displayName = "Radio";
