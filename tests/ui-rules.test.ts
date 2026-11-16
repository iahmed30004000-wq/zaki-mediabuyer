import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { METRICS, addCounts, countRepo, countSource, emptyCounts, overBaseline, type Counts } from "../scripts/ui-rules";

const root = path.resolve(__dirname, "..");
const none = (over: Partial<Counts> = {}): Counts => ({ ...emptyCounts(), ...over });

describe("what the ratchet counts", () => {
  it("raw buttons — and not <Button>", () => {
    expect(countSource('<button type="button">a</button><Button>b</Button><button\n  onClick={x}>', "x.tsx").rawButtons).toBe(2);
  });

  it("text sizes outside the scale of five, and arbitrary pixel sizes", () => {
    const c = countSource('className="text-lg md:text-2xl text-[11px] text-sm text-xs text-base text-xl text-3xl text-fg text-4xl"', "x.tsx");
    expect(c.offScaleText).toBe(3);
    expect(c.arbitraryText).toBe(1);
  });

  it("heights that are not 32, 40 or 48", () => {
    const c = countSource('"min-h-9 h-11 min-h-12 min-h-8 min-h-14 h-9"   "h-8 h-10 h-12 min-h-10 min-h-dvh size-9 h-90 sm:h-9"', "x.tsx");
    expect(c.offScaleHeights).toBe(7);
  });

  it("hex colours, decoration imports, MOCK_MODE", () => {
    const src = `import { ThemeDecor } from "@/components/theme/theme-decor";\nimport { ThemePicker } from "@/components/theme/theme-picker";\nconst a = "#1B2A4A"; const b = "#fff"; if (process.env.MOCK_MODE === "1") {}`;
    const c = countSource(src, "x.tsx");
    expect(c).toMatchObject({ hexColors: 1, decorImports: 1, mockChecks: 1 });
  });

  it("jargon: only inside Arabic UI text — not in code, comments or English-only strings", () => {
    const ui = [
      'const a = "شغّل ورك فلو جديد";', // counts
      "<p>خطوة جديدة</p>", // counts (JSX text)
      'const b = "workflow";', // English only: not UI text
      "// ورك فلو بالتعليق", // comment
      'const c = { handoff: "x", label: "مهمة" };', // identifier + innocent Arabic: not counted
      'toast("انطلب من Claude عبر MCP")', // counts
    ].join("\n");
    expect(countSource(ui, "x.tsx").jargon).toBe(3);
    expect(countSource('const a = "ورك فلو";', "src/app/(app)/settings/advanced/page.tsx").jargon).toBe(0);
  });

  it("adds counts and says which metric went up", () => {
    expect(addCounts(none({ rawButtons: 2 }), none({ rawButtons: 3, jargon: 1 }))).toMatchObject({ rawButtons: 5, jargon: 1 });
    expect(overBaseline(none({ rawButtons: 5, jargon: 1 }), { rawButtons: 5, jargon: 0 })).toEqual([{ metric: "jargon", now: 1, allowed: 0 }]);
    expect(overBaseline(none({ rawButtons: 4 }), { rawButtons: 5 })).toEqual([]);
  });
});

describe("the ratchet: a number only goes down", () => {
  const baseline = JSON.parse(readFileSync(path.join(root, "tests/ui-rules.baseline.json"), "utf8")) as Partial<Counts>;
  const { total } = countRepo(root);

  it("the baseline names every metric", () => {
    expect(Object.keys(baseline).sort()).toEqual([...METRICS].sort());
  });

  it("no rule got worse than the baseline (fix the code — never raise the baseline; `npm run ui:baseline -- --where` lists the files)", () => {
    expect(overBaseline(total, baseline)).toEqual([]);
  });

  it("the kit itself is not counted (it is where the allowed raw elements live)", () => {
    const { byFile } = countRepo(root);
    expect(Object.keys(byFile).some((f) => f.startsWith("src/components/ui/"))).toBe(false);
  });
});
