"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * THE button (docs/rebuild/03-look.md §5). Four variants, three sizes — nothing else.
 *
 *   primary    the one main action of a card or a screen (navy on light, gold on dark)
 *   secondary  a bordered button
 *   ghost      quiet text
 *   danger     red: for risk only (full stop, soft delete, final refusal)
 *
 *   lg 48 (the main action of a page, a decision on a phone) · md 40 (default) · sm 32 (inside tables; 40 on touch screens)
 */
export const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-bold transition-[colors,transform] duration-150 active:scale-[.98] disabled:pointer-events-none disabled:opacity-[.45] motion-reduce:transition-none motion-reduce:active:scale-100",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg hover:bg-accent/90",
        secondary: "border border-border bg-surface-1 text-fg hover:bg-surface-2",
        ghost: "text-fg-muted hover:bg-surface-2 hover:text-fg",
        danger: "bg-danger text-danger-fg hover:bg-danger/90",
      },
      size: {
        lg: "h-12 px-5 text-base",
        md: "h-10 px-4 text-sm",
        sm: "h-8 px-3 text-sm max-md:h-10",
      },
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "primary", size: "md", block: false },
  },
);

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
          <span className="px-1 text-sm font-semibold text-fg">{confirm}</span>
          <button
            type="button"
            className={cn(buttonVariants({ variant: variant === "danger" ? "danger" : "primary", size }), className)}
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
