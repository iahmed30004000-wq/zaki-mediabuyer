"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import type { VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { DANGER_FILL, buttonVariants } from "./button-variants";

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color">, Omit<VariantProps<typeof buttonVariants>, "block"> {
  /** Shows a spinner in place of the icon, keeps the text, and locks the button. */
  loading?: boolean;
  /** Full width. */
  block?: boolean;
  /**
   * Two steps in the same place, for anything that cannot be undone: the first press turns the button into «متأكد؟ [أيوه] [لا]»,
   * which goes back by itself after four seconds. The text is the question.
   */
  confirm?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, block, loading, confirm, children, disabled, onClick, type = "button", ...props }, ref) => {
    const [asking, setAsking] = React.useState(false);
    React.useEffect(() => {
      if (!asking) return;
      const timer = window.setTimeout(() => setAsking(false), 4000);
      return () => window.clearTimeout(timer);
    }, [asking]);

    const cls = cn(buttonVariants({ variant, size, block }), className);

    if (confirm && asking) {
      return (
        <span role="group" aria-label={confirm} className={cn("inline-flex items-center gap-1", block && "w-full")}>
          <span className="px-1 text-base font-semibold text-fg">{confirm}</span>
          <button
            type="button"
            className={cn(buttonVariants({ variant: variant === "danger" ? "danger" : "primary", size }), variant === "danger" && DANGER_FILL, className)}
            onClick={(e) => {
              setAsking(false);
              onClick?.(e);
            }}
          >
            أيوه
          </button>
          <button type="button" className={cn(buttonVariants({ variant: "secondary", size }))} onClick={() => setAsking(false)}>
            لا
          </button>
        </span>
      );
    }

    return (
      <button
        ref={ref}
        type={type}
        className={cls}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        onClick={confirm ? () => setAsking(true) : onClick}
        {...props}
      >
        {loading ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-pulse" /> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
