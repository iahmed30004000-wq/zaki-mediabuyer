import { cn } from "@/lib/utils";

/**
 * The mark of the product: a navy square with a gold «م». With `JobNumber`, one of the two places a colour is written by value (the navy and
 * the gold are the identity, the same in both themes; a night square on the dark one) — docs/rebuild-v6/03-look.md §2.
 * The size comes from the caller (`size-8`, `size-14`): the letter scales with the square.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" className={cn("size-9 shrink-0", className)} aria-hidden="true" focusable="false">
      <rect width="36" height="36" rx="10" className="fill-[#1B2A4A] dark:fill-[#0B1220]" />
      <text x="18" y="26.5" textAnchor="middle" fontSize="23" fontWeight="800" className="fill-[#F2B705] font-display">
        م
      </text>
    </svg>
  );
}
