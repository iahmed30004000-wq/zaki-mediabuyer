import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LightStrip } from "@/components/ui/light-strip";
import { Lamp } from "@/components/ui/lamp";
import { RunSteps } from "@/components/ui/run-steps";
import { StateWord } from "@/components/ui/state-word";
import type { StripStep } from "@/core/light-strip";
import type { Lamp as LampState } from "@/core/run-state";

const steps = (...lamps: LampState[]): StripStep[] => lamps.map((lamp, i) => ({ id: `s${i + 1}`, lamp }));
const html = (steps_: StripStep[], label?: string) => renderToStaticMarkup(createElement(LightStrip, { steps: steps_, ...(label ? { label } : {}) }));
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
// a lamp is a rounded span with a size class; a diode is an <i>
const lamps = (s: string) => count(s, /<span[^>]*rounded-full[^>]*size-/g);
const diodes = (s: string) => count(s, /<i /g);

describe("the light strip as drawn", () => {
  it("one lamp per step and three diodes between two lamps", () => {
    const out = html(steps("done", "done", "run", "off"));
    expect(lamps(out)).toBe(4);
    expect(diodes(out)).toBe(3 * 3);
  });

  it("its accessible text is the run's sentence, and the strip is one image for a screen reader", () => {
    const out = html(steps("done", "run", "off"), "هلق عند الخطوة 2 من 3 — تكبير +20%");
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="هلق عند الخطوة 2 من 3 — تكبير +20%"');
  });

  it("without a sentence it counts its own lamps", () => {
    expect(html(steps("done", "done", "run"))).toContain('aria-label="3 خطوات: 2 خلصت، 1 شغّالة"');
  });

  it("the running step's diodes chase (animated) and its lamp breathes; a finished one is still", () => {
    const out = html(steps("done", "run", "off"));
    expect(out).toContain("animate-chase");
    expect(out).toContain("animate-breathe");
    expect(out).toContain("motion-reduce:animate-none");
    expect(html(steps("done", "done"))).not.toContain("animate-");
  });

  it("an inferred step is green without a halo", () => {
    const inferred = renderToStaticMarkup(createElement(LightStrip, { steps: [{ id: "a", lamp: "done", inferred: true }, { id: "b", lamp: "done", inferred: true }] }));
    expect(inferred).toContain("bg-ok");
    expect(inferred).not.toContain("shadow-lamp-ok");
    expect(inferred).not.toContain("shadow-diode-ok");
    expect(html(steps("done", "done"))).toContain("shadow-lamp-ok");
  });

  it("past 12 steps the phone gets a folded strip (and the wide screen the full one); up to 12 there is only one", () => {
    const twelve = html(steps(...Array.from({ length: 12 }, (): LampState => "done")));
    expect(twelve).not.toContain("md:hidden");
    const many = html(steps(...Array.from({ length: 15 }, (_, i): LampState => (i < 9 ? "done" : i === 9 ? "run" : "off"))));
    expect(many).toContain("md:hidden");
    expect(many).toContain("hidden md:block");
    // the folded one writes the count (9 finished steps) on its stretch
    expect(many).toMatch(/tabular-nums[^>]*>9</);
    // still one image with one sentence
    expect(count(many, /role="img"/g)).toBe(1);
  });

  it("no steps, no strip", () => {
    expect(html([])).toBe("");
  });
});

describe("a lamp and its word", () => {
  it("a lamp alone is hidden from a screen reader unless it is given a label", () => {
    expect(renderToStaticMarkup(createElement(Lamp, { state: "done" }))).toContain('aria-hidden="true"');
    const named = renderToStaticMarkup(createElement(Lamp, { state: "wait", label: "بدها موافقتك" }));
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="بدها موافقتك"');
  });

  it("the unlit lamp is quiet, the missed one is a dotted ring, the one that needs you blinks", () => {
    expect(renderToStaticMarkup(createElement(Lamp, { state: "off" }))).toContain("bg-muted");
    expect(renderToStaticMarkup(createElement(Lamp, { state: "missed" }))).toContain("border-dashed");
    expect(renderToStaticMarkup(createElement(Lamp, { state: "wait" }))).toContain("animate-blink");
  });

  it("a state word is the lamp and the word, in one colour", () => {
    const out = renderToStaticMarkup(createElement(StateWord, { state: "approval" }));
    expect(out).toContain("بدها موافقتك");
    expect(out).toContain("text-warn");
    expect(out).toContain("bg-warn");
    expect(renderToStaticMarkup(createElement(StateWord, { state: "queued", who: "Claude الرئيسي" }))).toContain("بانتظار Claude الرئيسي");
  });
});

describe("the vertical rope", () => {
  const rows = [
    { id: "a", lamp: "done" as const, title: "اقرا المخزون", n: 1, time: "09:00" },
    { id: "b", lamp: "fail" as const, title: "كبّر الإعلان", n: 2, error: "ما قدرنا نقرا المخزون" },
    { id: "c", lamp: "off" as const, title: "ابعت التقرير", n: 3 },
  ];
  it("a lamp for every step, tape under all but the last, and the error in words", () => {
    const out = renderToStaticMarkup(createElement(RunSteps, { steps: rows, label: "وقفت عند 2" }));
    expect(count(out, /<li /g)).toBe(3);
    expect(count(out, /bg-tape/g)).toBe(2);
    expect(out).toContain('aria-label="وقفت عند 2"');
    expect(out).toContain("ما قدرنا نقرا المخزون");
    expect(out).toContain("09:00");
  });
});
