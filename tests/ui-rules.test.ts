import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_FACING, METRICS, RULES_VERSION, addCounts, countJargon, countRepo, countSource, emptyCounts, overBaseline, type Counts } from "../scripts/ui-rules";

const root = path.resolve(__dirname, "..");
const none = (over: Partial<Counts> = {}): Counts => ({ ...emptyCounts(), ...over });
const screen = (src: string, file = "src/components/x.tsx") => countSource(src, file);

describe("what the ratchet counts", () => {
  it("raw buttons — and not <Button>; there is no exception list any more", () => {
    expect(screen('<button type="button">a</button><Button>b</Button><button\n  onClick={x}>').rawButtons).toBe(2);
    // the file that used to be excused is counted like any other
    expect(countSource("<button>a</button>", "src/components/ads/ads-table.tsx").rawButtons).toBe(1);
  });

  it("raw controls: select, input, textarea, table — and not the kit's Input / Select / Textarea / DataTable", () => {
    const c = screen('<select><option/></select><input type="text"/><textarea/><table><tr/></table><Input/><Select/><Textarea/><DataTable/><Table/>');
    expect(c.rawControls).toBe(4);
  });

  it("text-xs is counted (a sentence at 12), text-sm and text-base are not, and a prefix does not hide it", () => {
    expect(screen('className="text-xs md:text-xs text-sm text-base text-xs-ish text-xs2"').smallText).toBe(2);
    expect(screen("text-xl text-lg text-3xl").smallText).toBe(0);
  });

  it("text sizes outside the six, and arbitrary pixel sizes — text-lg is a size now", () => {
    const c = screen('className="text-lg md:text-2xl text-[11px] text-sm text-xs text-base text-xl text-3xl text-fg text-4xl"');
    expect(c.offScaleText).toBe(2);
    expect(c.arbitraryText).toBe(1);
  });

  it("heights that are not the kit's (40 · 44 · 48 · 52): 44 and 48 are allowed now", () => {
    const c = screen('"min-h-9 h-11 min-h-12 min-h-8 min-h-14 h-9"   "h-8 h-10 h-12 h-13 min-h-10 min-h-11 min-h-dvh size-9 h-90 sm:h-9"');
    expect(c.offScaleHeights).toBe(5);
  });

  it("hex colours, decoration imports, MOCK_MODE, font-mono", () => {
    const src = `import { ThemeDecor } from "@/components/theme/theme-decor";\nimport { ThemePicker } from "@/components/theme/theme-picker";\nconst a = "#1B2A4A"; const b = "#fff"; if (process.env.MOCK_MODE === "1") {} const c = "font-mono text-fg";`;
    expect(screen(src)).toMatchObject({ hexColors: 1, decorImports: 1, mockChecks: 1, fontMono: 1 });
  });

  it("the demo data imported into a screen", () => {
    expect(screen('import { PRODUCTS } from "@/lib/mock/data";\nimport { x } from "@/lib/mock/other";').mockInUi).toBe(1);
  });

  it("a bare fetch: only in a file that does not use call()", () => {
    expect(screen("const r = await fetch('/api/x');\nawait fetch('/api/y');").bareFetch).toBe(2);
    expect(screen('import { callJson } from "@/lib/call";\nconst r = await fetch(u);').bareFetch).toBe(0);
    expect(screen("const r = await callJson('/api/x');").bareFetch).toBe(0);
  });

  it("an old route: an href, a push, a redirect to an address of the redirect table", () => {
    const src = [
      '<Link href="/work/today">',
      "{ href: '/ops/stock' }",
      'href={`/products/${code}`}',
      'router.push("/ads/campaigns")',
      'redirect("/work")',
      '<Link href="/workflow-x">', // not an old route
      '<Link href="/numbers/products">', // the new one
      '<Link href="/tasks">', // a real place now
      '// href="/work/old" in a comment',
      'const x = "/work/today"; // a plain string is not a link',
    ].join("\n");
    expect(screen(src).oldRoutes).toBe(5);
  });

  it("a file in src/core or src/lib is read for words and old routes only — not for classes", () => {
    const c = countSource('const a = "text-xs <button> font-mono"; const link = { href: "/work" }; const s = "شغّل ورك فلو";', "src/lib/foo-view.ts");
    expect(c).toMatchObject({ jargon: 1, oldRoutes: 1, smallText: 0, rawButtons: 0, fontMono: 0 });
  });

  it("the files that speak to an agent are not read for words", () => {
    expect(AGENT_FACING.length).toBeGreaterThan(5);
    const src = 'const a = "اربط الـ MCP بالتوكن";';
    expect(countSource(src, "src/core/mcp-rpc.ts").jargon).toBe(0);
    expect(countSource(src, "src/core/anything-else.ts").jargon).toBe(1);
  });
});

