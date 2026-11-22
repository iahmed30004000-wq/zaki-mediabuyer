import { cva } from "class-variance-authority";

/**
 * THE button — a KEY (docs/rebuild-v6/03-look.md §5). Four variants, three sizes — nothing else. The property names are the ones v5 had, so no screen changed.
 *
 *   primary    a key of ink (dark on the light page, pale on the night one) with an edge under it that goes down 2px when pressed. ONE per screen
 *   secondary  a panel with a line, and an edge of the same line colour under it
 *   ghost      quiet text with an underline («ألغِها»، «تجاهل»)
 *   danger     a red outline and red text. The red FILL is only for the last confirm of a stop (`Button confirm`)
 *
 *   lg 52 (the main action of a page) · md 48 (default) · sm 40 (inside cards and rows; 44 on a phone: a finger)
 * Never a button under 40. The ring on focus is the global 3px blue ring (globals.css).
 */
export const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-bold transition-[colors,transform,box-shadow] duration-100 active:translate-y-0.5 disabled:pointer-events-none disabled:opacity-[.45] motion-reduce:transition-none motion-reduce:active:translate-y-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg shadow-key active:shadow-key-down",
        secondary: "border border-border bg-surface-1 text-fg shadow-key-line active:shadow-key-line-down",
        ghost: "text-fg underline decoration-fg/40 underline-offset-4 hover:bg-surface-2 hover:decoration-fg",
        danger: "border border-danger bg-transparent text-danger hover:bg-danger/10",
      },
      size: {
        lg: "h-13 px-6 text-base",
        md: "h-12 px-5 text-base",
        sm: "h-10 px-4 text-sm max-md:h-11",
      },
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "primary", size: "md", block: false },
  },
);

/** The class of the filled red key: the FINAL confirm of a stop only («اوقف الكل» → «أيوه»). */
export const DANGER_FILL = "border-danger bg-danger text-danger-fg hover:bg-danger/90";
