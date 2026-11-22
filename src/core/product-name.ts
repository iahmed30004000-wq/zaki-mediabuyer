/**
 * THE NAME OF A PRODUCT, IN ARABIC, EVERYWHERE (v6 · P6, U-08, docs/rebuild-v6/03-look.md §8 rule 10) — pure. The OMS gives a product a code («ALBETCHU») and a name that may be written in Latin
 * letters; the owner reads Arabic. The name that is shown is the first of: the name when it has Arabic letters · the first alternative name (the aliases) that has · the name as it is · the
 * code. The code is never dropped: a screen writes it small and faint after the Arabic name (`ProductName`), so the two can always be matched.
 */

/** Letters of the Arabic block: a name with none is a code written in Latin letters. */
export const hasArabic = (s: string | null | undefined): boolean => !!s && /[؀-ۿ]/.test(s);

export interface NameSource {
  name?: string | null;
  /** the alternative names the owner or the OMS gave (`ProductAlias`) */
  aliases?: readonly string[] | null;
}

export interface ProductLabel {
  code: string;
  /** what the screens write */
  name: string;
  /** the name written is Arabic; false: only a Latin name or the code is there (the readiness card counts these) */
  arabic: boolean;
}

/** The label of one product. A product nobody named is its code, and `arabic` says so. */
export function productLabel(code: string, src: NameSource | null | undefined): ProductLabel {
  const name = src?.name?.trim() || "";
  if (hasArabic(name)) return { code, name, arabic: true };
  const alias = (src?.aliases ?? []).map((a) => a.trim()).find((a) => hasArabic(a));
  if (alias) return { code, name: alias, arabic: true };
  return { code, name: name || code, arabic: false };
}

/** The labels of many products by code. `names` and `aliases` are the two tables as they are read. */
export function productLabels(names: readonly { productCode: string; name: string }[], aliases: readonly { productCode: string; alias: string }[]): Map<string, ProductLabel> {
  const byCode = new Map<string, string[]>();
  for (const a of aliases) byCode.set(a.productCode, [...(byCode.get(a.productCode) ?? []), a.alias]);
  return new Map(names.map((n) => [n.productCode, productLabel(n.productCode, { name: n.name, aliases: byCode.get(n.productCode) ?? [] })]));
}

/** The name to write for a code: the label's when there is one, else the code itself. */
export const nameOf = (labels: ReadonlyMap<string, ProductLabel>, code: string): string => labels.get(code)?.name ?? code;
