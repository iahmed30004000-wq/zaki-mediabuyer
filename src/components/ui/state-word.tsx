import { wordOf, type WordState, type WordTone } from "@/core/state-word";
import { cn } from "@/lib/utils";
import { Lamp } from "./lamp";

const TONE: Record<WordTone, string> = {
  ok: "text-ok",
  info: "text-info",
  warn: "text-warn",
  danger: "text-danger",
  muted: "text-fg-muted",
};

/**
 * A state: its lamp AND its word, in the same colour («خلصت» green · «شغّالة» blue · «بدها موافقتك» orange · «وقفت» red). The word is the one of
 * `core/state-word.ts`, the same in every screen. `who` completes «بانتظار …».
 */
export function StateWord({ state, who, className }: { state: WordState; who?: string | null; className?: string }) {
  const spec = wordOf(state, who);
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-bold", TONE[spec.tone], className)}>
      <Lamp state={spec.lamp} size={10} />
      {spec.word}
    </span>
  );
}
