import type { DecorKind } from "@/lib/themes/decor";

/** Retired in P1 (docs/rebuild/03-look.md §1: no decoration). Still exported so old callers compile; they are removed in P2 and this file in P12. */
export function ThemeDecor(_props: { kind: DecorKind }): null {
  return null;
}
