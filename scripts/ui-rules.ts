/**
 * THE UI RATCHET (v5 · P0, docs/rebuild/03-look.md §10). Counts the things the new look forbids, by reading the source:
 * a number only goes DOWN. tests/ui-rules.test.ts fails when one goes up past tests/ui-rules.baseline.json, and
 * `npm run ui:baseline` writes the lower numbers (it refuses to write a higher one).
 *
 * Plain text matching, no parser: a count is a signal for a person to look at, not a proof. The rules are written down
 * once here so the test, the script and the plan agree. Scanned: src/app and src/components, except src/components/ui
 * (the kit itself is where the allowed raw elements and sizes live).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const METRICS = ["rawButtons", "arbitraryText", "offScaleText", "offScaleHeights", "hexColors", "decorImports", "mockChecks", "jargon"] as const;
export type Metric = (typeof METRICS)[number];
export type Counts = Record<Metric, number>;

/** What each number means, in one line (printed by `npm run ui:baseline`). */
export const METRIC_NOTE: Record<Metric, string> = {
  rawButtons: "<button> written by hand outside the kit — use <Button> / <IconButton>",
  arbitraryText: "text-[NNpx] — only the five sizes of the scale",
  offScaleText: "text-lg / 2xl / 4xl and bigger — only xs · sm · base · xl · 3xl",
  offScaleHeights: "min-h-8/9/11/12/14 and h-9/h-11 — only the heights of the kit",
  hexColors: "#RRGGBB in code — colours come from the theme tokens",
  decorImports: "imports of the theme decoration (art-slot, theme-decor, door-shell, decor-visibility) — no decoration",
  mockChecks: "MOCK_MODE checks in screens — one line in the shell says «demo»",
  jargon: "words the owner does not use (workflow, handoff, dry-run, MCP, webhook…) inside Arabic UI text",
};

export const emptyCounts = (): Counts => Object.fromEntries(METRICS.map((m) => [m, 0])) as Counts;

const ARABIC = /[؀-ۿ]/;
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;
/** «ورك فلو» · «خطوة» · «تسليم» and the English words the owner never says (03-look §8). Matched only inside Arabic text. */
const JARGON = /ورك\s*فلو|خطوة|تسليم|workflow|handoff|changeset|dry-run|\bMCP\b|\bAPI\b|webhook|\btoken\b|\bCAPI\b|executor|\bapproval\b|\bKPI\b|dashboard/i;
/** string literals and JSX text that carry Arabic */
const LITERAL = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1|>([^<>{}\n]*[؀-ۿ][^<>{}\n]*)</g;

/** The counts for ONE file's source. `file` is its repo-relative path with forward slashes. */
export function countSource(source: string, file: string): Counts {
  const c = emptyCounts();
  c.rawButtons = (source.match(/<button\b/g) ?? []).length;
  c.arbitraryText = (source.match(/\btext-\[[^\]]*px\]/g) ?? []).length;
  c.offScaleText = (source.match(/\btext-(?:lg|2xl|4xl|5xl|6xl|7xl|8xl|9xl)(?![\w-])/g) ?? []).length;
  c.offScaleHeights = (source.match(/(?<![\w-])(?:min-h-(?:8|9|11|12|14)|h-(?:9|11))(?![\w.-])/g) ?? []).length;
  c.hexColors = (source.match(/#[0-9A-Fa-f]{6}\b/g) ?? []).length;
  c.decorImports = (source.match(/from\s+["']@\/components\/theme\/(?:art-slot|theme-decor|door-shell|decor-visibility)["']/g) ?? []).length;
  c.mockChecks = (source.match(/MOCK_MODE/g) ?? []).length;
  if (!file.includes("settings/advanced")) {
    for (const line of source.split("\n")) {
      if (!ARABIC.test(line) || COMMENT_LINE.test(line)) continue;
      for (const m of line.matchAll(LITERAL)) {
        const text = m[2] ?? m[3] ?? "";
        if (ARABIC.test(text) && JARGON.test(text)) c.jargon++;
      }
    }
  }
  return c;
}

export const addCounts = (a: Counts, b: Counts): Counts => Object.fromEntries(METRICS.map((m) => [m, a[m] + b[m]])) as Counts;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(name)) yield p;
  }
}

/** The whole repo: src/app and src/components, without the kit (src/components/ui). */
export function countRepo(root: string): { total: Counts; byFile: Record<string, Counts> } {
  const byFile: Record<string, Counts> = {};
  let total = emptyCounts();
  for (const base of ["src/app", "src/components"]) {
    for (const abs of walk(path.join(root, base))) {
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (rel.startsWith("src/components/ui/")) continue;
      const c = countSource(readFileSync(abs, "utf8"), rel);
      if (METRICS.some((m) => c[m] > 0)) byFile[rel] = c;
      total = addCounts(total, c);
    }
  }
  return { total, byFile };
}

/** The metrics that are higher than the baseline allows (empty = fine). */
export function overBaseline(now: Counts, baseline: Partial<Counts>): { metric: Metric; now: number; allowed: number }[] {
  return METRICS.filter((m) => now[m] > (baseline[m] ?? 0)).map((m) => ({ metric: m, now: now[m], allowed: baseline[m] ?? 0 }));
}
