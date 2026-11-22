"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A tap that is a part of a row or a line of text, not a key of its own: the name of a row that opens its sheet, the chevron that opens what is under it, a small «i» beside a column's
 * name, a chip that sets a filter. It draws nothing (the caller says how it looks — `className`), but it is always a real `<button>`: the keyboard reaches it and a screen reader says what it
 * does (`aria-label` for an icon). A small one grows its touch area to 44px with `grow` (an invisible edge around it), so a finger can hit it without the row getting taller.
 * A KEY (a button with its own shape and weight) is `Button`, an icon on its own is `IconButton` — this is for what lives inside something else.
 */
export const Tap = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { grow?: boolean }>(({ className, grow = false, type = "button", ...props }, ref) => (
  <button ref={ref} type={type} className={cn("cursor-pointer disabled:cursor-not-allowed disabled:opacity-[.45]", grow && "relative after:absolute after:-inset-3 after:content-['']", className)} {...props} />
));
Tap.displayName = "Tap";
