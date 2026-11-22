"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "./icon-button";

/**
 * A step as a block (docs/rebuild-v6/03-look.md §7): its number, its KIND («اقرا المخزون»), its text, two arrows to move it and a cross to remove it. Blocks stand on top of
 * each other, joined by `StepJoint`; this is how a job is built and edited (no drawing board). The buttons are 44 wide: a finger. A button that has no
 * handler is left out (the first block has no «up», the last no «down»).
 */
export function StepBlock({
  n,
  kind,
  children,
  onUp,
  onDown,
  onRemove,
  className,
}: {
  n: number;
  kind: string;
  children?: ReactNode;
  onUp?: () => void;
  onDown?: () => void;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <li className={cn("grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border bg-surface-1 px-3 py-2.5", className)}>
      <span aria-hidden className="inline-grid size-8 shrink-0 place-items-center rounded-full border border-border bg-surface-2 font-display text-base font-extrabold tabular-nums">
        {n}
      </span>
      <div className="min-w-0">
        <b className="block text-base font-semibold text-fg">{kind}</b>
        {children ? <div className="text-sm text-fg-muted">{children}</div> : null}
      </div>
      <div className="flex shrink-0 items-center">
        {onUp ? (
          <IconButton aria-label={`قدّم الخطوة ${n}`} onClick={onUp}>
            <ArrowUp className="size-5" aria-hidden />
          </IconButton>
        ) : null}
        {onDown ? (
          <IconButton aria-label={`أخّر الخطوة ${n}`} onClick={onDown}>
            <ArrowDown className="size-5" aria-hidden />
          </IconButton>
        ) : null}
        {onRemove ? (
          <IconButton aria-label={`احذف الخطوة ${n}`} onClick={onRemove}>
            <X className="size-5" aria-hidden />
          </IconButton>
        ) : null}
      </div>
    </li>
  );
}

/** The joint between two blocks: a short groove of tape with three dark diodes. Decoration only. */
export function StepJoint() {
  return (
    <li aria-hidden role="presentation" className="my-[3px] flex h-[18px] w-2.5 flex-col items-center justify-evenly self-center rounded-[5px] bg-tape">
      <i className="block size-1 rounded-[1px] bg-muted" />
      <i className="block size-1 rounded-[1px] bg-muted" />
      <i className="block size-1 rounded-[1px] bg-muted" />
    </li>
  );
}

/** The list the blocks and joints stand in (an `ol` the screen labels). */
export function StepBlocks({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <ol aria-label={label} className={cn("m-0 flex list-none flex-col p-0", className)}>
      {children}
    </ol>
  );
}
