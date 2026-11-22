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

export const METRICS = ["rawButtons", "arbitraryText", "offScaleText", "offScaleHeights", "hexColors", "decorImports", "mockChecks", "mockInUi", "jargon"] as const;
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
  mockInUi: "screens and components that import the demo data (@/lib/mock/data) — a screen shows real rows or «—», never an example",
  jargon: "words the owner does not use (workflow, handoff, dry-run, MCP, webhook…) inside Arabic UI text",
};

/**
 * RAW <button> THAT STAYS, BY FILE (P12). The kit's Button / IconButton cover the common cases; these are the places where a raw element is the right one — a whole
 * row as the click target, a tab-like toggle group, a dense icon control inside a table or a canvas, a text link inside a sentence. `allowed` is how many each
 * file may hold: a NEW raw button in any of them (or in any other file) fails the ratchet, and tests/ui-rules.test.ts fails when an allowance is higher than what the file has.
 */
export const RAW_BUTTON_EXCEPTIONS: Record<string, { allowed: number; why: string }> = {
  "src/components/ads/ads-table.tsx": { allowed: 6, why: "a dense icon control inside a table, toolbar or canvas where the kit's 40px IconButton would break the layout — the expander, the column reorder arrows, the help dot and the filter reset sit inside a dense table" },
  "src/components/ads/launch-wizard.tsx": { allowed: 4, why: "a whole row or card is the click target (its content is arbitrary, a Button would wrap it wrongly) — choice cards of the launch wizard" },
  "src/components/approvals/approval-card.tsx": { allowed: 1, why: "text that reads as a link inside a sentence, not a button" },
  "src/components/approvals/approval-ringer.tsx": { allowed: 1, why: "a whole row or card is the click target (its content is arbitrary, a Button would wrap it wrongly)" },
  "src/components/creatives/creatives-view.tsx": { allowed: 1, why: "a tab, radio or pressed-toggle group with its own aria roles (the kit's Tabs/Segmented do not take this content)" },
  "src/components/customize/card-custom.tsx": { allowed: 2, why: "text that reads as a link inside a sentence, not a button" },
  "src/components/customize/card-fields.tsx": { allowed: 3, why: "text that reads as a link inside a sentence, not a button" },
  "src/components/customize/edit-panel.tsx": { allowed: 4, why: "a tab, radio or pressed-toggle group with its own aria roles (the kit's Tabs/Segmented do not take this content)" },
  "src/components/done/day-controls.tsx": { allowed: 1, why: "a whole row or card is the click target (its content is arbitrary, a Button would wrap it wrongly)" },
  "src/components/home/mode-switch.tsx": { allowed: 1, why: "a tab, radio or pressed-toggle group with its own aria roles (the kit's Tabs/Segmented do not take this content)" },
  "src/components/home/morning-card.tsx": { allowed: 1, why: "a dense icon control inside a table, toolbar or canvas where the kit's 40px IconButton would break the layout" },
  "src/components/login-form.tsx": { allowed: 1, why: "text that reads as a link inside a sentence, not a button" },
  "src/components/mb/num.tsx": { allowed: 1, why: "text that reads as a link inside a sentence, not a button — the number itself is the «why?» trigger" },
  "src/components/numbers/numbers-view.tsx": { allowed: 3, why: "a whole row or card is the click target (its content is arbitrary, a Button would wrap it wrongly)" },
  "src/components/numbers/print-button.tsx": { allowed: 1, why: "the print view is black on white by design, whatever the theme" },
  "src/components/settings/editors.tsx": { allowed: 1, why: "a dense icon control inside a table, toolbar or canvas where the kit's 40px IconButton would break the layout — a remove-chip icon" },
  "src/components/settings/level-picker.tsx": { allowed: 1, why: "a tab, radio or pressed-toggle group with its own aria roles (the kit's Tabs/Segmented do not take this content)" },
  "src/components/settings/mode-settings.tsx": { allowed: 1, why: "a dense icon control inside a table, toolbar or canvas where the kit's 40px IconButton would break the layout" },
  "src/components/shell/command-palette.tsx": { allowed: 1, why: "a whole row or card is the click target (its content is arbitrary, a Button would wrap it wrongly)" },
  "src/components/shell/consultant.tsx": { allowed: 6, why: "a whole row or card is the click target (its content is arbitrary, a Button would wrap it wrongly) — the assistant's chat controls: suggestion chips, send, close" },
  "src/components/shell/date-switcher.tsx": { allowed: 2, why: "a tab, radio or pressed-toggle group with its own aria roles (the kit's Tabs/Segmented do not take this content)" },
  "src/components/tasks/tasks-board.tsx": { allowed: 3, why: "a whole row or card is the click target (its content is arbitrary, a Button would wrap it wrongly) — the task row and the board and column tabs" },
  "src/components/videos/board-view.tsx": { allowed: 1, why: "text that reads as a link inside a sentence, not a button" },
  "src/components/workflow/editor/canvas.tsx": { allowed: 3, why: "a dense icon control inside a table, toolbar or canvas where the kit's 40px IconButton would break the layout — the drawing canvas: edge buttons and zoom controls" },
  "src/components/workflow/editor/editor.tsx": { allowed: 5, why: "a dense icon control inside a table, toolbar or canvas where the kit's 40px IconButton would break the layout — the editor toolbar: mode toggles, undo and redo, replay" },
  "src/components/workflow/editor/node-form.tsx": { allowed: 2, why: "a tab, radio or pressed-toggle group with its own aria roles (the kit's Tabs/Segmented do not take this content)" },
  "src/components/workflow/editor/node-picker.tsx": { allowed: 1, why: "a whole row or card is the click target (its content is arbitrary, a Button would wrap it wrongly)" },
  "src/components/workflow/editor/replay-bar.tsx": { allowed: 4, why: "a dense icon control inside a table, toolbar or canvas where the kit's 40px IconButton would break the layout" },
  "src/components/workflow/editor/settings-sheet.tsx": { allowed: 1, why: "a tab, radio or pressed-toggle group with its own aria roles (the kit's Tabs/Segmented do not take this content)" },
  "src/components/workflow/editor/steps-view.tsx": { allowed: 3, why: "a whole row or card is the click target (its content is arbitrary, a Button would wrap it wrongly) — a branch row and its reorder arrows" },
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
  c.mockInUi = (source.match(/from\s+["']@\/lib\/mock\/data["']/g) ?? []).length;
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
      c.rawButtons = Math.max(0, c.rawButtons - (RAW_BUTTON_EXCEPTIONS[rel]?.allowed ?? 0));
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
