import { Num } from "@/components/mb/num";
import type { Source, TermKey } from "@/lib/glossary";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Delta, type DeltaTone } from "./delta";
import { Sparkline } from "./sparkline";

/**
 * «كنا ← صرنا» (docs/rebuild-v6/03-look.md §7): the label, the number NOW in the big size (with its source badge and its «ليش؟» through `Num`), «كنا …» under it,
 * the difference in words (`Delta`) and the little line. It replaces `Stat` on the home and the numbers screens. Every number arrives computed: this tile draws.
 * A missing number is «—» with the REASON in a sentence (`missing`) and no picture — never a zero, never a silence.
 */
export function WasNow({
  label,
  now,
  was,
  unit = "",
  term,
  source,
  delta,
  series,
  missing,
  className,
}: {
  label: string;
  now: number | null | undefined;
  was: number | null | undefined;
  unit?: "$" | "%" | "x" | "";
  term?: TermKey;
  source?: Source;
  /** from the code: the words and whether the direction is good for this number */
  delta?: { words: string; tone: DeltaTone } | null;
  series?: readonly (number | null | undefined)[];
  /** why the number is missing, in a sentence («ميتا مش مربوطة») */
  missing?: string | null;
  className?: string;
}) {
  const absent = now === null || now === undefined || Number.isNaN(now);
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface-1 p-4", className)}>
      <span className="text-sm font-semibold text-fg-muted">{label}</span>
      <Num value={now} unit={unit} term={term} source={source} label={label} big />
      {absent ? (
        missing ? <span className="text-sm text-fg-muted">{missing}</span> : null
      ) : (
        <>
          <span className="text-sm text-fg-muted">
            كنا <span dir="ltr" className="font-display tabular-nums">{fmt(was, unit)}</span>
          </span>
          {delta ? <Delta words={delta.words} tone={delta.tone} /> : null}
          {series ? <Sparkline values={series} className="mt-1" /> : null}
        </>
      )}
    </div>
  );
}
