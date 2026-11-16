import { cva } from "class-variance-authority";

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
