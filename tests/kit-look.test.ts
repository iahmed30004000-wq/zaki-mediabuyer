import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import config from "../tailwind.config";
import { AgentChip } from "@/components/ui/agent-chip";
import { BackLink } from "@/components/ui/back-link";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { ChoiceTile } from "@/components/ui/choice-tile";
import { Chip } from "@/components/ui/chip";
import { DayBoard } from "@/components/ui/day-board";
import { Delta } from "@/components/ui/delta";
import { IconButton } from "@/components/ui/icon-button";
import { JobNumber } from "@/components/ui/job-number";
import { Pill } from "@/components/ui/pill";
import { PushPreview } from "@/components/ui/push-preview";
import { ReadinessCard } from "@/components/ui/readiness-card";
import { ReportBody } from "@/components/ui/report-body";
import { Sparkline } from "@/components/ui/sparkline";
import { StepBlock, StepJoint } from "@/components/ui/step-block";
import { Switch } from "@/components/ui/switch";
import { TrendChart } from "@/components/ui/trend-chart";
import { WasNow } from "@/components/ui/was-now";

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const root = path.resolve(__dirname, "..");

describe("the six sizes of text (03-look §3)", () => {
  const sizes = (config.theme as { fontSize: Record<string, [string, string]> }).fontSize;
  it("xs 12/18 · sm 14/22 · base 16/26 · lg 20/28 · xl 24/32 · 3xl 36/40 — and nothing else exists", () => {
    expect(sizes).toEqual({
      xs: ["12px", "18px"],
      sm: ["14px", "22px"],
      base: ["16px", "26px"],
      lg: ["20px", "28px"],
      xl: ["24px", "32px"],
      "3xl": ["36px", "40px"],
    });
  });

  it("the faces are IBM Plex Sans Arabic for the text and Changa for the display, and no mono face is added", () => {
    const fam = (config.theme as { extend: { fontFamily: Record<string, string[]> } }).extend.fontFamily;
    expect(fam.sans![0]).toBe("var(--font-plex)");
    expect(fam.display![0]).toBe("var(--font-display)");
    expect(Object.keys(fam)).not.toContain("mono");
  });

  it("the layout loads Changa (500 · 700 · 800) and IBM Plex Sans Arabic (400 · 500 · 600 · 700), and no longer Cairo", () => {
    const layout = readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");
    expect(layout).toMatch(/Changa\(\{[\s\S]*?weight: \["500", "700", "800"\]/);
    expect(layout).toMatch(/IBM_Plex_Sans_Arabic\(\{[\s\S]*?weight: \["400", "500", "600", "700"\]/);
    expect(layout).not.toMatch(/Cairo/);
  });
});

describe("the keys (03-look §5)", () => {
  const cls = (o: Parameters<typeof buttonVariants>[0]) => buttonVariants(o);

  it("sizes 52 · 48 · 40 — never a button under 40 (a phone makes the small one 44)", () => {
    expect(cls({ size: "lg" })).toContain("h-13");
    expect(cls({ size: "md" })).toContain("h-12");
    expect(cls({ size: "sm" })).toContain("h-10");
    expect(cls({ size: "sm" })).toContain("max-md:h-11");
    for (const s of ["lg", "md", "sm"] as const) expect(cls({ size: s })).not.toMatch(/(?<![\w-])h-(8|9)(?![\w-])/);
    expect((config.theme as { extend: { spacing: Record<string, string> } }).extend.spacing["13"]).toBe("3.25rem");
  });

  it("primary is an ink key with an edge that goes down when pressed; secondary has a line edge; ghost is underlined; danger is an outline", () => {
    expect(cls({ variant: "primary" })).toMatch(/bg-accent text-accent-fg shadow-key active:shadow-key-down/);
    expect(cls({ variant: "secondary" })).toMatch(/border-border bg-surface-1 .*shadow-key-line/);
    expect(cls({ variant: "ghost" })).toContain("underline");
    const danger = cls({ variant: "danger" });
    expect(danger).toContain("border-danger");
    expect(danger).toContain("text-danger");
    expect(danger).not.toMatch(/(^|\s)bg-danger(\s|$)/);
    expect(cls({})).toContain("active:translate-y-0.5");
  });

  it("the property names did not change: variant, size, block", () => {
    expect(cls({ block: true })).toContain("w-full");
    expect(render(h(Button, { variant: "secondary", size: "sm", block: true }, "x"))).toContain("w-full");
  });

  it("the red fill is only the last confirm of a stop, never a plain danger button", () => {
    const plain = render(h(Button, { variant: "danger" }, "اوقف"));
    expect(plain).not.toMatch(/(^|[\s"])bg-danger([\s"])/);
    expect(plain).toContain("text-danger");
  });

  it("an icon button is 44×44 and needs a name for a screen reader", () => {
    const out = render(h(IconButton, { "aria-label": "الإعدادات", children: "x" }));
    expect(out).toContain("size-11");
    expect(out).toContain('aria-label="الإعدادات"');
    expect(out).not.toMatch(/(?<![\w-])size-(9|10)(?![\w-])/);
  });

  it("a switch is green when on, and is a 44px target", () => {
    const on = render(h(Switch, { checked: true, onCheckedChange: () => {}, label: "مفعّلة" }));
    expect(on).toContain("bg-ok");
    expect(on).toContain("h-11");
    expect(render(h(Switch, { checked: false, onCheckedChange: () => {}, label: "مطفية" }))).toContain("bg-muted");
  });

  it("a choice tile is at least 68 high and says whether it is the chosen one", () => {
    const chosen = render(h(ChoiceTile, { title: "كل يوم", hint: "الساعة 6", pressed: true }));
    expect(chosen).toContain("min-h-[68px]");
    expect(chosen).toContain('aria-pressed="true"');
    expect(chosen).toContain("bg-accent");
    expect(render(h(ChoiceTile, { title: "كل أسبوع" }))).toContain('aria-pressed="false"');
  });
});

describe("badges and tags", () => {
  it("a pill and a chip are rounded all the way and 12px — a badge, never a sentence", () => {
    expect(render(h(Pill, { tone: "ok", children: "خلصت" }))).toMatch(/rounded-full[^"]*text-xs|text-xs[^"]*rounded-full/);
    expect(render(h(Chip, { children: "خطوة 1" }))).toContain("rounded-full");
    expect(render(h(Chip, { off: true, children: "x" }))).toContain("line-through");
  });
});

describe("the numbers kit", () => {
  it("Delta says the difference in words, in a state colour: green good · red bad · grey flat", () => {
    expect(render(h(Delta, { words: "أرخص 13%", tone: "good" }))).toMatch(/أرخص 13%/);
    expect(render(h(Delta, { words: "أرخص 13%", tone: "good" }))).toContain("text-ok");
    expect(render(h(Delta, { words: "أغلى 8%", tone: "bad" }))).toContain("text-danger");
    expect(render(h(Delta, { words: "متل ما هو", tone: "flat" }))).toContain("text-fg-muted");
  });

  it("Sparkline draws the last 14 values as a line and a fill, and nothing when there is nothing to join", () => {
    const out = render(h(Sparkline, { values: Array.from({ length: 30 }, (_, i) => i) }));
    expect(count(out, /<path /g)).toBe(2);
    // only the last 14 points: 13 segments after the first M
    const line = [...out.matchAll(/d="([^"]*)"/g)][1]![1]!;
    expect(count(line, /L/g)).toBe(13);
    expect(render(h(Sparkline, { values: [] }))).toBe("");
    expect(render(h(Sparkline, { values: [5] }))).toBe("");
    expect(render(h(Sparkline, { values: [5, null, 6] }))).toBe("");
    // a gap splits the line in two pieces, each with its own fill
    expect(count(render(h(Sparkline, { values: [1, 2, null, 4, 5] })), /<path /g)).toBe(4);
    expect(render(h(Sparkline, { values: [1, 2, 3] }))).toContain('aria-hidden="true"');
    expect(render(h(Sparkline, { values: [1, 2, 3], label: "آخر 14 يوم" }))).toContain('aria-label="آخر 14 يوم"');
  });

  it("WasNow: the number now, «كنا», the delta and the line — and a missing number says why, with no picture", () => {
    const full = render(h(WasNow, { label: "التكلفة", now: 5.2, was: 6, unit: "$", delta: { words: "أرخص 13%", tone: "good" }, series: [1, 2, 3] }));
    expect(full).toContain("5.20$");
    expect(full).toContain("كنا");
    expect(full).toContain("6.00$");
    expect(full).toContain("أرخص 13%");
    expect(full).toContain("<svg");
    const missing = render(h(WasNow, { label: "التكلفة", now: null, was: null, unit: "$", missing: "ميتا مش مربوطة", delta: { words: "أرخص 13%", tone: "good" }, series: [1, 2, 3] }));
    expect(missing).toContain("—");
    expect(missing).toContain("ميتا مش مربوطة");
    expect(missing).not.toContain("<svg");
    expect(missing).not.toContain("أرخص");
    expect(missing).not.toContain("كنا");
  });

  it("TrendChart: the line, the break-even line (dashed), the target line (dotted), numbered events, a bigger end point and a list under it", () => {
    const values = Array.from({ length: 30 }, (_, i) => 10 - i / 5);
    const out = render(h(TrendChart, { values, unit: "$", breakEven: 9, target: 5, label: "التكلفة آخر 30 يوم", events: [{ index: 3, text: "كبّرنا 2" }, { index: 20, text: "وقّفنا 1" }] }));
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="التكلفة آخر 30 يوم"');
    expect(out).toContain('stroke-dasharray="6 5"');
    expect(out).toContain('stroke-dasharray="2 5"');
    expect(out).toContain("نقطة التعادل");
    expect(out).toContain("الهدف");
    expect(out).toContain("<circle");
    // two numbered events, the end point, and the list of what we did
    expect(count(out, /<circle /g)).toBe(3);
    expect(out).toContain("كبّرنا 2");
    expect(out).toContain("وقّفنا 1");
    // no data to draw: a sentence, not an empty frame
    expect(render(h(TrendChart, { values: [null, 3, null], label: "x" }))).toContain("ما في أرقام كفاية");
  });
});

describe("the day, the steps, the team", () => {
  it("DayBoard: a line per job with the clock, who carries it and its state word; a past line is quiet", () => {
    const out = render(
      h(DayBoard, {
        label: "جدول اليوم",
        rows: [
          { id: "a", time: "06:00", title: "جولة الليل", who: "Claude الرئيسي", state: "done", past: true },
          { id: "b", time: "15:00", title: "فحص الفيديوهات", who: "Claude الرئيسي", state: "queued" },
        ],
      }),
    );
    expect(count(out, /<li /g)).toBe(2);
    expect(out).toContain("06:00");
    expect(out).toContain("خلصت");
    expect(out).toContain("بانتظار Claude الرئيسي");
    expect(out).toContain("text-fg-muted");
    expect(out).toContain('aria-label="جدول اليوم"');
    expect(out).toContain("text-lg"); // the clock is 20
  });

  it("StepBlock: a button only for what it can do, each named in Arabic and 44 wide; the joint is only decoration", () => {
    const all = render(h(StepBlock, { n: 2, kind: "اقرا المخزون", onUp: () => {}, onDown: () => {}, onRemove: () => {} }, "نص"));
    expect(count(all, /<button /g)).toBe(3);
    expect(all).toContain('aria-label="قدّم الخطوة 2"');
    expect(all).toContain('aria-label="أخّر الخطوة 2"');
    expect(all).toContain('aria-label="احذف الخطوة 2"');
    const first = render(h(StepBlock, { n: 1, kind: "اقرا", onDown: () => {}, onRemove: () => {} }));
    expect(count(first, /<button /g)).toBe(2);
    expect(first).not.toContain("قدّم");
    expect(render(h(StepJoint, {}))).toContain('aria-hidden="true"');
  });

  it("AgentChip: the name and what he is doing", () => {
    const out = render(h(AgentChip, { name: "Claude الرئيسي", doing: "عم يقرا المخزون", state: "run" }));
    expect(out).toContain("Claude الرئيسي");
    expect(out).toContain("عم يقرا المخزون");
    expect(out).toContain("bg-info");
  });
});

describe("the readiness card, the report, the notification", () => {
  it("ReadinessCard: a button only for a missing item, and nothing at all for no rows", () => {
    const out = render(
      h(ReadinessCard, {
        rows: [
          { key: "spend", ok: false, text: "الصرف ناقص: ميتا مش مربوطة", action: { label: "اربط ميتا", href: "/settings/connections" } },
          { key: "orders", ok: true, text: "آخر سحب قبل ساعة", action: { label: "اسحب هلق", href: "/x" } },
        ],
      }),
    );
    expect(out).toContain("شو ناقص لتطلع الأرقام");
    expect(out).toContain("اربط ميتا");
    expect(out).toContain('href="/settings/connections"');
    expect(out).not.toContain("اسحب هلق");
    expect(render(h(ReadinessCard, { rows: [] }))).toBe("");
  });

  it("ReportBody: sentences and a table, never JSON; an empty report says so", () => {
    const out = render(h(ReportBody, { report: { scaled: 2, products: [{ name: "أ", orders: 3 }] }, labels: { scaled: "كبّرنا", products: "المنتجات", name: "المنتج", orders: "الطلبات" } }));
    expect(out).toContain("كبّرنا");
    expect(out).toContain("<table");
    expect(out).toContain("المنتجات");
    expect(out).not.toMatch(/[{}]|&quot;/);
    expect(render(h(ReportBody, { report: {} }))).toContain("ما في تفاصيل");
  });

  it("BackLink: the arrow points the right way in Arabic and turns round in a left-to-right page; no typed «←»", () => {
    const out = render(h(BackLink, { href: "/tasks" }));
    expect(out).toContain("ltr:rotate-180");
    expect(out).toContain("رجوع");
    expect(out).not.toContain("←");
    expect(out).toContain("min-h-11");
  });

  it("PushPreview: the title and the sentence as they ring on the phone", () => {
    const out = render(h(PushPreview, { title: "بدها موافقتك", body: "كبّر «منتج أ» 20%؟", time: "09:12" }));
    expect(out).toContain("بدها موافقتك");
    expect(out).toContain("كبّر «منتج أ» 20%؟");
    expect(out).toContain("09:12");
  });
});

describe("the identity: the gold is the logo and the job number, nowhere else", () => {
  it("both are written by value, in the navy and gold, with a night square on the dark page", () => {
    const mark = render(h(BrandMark, {}));
    expect(mark).toContain("#1B2A4A");
    expect(mark).toContain("#F2B705");
    expect(mark).toContain("#0B1220");
    const job = render(h(JobNumber, { n: 7 }));
    expect(job).toContain("#1B2A4A");
    expect(job).toContain("#F2B705");
    expect(job).toContain('aria-label="رقم 7"');
    expect(render(h(JobNumber, { n: null }))).toContain('aria-label="بلا رقم"');
  });

  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
    });

  it("no raw #RRGGBB outside the tokens file — except those two components and the contrast maths", () => {
    const allowed = new Set(["src/lib/themes/palettes.ts", "src/lib/themes/contrast.ts", "src/components/ui/job-number.tsx", "src/components/ui/brand-mark.tsx"]);
    const bad = files(path.join(root, "src"))
      .map((f) => path.relative(root, f).split(path.sep).join("/"))
      .filter((rel) => !allowed.has(rel) && /#[0-9A-Fa-f]{6}\b/.test(readFileSync(path.join(root, rel), "utf8")));
    expect(bad).toEqual([]);
  });

  it("the gold token (accent-2) is used by no screen: only the two identity components write the gold", () => {
    const bad = files(path.join(root, "src"))
      .map((f) => path.relative(root, f).split(path.sep).join("/"))
      .filter((rel) => !rel.startsWith("src/lib/themes/") && rel !== "src/components/dev/kit-showcase.tsx" /* the swatch of the token itself */ && /(?:bg|text|border|ring|fill|stroke|from|to|via)-accent-2/.test(readFileSync(path.join(root, rel), "utf8")));
    expect(bad).toEqual([]);
  });

  it("no mono face is left in the screens", () => {
    const bad = files(path.join(root, "src"))
      .filter((f) => /(?<![\w-])font-mono(?![\w-])/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(root, f));
    expect(bad).toEqual([]);
  });
});
