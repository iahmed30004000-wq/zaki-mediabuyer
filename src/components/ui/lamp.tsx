import type { Lamp as LampState } from "@/core/run-state";
import { cn } from "@/lib/utils";

/** A lamp: a circle. `off` is unlit · `run` breathes blue · `done` is green · `wait` blinks orange (it needs you) · `fail` is red · `missed` is an empty dotted ring. */
const LAMP: Record<LampState, string> = {
  off: "bg-muted",
  done: "bg-ok",
  run: "bg-info animate-breathe motion-reduce:animate-none",
  wait: "bg-warn animate-blink motion-reduce:animate-none",
  fail: "bg-danger",
  missed: "border-2 border-dashed border-fg-muted bg-transparent",
};

/** The halo of a lit lamp, in its own state colour. */
const HALO: Partial<Record<LampState, string>> = {
  done: "shadow-lamp-ok",
  run: "shadow-lamp-run",
  wait: "shadow-lamp-wait",
  fail: "shadow-lamp-fail",
};

const SIZE = { 10: "size-2.5", 14: "size-3.5", 18: "size-[18px]", 20: "size-5" } as const;
export type LampSize = keyof typeof SIZE;

/**
 * One lamp (docs/rebuild-v6/03-look.md §6). On its own a lamp says nothing to a screen reader and nothing to somebody who cannot tell the colours apart,
 * so it is drawn alone ONLY inside a light strip (the strip has its own sentence); everywhere else use `StateWord` (a lamp AND its word).
 * `glow={false}` draws a lit lamp without its halo: the state was inferred, not seen. `label` makes the lamp an image with that text.
 */
export function Lamp({ state, size = 14, glow = true, label, className }: { state: LampState; size?: LampSize; glow?: boolean; label?: string; className?: string }) {
  return (
    <span
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      className={cn("inline-block shrink-0 rounded-full", SIZE[size], LAMP[state], glow && HALO[state], className)}
    />
  );
}
