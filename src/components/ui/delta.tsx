import { cn } from "@/lib/utils";

export type DeltaTone = "good" | "bad" | "flat";

const TONE: Record<DeltaTone, string> = {
  good: "bg-ok/10 text-ok",
  bad: "bg-danger/10 text-danger",
  flat: "bg-surface-2 text-fg-muted",
};

/**
 * The difference, IN WORDS: «أرخص 13%» · «أكتر 19%» · «أحسن 7 نقاط» · «متل ما هو» (docs/rebuild-v6/03-look.md §7). Green when the direction is good for THIS number,
 * red when it is bad, grey when it is neutral (spend is always grey). The words and the tone come from the code (`deltaWords`), this only draws them.
 */
export function Delta({ words, tone, className }: { words: string; tone: DeltaTone; className?: string }) {
  return <span className={cn("inline-flex self-start whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-bold", TONE[tone], className)}>{words}</span>;
}
