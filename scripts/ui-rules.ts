/**
 * THE UI RATCHET (v6 · P2, docs/rebuild-v6/03-look.md §10). Counts the things the new look forbids, by reading the source: a number only goes DOWN.
 * tests/ui-rules.test.ts fails when one goes up past tests/ui-rules.baseline.json, and `npm run ui:baseline` writes the lower numbers (it refuses to write a higher one).
 *
 * v5 read «zero» and it was not zero: 67 raw buttons were excused by a list of exceptions and the technical words slipped past in places the scan skipped.
 * v6 has NO exception list (the old one is gone) and reads more: every JSX text (even one that is followed by `{` or by a new line) and the files that hand text to
 * the screen. So the first v6 baseline is higher than v5's «zero» — that is the REAL count, written once (`RULES_VERSION` changed) — and from then on it only goes down.
 *
 * Plain text matching, no parser: a count is a signal for a person to look at, not a proof. The rules are written down once here so the test, the script and the plan agree.
 * Scanned: `src/app` and `src/components`, except `src/components/ui` (the kit is where the allowed raw elements and sizes live) — plus, for the words only, the files that
 * hand text to the screen: `src/lib/*.ts` and `src/core/*.ts` (not the ones that speak to an agent, `AGENT_FACING`).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Bumped when a metric is added or redefined: the baseline is then written fresh, once, instead of being refused for «going up». */
export const RULES_VERSION = 3;

export const METRICS = [
  "rawButtons",
  "rawControls",
  "jargon",
  "smallText",
  "mockInUi",
  "oldRoutes",
  "bareFetch",
  "arbitraryText",
  "offScaleText",
  "offScaleHeights",
  "hexColors",
  "decorImports",
  "mockChecks",
  "fontMono",
] as const;
export type Metric = (typeof METRICS)[number];
export type Counts = Record<Metric, number>;

/** What each number means, in one line (printed by `npm run ui:baseline`). Every one is 0 since v6 · P8. */
export const METRIC_NOTE: Record<Metric, string> = {
  rawButtons: "<button> written by hand outside the kit — use <Button> / <IconButton> / <ChoiceTile> (no exception list) · 0 since P8",
  rawControls: "<select> <input> <textarea> <table> outside the kit — use Input / Select / Textarea / DataTable · 0 since P8",
  jargon: "words the owner does not use (03-look §9) in Arabic UI text, JSX text included, and in the files that hand text to the screen · 0 since P8",
  smallText: "text-xs — 12px is a badge and a time, never a sentence · 0 since P8",
  mockInUi: "screens and components that import the demo data (@/lib/mock/data) — a screen shows real rows or «—», never an example · 0 since P8",
  oldRoutes: "an href / push / redirect to an address of the redirect table (/work · /ops · /products · /ads/campaigns) · 0 since P8",
  bareFetch: "`await fetch(` in a screen without call() (a dropped network must not freeze a button) · 0 since P3",
  arbitraryText: "text-[NNpx] — only the six sizes of the scale · stays 0",
  offScaleText: "text-2xl / 4xl and bigger — only xs · sm · base · lg · xl · 3xl · stays 0",
  offScaleHeights: "min-h-8/9/14 and h-9 — only the heights of the kit (40 · 44 · 48 · 52) · stays 0",
  hexColors: "#RRGGBB in code — colours come from the theme tokens · stays 0",
  decorImports: "imports of the theme decoration (art-slot, theme-decor, door-shell, decor-visibility) — no decoration · stays 0",
  mockChecks: "MOCK_MODE checks in screens — one line in the shell says «demo» · stays 0",
  fontMono: "font-mono — two faces only (Changa and IBM Plex Sans Arabic) · stays 0",
};

export const emptyCounts = (): Counts => Object.fromEntries(METRICS.map((m) => [m, 0])) as Counts;

const ARABIC = /[؀-ۿ]/;

/**
 * The words the owner never sees (03-look §9), matched only inside Arabic text. «خطوة» and «مهمة» are the RIGHT words now (v5 had banned «خطوة»); «ورك فلو» · «فرع» · «تسليم» ·
 * «طابور» are the old ones. The English and the tool names come from the same table.
 */
