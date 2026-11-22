import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { change } from "@/core/today";
import { cn } from "@/lib/utils";

/** Which way is good for this number: more orders is good, a higher cost per order is not, spend is neither. */
export type Good = "up" | "down" | "none";

/** How far a number of the campaigns table moved from the one it is compared with: a small arrow and the percentage (green when the way is good for THIS number, red when it is bad). */
export function ChangeDelta({ now, base, good }: { now: number | null; base: number | null; good: Good }) {
  const c = change(now, base);
  if (c.pct === null) return <span className="text-fg-muted">—</span>;
  const bad = c.dir !== "flat" && good !== "none" && (good === "up" ? c.dir === "down" : c.dir === "up");
  const fine = c.dir !== "flat" && good !== "none" && !bad;
  const Icon = c.dir === "up" ? ArrowUp : c.dir === "down" ? ArrowDown : Minus;
  return (
    <span dir="ltr" className={cn("inline-flex items-center text-sm font-semibold tabular-nums", bad ? "text-danger" : fine ? "text-ok" : "text-fg-muted")}>
      <Icon className="size-3" />
      {Math.abs(c.pct)}%
    </span>
  );
}
