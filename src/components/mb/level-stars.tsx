import { Star } from "lucide-react";
import { LEVEL_AR, LEVEL_HINT } from "@/lib/mock/data";
import { cn } from "@/lib/utils";

/**
 * The autonomy level as stars (0–3): how much the system may do on its own in an account.
 * Three empty stars = it only advises. A nod to the night-city games, in our own drawing.
 */
export function LevelStars({ level, showLabel = true, className }: { level: 0 | 1 | 2 | 3; showLabel?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} title={`${LEVEL_AR[level]}: ${LEVEL_HINT[level]}`}>
      <span className="inline-flex" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <Star key={i} className={cn("size-3.5", i <= level ? "fill-accent-2 text-accent-2" : "text-border")} strokeWidth={2} />
        ))}
      </span>
      {showLabel ? <span className="text-xs text-fg-muted">المستوى {level} · {LEVEL_AR[level]}</span> : <span className="sr-only">المستوى {level}: {LEVEL_AR[level]}</span>}
    </span>
  );
}