const JARGON = new RegExp(
  [
    "ورك\\s*فلو",
    "فرع",
    // «تسليم» alone is the DELIVERY (نسبة التسليم, موعد التسليم): only the handoff forms count
    "هالتسليم|التسليمات|تسليمات|تسليم\\s+(?:للوكيل|لـ|Claude)",
    "طابور",
    "\\bworkflow\\b",
    "\\bhandoff\\b",
    "\\bnode\\b",
    "changeset",
    "dry-run",
    "\\bMCP\\b",
    "\\bClaude API\\b",
    "\\bAPI\\b",
    "webhook",
    "\\btoken\\b",
    "\\bCAPI\\b",
    "executor",
    "\\bapproval\\b",
    "\\bKPI\\b",
    "dashboard",
    "push_metrics",
    "push_stock",
    "log_run",
    "push_jobs",
    "SITE_SCHEDULER",
    "\\b[A-Z][A-Z0-9]*_(?:TOKEN|URL)\\b",
    "Coolify",
    "\\bcron\\b",
    "\\bS\\d{1,2}\\b",
  ].join("|"),
  "i",
);

/**
 * Pages where a technical word is allowed (03-look §9): the connections page and the advanced settings, the panels that only live on the connections page — and the four files that only
 * write ITS sentences («مش مربوط — ناقص …»: the name of the missing setting is the whole point of the line, and the tests hold it).
 */
export const JARGON_ALLOWED = [
  "settings/advanced",
  "settings/connections",
  "components/settings/connections-panel",
  "components/settings/claude-link",
  "components/settings/anthropic-link",
  "components/settings/studio-link",
  "src/core/readiness.ts",
  "src/core/connections.ts",
  "src/lib/readiness-view.ts",
  "src/lib/settings-view.ts",
];

/**
 * Files in `src/lib` and `src/core` that speak to an AGENT (the tool descriptions and the answers an agent reads, the connection contracts, the starter workflows for n8n)
 * and not to the owner. Their words are technical on purpose; the screens never print them.
 */
export const AGENT_FACING = [
  "src/core/mcp-rpc.ts",
  "src/core/workspace-door.ts",
  "src/core/studio-contract.ts",
  "src/core/studio-launch.ts",
  "src/core/n8n-starters.ts",
  "src/core/token-scopes.ts",
  "src/core/step-exec.ts",
  "src/core/run-log.ts",
  "src/core/push-jobs.ts",
  "src/core/push-rows.ts",
  "src/core/log-run.ts",
  "src/core/env-check.ts",
  "src/core/oms-event.ts",
  "src/core/model-key.ts",
  // the instructions the site's assistant (a model) reads
  "src/core/assistant.ts",
  // the schemas of the jobs' graph that the tools hand to a model (their descriptions are frozen with the tool specs) and the seed graphs
  "src/core/workflow.ts",
];

/** Where the scan of a file takes text from. */
const textOnly = (file: string): boolean => /^src\/(?:lib\/[^/]+|core\/[^/]+)\.ts$/.test(file);
const isScreen = (file: string): boolean => /^src\/(?:app|components)\//.test(file) && !file.startsWith("src/components/ui/");

/** Comments out of the way: a word in a comment is not UI text. */
export function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/(^|[\s;{},)])\/\/[^\n"'`]*$/gm, "$1");
}

/** string literals that carry Arabic */
const LITERAL = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
/** JSX text: between a `>` or a `}` and the next `<` or `{`, across lines. */
const JSX_TEXT = /[>}]([^<>{}]*[؀-ۿ][^<>{}]*)(?=[<{])/g;

/** How many pieces of Arabic UI text in this source carry a word the owner does not use. */
export function countJargon(source: string, opts: { jsx: boolean }): number {
  const clean = withoutComments(source);
  let n = 0;
  for (const m of clean.matchAll(LITERAL)) {
    // the code inside a ${…} is not text
    const text = (m[2] ?? "").replace(/\$\{[^}]*\}/g, "");
    if (ARABIC.test(text) && JARGON.test(text)) n++;
  }
  if (opts.jsx) {
    for (const m of clean.matchAll(JSX_TEXT)) {
      const text = m[1] ?? "";
      if (ARABIC.test(text) && JARGON.test(text)) n++;
    }
  }
  return n;
}