describe("jargon: only inside Arabic UI text — not in code, comments or English-only strings", () => {
  it("string literals", () => {
    expect(countJargon('const a = "شغّل ورك فلو جديد";', { jsx: false })).toBe(1);
    expect(countJargon('const b = "workflow";', { jsx: false })).toBe(0); // English only: not UI text
    expect(countJargon("// ورك فلو بالتعليق", { jsx: false })).toBe(0);
    expect(countJargon("/* ورك فلو\n   بالتعليق */", { jsx: false })).toBe(0);
    expect(countJargon('const c = { handoff: "x", label: "مهمة" };', { jsx: false })).toBe(0); // identifier + innocent Arabic
    expect(countJargon('toast("انطلب من Claude عبر MCP")', { jsx: false })).toBe(1);
  });

  it("JSX text: on one line, followed by { , and across several lines", () => {
    expect(countJargon("<p>الورك فلو جديد</p>", { jsx: true })).toBe(1);
    expect(countJargon("<p>اضغط لتعمل فرع جديد: {name}</p>", { jsx: true })).toBe(1);
    expect(countJargon("<p>\n  هالطابور فاضي\n</p>", { jsx: true })).toBe(1);
    expect(countJargon("<p>{n} فرع شغّال</p>", { jsx: true })).toBe(1); // after a }
    expect(countJargon("<p>مهمة جديدة</p>", { jsx: true })).toBe(0);
  });

  it("«خطوة» and «مهمة» are the right words now; «تسليم» alone is the delivery rate, not the handoff", () => {
    expect(countJargon('x = "خطوة جديدة بالمهمة"', { jsx: false })).toBe(0);
    expect(countJargon('x = "نسبة التسليم 70%"', { jsx: false })).toBe(0);
    expect(countJargon('x = "هالتسليم مكلّف فيه Claude"', { jsx: false })).toBe(1);
  });

  it("the old words and the technical ones of the table", () => {
    for (const w of ["طابور", "فرع", "webhook", "Coolify", "SITE_SCHEDULER", "N8N_WEBHOOK_URL", "push_metrics", "log_run", "cron", "S11", "dry-run", "MCP"]) {
      expect(countJargon(`x = "اكتب ${w} هون"`, { jsx: false }), w).toBe(1);
    }
  });

  it("code inside a template literal is not text", () => {
    expect(countJargon("x = `هلق عند ${cur.node.label}`", { jsx: false })).toBe(0);
    expect(countJargon("x = `هلق عند ${n} فرع`", { jsx: false })).toBe(1);
  });

  it("the connections page and the advanced settings may use the technical words", () => {
    const src = 'const a = "ورك فلو";';
    expect(countSource(src, "src/app/(app)/settings/advanced/page.tsx").jargon).toBe(0);
    expect(countSource(src, "src/app/(app)/settings/connections/page.tsx").jargon).toBe(0);
    expect(countSource(src, "src/components/settings/claude-link.tsx").jargon).toBe(0);
    expect(countSource(src, "src/components/settings/rules-editor.tsx").jargon).toBe(1);
  });
});

describe("adding counts and the ratchet's arithmetic", () => {
  it("adds counts and says which metric went up", () => {
    expect(addCounts(none({ rawButtons: 2 }), none({ rawButtons: 3, jargon: 1 }))).toMatchObject({ rawButtons: 5, jargon: 1 });
    expect(overBaseline(none({ rawButtons: 5, jargon: 1 }), { rawButtons: 5, jargon: 0 })).toEqual([{ metric: "jargon", now: 1, allowed: 0 }]);
    expect(overBaseline(none({ rawButtons: 4 }), { rawButtons: 5 })).toEqual([]);
  });
});

describe("the ratchet: a number only goes down", () => {
  const saved = JSON.parse(readFileSync(path.join(root, "tests/ui-rules.baseline.json"), "utf8")) as Partial<Counts> & { rulesVersion?: number };
  const { rulesVersion, ...baseline } = saved;
  const { total, byFile } = countRepo(root);

  it("the baseline is written for these rules (run `npm run ui:baseline` after changing scripts/ui-rules.ts)", () => {
    expect(rulesVersion).toBe(RULES_VERSION);
  });

  it("the baseline names every metric", () => {
    expect(Object.keys(baseline).sort()).toEqual([...METRICS].sort());
  });

  it("no rule got worse than the baseline (fix the code — never raise the baseline; `npm run ui:baseline -- --where` lists the files)", () => {
    expect(overBaseline(total, baseline)).toEqual([]);
  });

  it("the rules that must stay at zero are at zero", () => {
    for (const m of ["arbitraryText", "offScaleText", "offScaleHeights", "hexColors", "decorImports", "mockChecks", "fontMono"] as const) expect(total[m], m).toBe(0);
  });

  it("the kit itself is not counted (it is where the allowed raw elements live)", () => {
    expect(Object.keys(byFile).some((f) => f.startsWith("src/components/ui/"))).toBe(false);
  });

  it("there is no list of excused raw buttons any more", () => {
    expect(readFileSync(path.join(root, "scripts/ui-rules.ts"), "utf8")).not.toMatch(/RAW_BUTTON_EXCEPTIONS/);
  });
});
