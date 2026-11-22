import { cn } from "@/lib/utils";

/**
 * The number of a job on the map: a navy square with a gold number, the same in both themes (a night square on the dark one).
 * This and `BrandMark` are the only two places a colour is written by value (docs/rebuild-v6/03-look.md §2): the gold lives here and in the logo, nowhere else.
 */
export function JobNumber({ n, className }: { n: number | null; className?: string }) {
  return (
    <span
      aria-label={n === null ? "بلا رقم" : `رقم ${n}`}
      className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[#1B2A4A] font-display text-base font-extrabold tabular-nums text-[#F2B705] dark:bg-[#0B1220]", className)}
    >
      <span dir="ltr">{n === null ? "·" : n}</span>
    </span>
  );
}
