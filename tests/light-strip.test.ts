import { describe, expect, it } from "vitest";
import { STRIP_FOLD_OVER, needsFold, ropeMove, stretchAfter, stripItems, stripSummary, type StripStep } from "@/core/light-strip";
import type { Lamp } from "@/core/run-state";

const steps = (...lamps: Lamp[]): StripStep[] => lamps.map((lamp, i) => ({ id: `s${i + 1}`, lamp }));
const kinds = (items: ReturnType<typeof stripItems>) => items.map((i) => i.kind);

describe("the light strip: lamps and stretches", () => {
  it("one lamp for every step, and a stretch between two lamps", () => {
    const items = stripItems(steps("done", "done", "run", "off", "off"));
    expect(items.filter((i) => i.kind === "lamp")).toHaveLength(5);
    expect(items.filter((i) => i.kind === "stretch")).toHaveLength(4);
    expect(kinds(items)).toEqual(["lamp", "stretch", "lamp", "stretch", "lamp", "stretch", "lamp", "stretch", "lamp"]);
  });

  it("one step is one lamp and no stretch; no steps is nothing", () => {
    expect(kinds(stripItems(steps("run")))).toEqual(["lamp"]);
    expect(stripItems([])).toEqual([]);
  });

  it("the stretch behind a finished step glows green; behind the running step the diodes chase; behind anything else it is dark", () => {
    expect(stretchAfter({ lamp: "done" })).toEqual({ lit: true, chase: false, glow: true });
    expect(stretchAfter({ lamp: "run" })).toEqual({ lit: false, chase: true, glow: false });
    for (const l of ["off", "wait", "fail", "missed"] as const) expect(stretchAfter({ lamp: l })).toEqual({ lit: false, chase: false, glow: false });
    const items = stripItems(steps("done", "run", "off"));
    expect(items[1]).toMatchObject({ kind: "stretch", lit: true, chase: false });
    expect(items[3]).toMatchObject({ kind: "stretch", lit: false, chase: true });
  });

  it("a step the site only inferred is green without a halo — the strip never guesses", () => {
    const inferred: StripStep[] = [
      { id: "a", lamp: "done", inferred: true },
      { id: "b", lamp: "done", inferred: true },
    ];
    const items = stripItems(inferred);
    expect(items[0]).toMatchObject({ kind: "lamp", lamp: "done", glow: false });
    expect(items[1]).toMatchObject({ kind: "stretch", lit: true, glow: false });
    expect(stripItems(steps("done"))[0]).toMatchObject({ glow: true });
  });

  it("the label of a step is carried to its lamp", () => {
    expect(stripItems([{ id: "a", lamp: "run", label: "اقرا المخزون" }])[0]).toMatchObject({ label: "اقرا المخزون" });
  });
});

describe("the light strip: more than 12 steps on a phone", () => {
  const many = (n: number, done: number): StripStep[] => steps(...Array.from({ length: n }, (_, i): Lamp => (i < done ? "done" : i === done ? "run" : "off")));

  it("the limit is 12: up to 12 it is never folded, past 12 the strip asks for the folded version", () => {
    expect(STRIP_FOLD_OVER).toBe(12);
    expect(needsFold(many(12, 5))).toBe(false);
    expect(needsFold(many(13, 5))).toBe(true);
  });

  it("finished steps in a row fold into ONE stretch with their count", () => {
    const items = stripItems(many(15, 9), { fold: true });
    // 9 finished → one fold; the running step and the 5 waiting ones keep their own lamps
    expect(items[0]).toEqual({ kind: "fold", count: 9, glow: true });
    expect(items.filter((i) => i.kind === "fold")).toHaveLength(1);
    expect(items.filter((i) => i.kind === "lamp")).toHaveLength(6);
    // the stretch that follows the fold is lit (it is behind a finished step)
    expect(items[1]).toMatchObject({ kind: "stretch", lit: true });
    // fewer things to draw than the full strip
    expect(items.length).toBeLessThan(stripItems(many(15, 9)).length);
  });

  it("one finished step alone is not folded; two in a row are", () => {
    expect(kinds(stripItems(steps("done", "run", "off"), { fold: true }))).toEqual(["lamp", "stretch", "lamp", "stretch", "lamp"]);
    expect(kinds(stripItems(steps("done", "done", "run"), { fold: true }))).toEqual(["fold", "stretch", "lamp"]);
  });

  it("a run that is all finished folds to one item with every step counted; folding never loses a lamp", () => {
    const all = stripItems(many(14, 14), { fold: true });
    expect(all).toEqual([{ kind: "fold", count: 14, glow: true }]);
    const mixed = stripItems(steps("done", "done", "wait", "done", "done", "done", "fail"), { fold: true });
    const stood = mixed.reduce((n, i) => n + (i.kind === "fold" ? i.count : i.kind === "lamp" ? 1 : 0), 0);
    expect(stood).toBe(7);
  });

  it("a folded run that holds an inferred step has no halo", () => {
    const s: StripStep[] = [
      { id: "a", lamp: "done" },
      { id: "b", lamp: "done", inferred: true },
    ];
    expect(stripItems(s, { fold: true })[0]).toEqual({ kind: "fold", count: 2, glow: false });
  });
});

describe("the strip's own sentence (when the run has none)", () => {
  it("counts what each lamp says", () => {
    expect(stripSummary(steps("done", "done", "done", "run", "off"))).toBe("5 خطوات: 3 خلصت، 1 شغّالة");
    expect(stripSummary(steps("fail"))).toBe("1 خطوات: 1 وقفت");
    expect(stripSummary(steps("off", "off"))).toBe("2 خطوات");
    expect(stripSummary([])).toBe("ما في خطوات");
  });
});

describe("the playground of the rope (/dev/kit)", () => {
  const off: Lamp[] = ["off", "off", "off"];

  it("the first press starts the first step; each press after finishes the running one and starts the next", () => {
    const a = ropeMove(off, "next");
    expect(a).toEqual(["run", "off", "off"]);
    const b = ropeMove(a, "next");
    expect(b).toEqual(["done", "run", "off"]);
    const c = ropeMove(ropeMove(b, "next"), "next");
    expect(c).toEqual(["done", "done", "done"]);
    // a finished run stays finished
    expect(ropeMove(c, "next")).toEqual(c);
  });

  it("hold makes the running step wait for the owner, and the next press lets it go on", () => {
    const held = ropeMove(["done", "run", "off"], "hold");
    expect(held).toEqual(["done", "wait", "off"]);
    expect(ropeMove(held, "next")).toEqual(["done", "done", "run"]);
    // nothing running: nothing to hold
    expect(ropeMove(off, "hold")).toEqual(off);
  });

  it("fail stops the running step, and a failed run goes no further until it is reset", () => {
    const failed = ropeMove(["done", "run", "off"], "fail");
    expect(failed).toEqual(["done", "fail", "off"]);
    expect(ropeMove(failed, "next")).toEqual(failed);
    expect(ropeMove(failed, "reset")).toEqual(off);
    expect(ropeMove(off, "fail")).toEqual(off);
  });

  it("never changes the list it was given", () => {
    const start: Lamp[] = ["run", "off"];
    ropeMove(start, "next");
    expect(start).toEqual(["run", "off"]);
  });
});