/** Addresses of the redirect table (02-screens §8) that nothing should link to any more. */
const OLD_ROUTE = /(?:href\s*[=:]\s*\{?\s*|\.push\(\s*|\.replace\(\s*|redirect\(\s*)[`"']\/(?:work|ops|products|ads\/campaigns|p)(?=[/"'`?#$]|\b)/g;

/** The counts for ONE file's source. `file` is its repo-relative path with forward slashes. */
export function countSource(source: string, file: string): Counts {
  const c = emptyCounts();
  const screen = isScreen(file) || !/^src\//.test(file);
  const words = textOnly(file) && !AGENT_FACING.includes(file);
  if (screen) {
    c.rawButtons = (source.match(/<button\b/g) ?? []).length;
    c.rawControls = (source.match(/<(?:select|input|textarea|table)\b/g) ?? []).length;
    c.smallText = (source.match(/(?<![\w-])text-xs(?![\w-])/g) ?? []).length;
    c.arbitraryText = (source.match(/\btext-\[[^\]]*px\]/g) ?? []).length;
    c.offScaleText = (source.match(/(?<![\w-])text-(?:2xl|4xl|5xl|6xl|7xl|8xl|9xl)(?![\w-])/g) ?? []).length;
    c.offScaleHeights = (source.match(/(?<![\w-])(?:min-h-(?:8|9|14)|h-9)(?![\w.-])/g) ?? []).length;
    c.hexColors = (source.match(/#[0-9A-Fa-f]{6}\b/g) ?? []).length;
    c.decorImports = (source.match(/from\s+["']@\/components\/theme\/(?:art-slot|theme-decor|door-shell|decor-visibility)["']/g) ?? []).length;
    c.mockChecks = (source.match(/MOCK_MODE/g) ?? []).length;
    c.mockInUi = (source.match(/from\s+["']@\/lib\/mock\/data["']/g) ?? []).length;
    c.fontMono = (source.match(/(?<![\w-])font-mono(?![\w-])/g) ?? []).length;
    if (!/from\s+["']@\/lib\/call["']/.test(source)) c.bareFetch = (source.match(/\bawait\s+fetch\(/g) ?? []).length;
    // JSX text exists only in a .tsx file: in a route (.ts) a stretch of code between `>` and `{` is not text
    if (!JARGON_ALLOWED.some((p) => file.includes(p))) c.jargon = countJargon(source, { jsx: file.endsWith(".tsx") });
  } else if (words) {
    if (!JARGON_ALLOWED.some((p) => file.includes(p))) c.jargon = countJargon(source, { jsx: false });
  }
  if (screen || words) c.oldRoutes = (withoutComments(source).match(OLD_ROUTE) ?? []).length;
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

/** The whole repo: the screens (src/app and src/components without the kit) and the files that hand text to them (src/lib/*.ts, src/core/*.ts). */
export function countRepo(root: string): { total: Counts; byFile: Record<string, Counts> } {
  const byFile: Record<string, Counts> = {};
  let total = emptyCounts();
  const files: string[] = [];
  for (const base of ["src/app", "src/components"]) files.push(...walk(path.join(root, base)));
  for (const base of ["src/lib", "src/core"]) {
    for (const name of readdirSync(path.join(root, base)).sort()) if (/\.ts$/.test(name)) files.push(path.join(root, base, name));
  }
  for (const abs of files) {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (rel.startsWith("src/components/ui/")) continue;
    const c = countSource(readFileSync(abs, "utf8"), rel);
    if (METRICS.some((m) => c[m] > 0)) byFile[rel] = c;
    total = addCounts(total, c);
  }
  return { total, byFile };
}

/** The metrics that are higher than the baseline allows (empty = fine). */
export function overBaseline(now: Counts, baseline: Partial<Counts>): { metric: Metric; now: number; allowed: number }[] {
  return METRICS.filter((m) => now[m] > (baseline[m] ?? 0)).map((m) => ({ metric: m, now: now[m], allowed: baseline[m] ?? 0 }));
}
