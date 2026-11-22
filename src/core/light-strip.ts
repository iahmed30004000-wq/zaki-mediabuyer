/**
 * THE LIGHT STRIP, AS DATA (docs/rebuild-v6/03-look.md §6). One lamp for every step, and between two lamps a stretch of three small diodes.
 * The stretch BEHIND a finished step glows green; behind the running step the diodes chase one another; behind anything else it is dark.
 * The strip never guesses: a step the site only inferred (the agent told how the run ended, not the steps) is drawn green WITHOUT a halo,
 * and the explicit line above the strip says so (02-screens §3.6). This file decides what is drawn; `LightStrip` and `RunSteps` draw it.
 * Pure: no React, no clock, no database.
 */
import type { Lamp } from "./run-state";

/** Above this many steps, on a phone, the finished ones folded together become ONE stretch with their count written on it. */
export const STRIP_FOLD_OVER = 12;

export interface StripStep {
  id: string;
  lamp: Lamp;
  /** the site guessed this state: green, but no halo */
  inferred?: boolean;
  /** the step's title, for the vertical rope (`RunSteps`) and the accessible text */
  label?: string;
}

/** What the stretch behind a lamp looks like. */
export interface Stretch {
  /** the diodes glow green */
  lit: boolean;
  /** the diodes run one behind the other */
  chase: boolean;
  /** a halo round a lit diode (never for an inferred step) */
  glow: boolean;
}

/** The stretch that follows a step (towards the next one). */
export function stretchAfter(step: Pick<StripStep, "lamp" | "inferred">): Stretch {
  if (step.lamp === "done") return { lit: true, chase: false, glow: !step.inferred };
  if (step.lamp === "run") return { lit: false, chase: true, glow: false };
  return { lit: false, chase: false, glow: false };
}

export type StripItem =
  | { kind: "lamp"; id: string; lamp: Lamp; /** the halo is drawn only when the state was seen, not inferred */ glow: boolean; label?: string }
  | ({ kind: "stretch" } & Stretch)
  | { kind: "fold"; /** how many finished steps this stretch stands for */ count: number; glow: boolean };

/**
 * The items of a strip, left to right in reading order: lamp, stretch, lamp, … With `fold`, every run of two or more finished steps that follow each other
 * becomes ONE `fold` item (a lit stretch with the count on it). The count of lamps without folding is the count of steps; the count of stretches is one less.
 */
export function stripItems(steps: readonly StripStep[], opts: { fold?: boolean } = {}): StripItem[] {
  const out: StripItem[] = [];
  const push = (item: StripItem) => out.push(item);
  let i = 0;
  while (i < steps.length) {
    const s = steps[i]!;
    let j = i;
    if (opts.fold && s.lamp === "done") {
      while (j + 1 < steps.length && steps[j + 1]!.lamp === "done") j++;
    }
    const folded = j > i;
    if (folded) {
      const run = steps.slice(i, j + 1);
      push({ kind: "fold", count: run.length, glow: run.every((x) => !x.inferred) });
    } else {
      push({ kind: "lamp", id: s.id, lamp: s.lamp, glow: !s.inferred, ...(s.label ? { label: s.label } : {}) });
    }
    if (j + 1 < steps.length) push({ kind: "stretch", ...stretchAfter(steps[j]!) });
    i = j + 1;
  }
  return out;
}

/** Does this strip need the folded version on a phone? (More than `STRIP_FOLD_OVER` steps.) */
export const needsFold = (steps: readonly unknown[]): boolean => steps.length > STRIP_FOLD_OVER;

const LAMP_WORD: Record<Lamp, string> = { off: "لسا", run: "شغّالة", done: "خلصت", wait: "بدها موافقتك", fail: "وقفت", missed: "فاتت" };

/**
 * The accessible text of a strip when the caller has not got the run's own sentence: «5 خطوات: 3 خلصت، وخطوة شغّالة». The strip normally carries the
 * run sentence (`runSentence`), and this is only the fallback.
 */
export function stripSummary(steps: readonly Pick<StripStep, "lamp">[]): string {
  if (!steps.length) return "ما في خطوات";
  const count = (l: Lamp) => steps.filter((s) => s.lamp === l).length;
  const parts = (["done", "run", "wait", "fail", "missed"] as const).filter((l) => count(l) > 0).map((l) => `${count(l)} ${LAMP_WORD[l]}`);
  return `${steps.length} خطوات${parts.length ? `: ${parts.join("، ")}` : ""}`;
}

/** The moves of the playground at /dev/kit («ملعب الحبل»): a pretend run that goes step by step. Pure, so the playground and its test agree. */
export type RopeMove = "next" | "hold" | "fail" | "reset";

/**
 * One move of the pretend run. `next` finishes the running step and starts the following one (the first press starts the first; after the last, the run is done);
 * `hold` makes the running step wait for the owner; `fail` stops it; `reset` puts every lamp out. A move that makes no sense does nothing (a finished run stays finished).
 */
export function ropeMove(lamps: readonly Lamp[], move: RopeMove): Lamp[] {
  const next = [...lamps];
  if (move === "reset") return next.map(() => "off");
  const at = next.findIndex((l) => l === "run" || l === "wait");
  if (move === "hold") {
    if (at !== -1 && next[at] === "run") next[at] = "wait";
    return next;
  }
  if (move === "fail") {
    if (at !== -1) next[at] = "fail";
    return next;
  }
  // next
  if (next.some((l) => l === "fail")) return next;
  if (at !== -1) {
    next[at] = "done";
    if (at + 1 < next.length) next[at + 1] = "run";
    return next;
  }
  const first = next.findIndex((l) => l === "off");
  if (first !== -1) next[first] = "run";
  return next;
}
