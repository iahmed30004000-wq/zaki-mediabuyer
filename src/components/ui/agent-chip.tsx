import type { Lamp as LampState } from "@/core/run-state";
import { cn } from "@/lib/utils";
import { Lamp } from "./lamp";

/**
 * A member of the team as a small card (docs/rebuild-v6/03-look.md §7): a lamp, the name, and one line of what he is doing now. The lamp is the member's state
 * (`run` busy · `done` rested · `wait` waits on somebody · `off` idle); the line says it in words, so the lamp is never alone. The name comes from the team directory.
 */
export function AgentChip({ name, doing, state = "off", className }: { name: string; doing?: string | null; state?: LampState; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5 rounded-xl border border-border bg-surface-1 px-3 py-2.5", className)}>
      <span className="flex items-center gap-2 text-base font-bold text-fg">
        <Lamp state={state} size={10} />
        <span className="min-w-0 truncate">{name}</span>
      </span>
      {doing ? <span className="text-sm text-fg-muted">{doing}</span> : null}
    </div>
  );
}
