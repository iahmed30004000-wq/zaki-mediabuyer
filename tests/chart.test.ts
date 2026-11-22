import { describe, expect, it } from "vitest";
import { areaOf, extent, isDrawable, lastN, linePoints, niceTicks, pathOf, scaleLinear } from "@/core/chart";

describe("scaleLinear", () => {
  it("maps the domain onto the range, end to end and in between", () => {
    const f = scaleLinear([0, 10], [0, 100]);
    expect(f(0)).toBe(0);
    expect(f(10)).toBe(100);
    expect(f(2.5)).toBe(25);
  });

  it("runs backwards when the range does (a screen's y grows downwards)", () => {
    const y = scaleLinear([0, 100], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(100)).toBe(0);
    expect(y(50)).toBe(100);
  });

  it("does not extrapolate wildly nor divide by zero: a flat domain maps to the middle", () => {
    const f = scaleLinear([5, 5], [0, 40]);
    expect(f(5)).toBe(20);
    expect(f(999)).toBe(20);
  });
});

describe("extent and isDrawable", () => {
  it("a gap is not a zero", () => {
    expect(isDrawable(0)).toBe(true);
    expect(isDrawable(null)).toBe(false);
    expect(isDrawable(undefined)).toBe(false);
    expect(isDrawable(Number.NaN)).toBe(false);
    expect(isDrawable(Infinity)).toBe(false);
    expect(extent([null, 3, undefined, 1, 7, Number.NaN])).toEqual([1, 7]);
    expect(extent([null, undefined])).toBeNull();
    expect(extent([])).toBeNull();
  });
});

describe("linePoints", () => {
  it("puts the oldest value at the right edge and today at the left (an Arabic page)", () => {
    const { runs } = linePoints([10, 20, 30], { width: 200, height: 100 });
    const [a, b, c] = runs[0]!;
    expect(a!.x).toBe(200);
    expect(c!.x).toBe(0);
    expect(b!.x).toBe(100);
    // a higher value is higher on the screen (a smaller y)
    expect(c!.y).toBeLessThan(a!.y);
    expect(a!.y).toBe(100);
    expect(c!.y).toBe(0);
  });

  it("can be drawn the other way round (rtl: false)", () => {
    const { runs } = linePoints([1, 2], { width: 100, height: 10, rtl: false });
    expect(runs[0]![0]!.x).toBe(0);
    expect(runs[0]![1]!.x).toBe(100);
  });

  it("keeps the padding free: space at the start (the right) and the end (the left), at the top and the bottom", () => {
    const { runs } = linePoints([0, 10], { width: 300, height: 100, padX: { start: 50, end: 10 }, padY: { top: 8, bottom: 20 } });
    const [oldest, today] = runs[0]!;
    expect(oldest!.x).toBe(250);
    expect(today!.x).toBe(10);
    expect(oldest!.y).toBe(80);
    expect(today!.y).toBe(8);
  });

  it("a day with no number splits the line: two days are never joined across a gap, and a gap is never a zero", () => {
    const { runs } = linePoints([5, 6, null, 8, 9], { width: 100, height: 50 });
    expect(runs).toHaveLength(2);
    expect(runs[0]!.map((p) => p.i)).toEqual([0, 1]);
    expect(runs[1]!.map((p) => p.i)).toEqual([3, 4]);
    expect(runs.flat().some((p) => p.v === 0)).toBe(false);
  });

  it("a domain that is given stretches the axis (a break-even line outside the series stays on the picture)", () => {
    const own = linePoints([10, 12], { width: 100, height: 100 });
    const stretched = linePoints([10, 12], { width: 100, height: 100, domain: [0, 20] });
    expect(own.domain).toEqual([10, 12]);
    expect(stretched.domain).toEqual([0, 20]);
    // 20 is the top, 0 the bottom
    expect(stretched.yOf(20)).toBe(0);
    expect(stretched.yOf(0)).toBe(100);
    // a series that goes outside the given domain widens it instead of being cut
    expect(linePoints([-5, 30], { width: 100, height: 100, domain: [0, 20] }).domain).toEqual([-5, 30]);
  });

  it("one value sits in the middle; no value draws no run", () => {
    expect(linePoints([4], { width: 100, height: 10 }).runs[0]![0]!.x).toBe(50);
    expect(linePoints([null, null], { width: 100, height: 10 }).runs).toEqual([]);
    expect(linePoints([], { width: 100, height: 10 }).runs).toEqual([]);
  });

  it("xOf and yOf agree with the points", () => {
    const l = linePoints([1, 3, 2], { width: 120, height: 60, padX: 10, padY: 5 });
    for (const p of l.runs[0]!) {
      expect(p.x).toBe(Math.round(l.xOf(p.i) * 100) / 100);
      expect(p.y).toBe(Math.round(l.yOf(p.v) * 100) / 100);
    }
  });
});

describe("paths", () => {
  it("a line path is M then L, an area closes down to the baseline", () => {
    const run = [
      { x: 10, y: 5 },
      { x: 5, y: 8 },
      { x: 0, y: 2 },
    ];
    expect(pathOf(run)).toBe("M10 5 L5 8 L0 2");
    expect(pathOf([])).toBe("");
    expect(areaOf(run, 50)).toBe("M10 5 L5 8 L0 2 L0 50 L10 50 Z");
    expect(areaOf([run[0]!], 50)).toBe("");
  });
});

describe("niceTicks", () => {
  it("round numbers that cover the range, ascending", () => {
    expect(niceTicks(0, 100, 4)).toEqual([0, 50, 100]);
    expect(niceTicks(3, 47, 5)).toEqual([0, 20, 40, 60]);
    const t = niceTicks(4.2, 9.1, 4);
    expect(t[0]!).toBeLessThanOrEqual(4.2);
    expect(t[t.length - 1]!).toBeGreaterThanOrEqual(9.1);
    expect([...t].sort((a, b) => a - b)).toEqual(t);
  });

  it("small fractions come out clean, without floating-point dust", () => {
    expect(niceTicks(0, 0.5, 6)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
    for (const v of niceTicks(0.1, 0.9, 5)) expect(String(v).length).toBeLessThan(6);
  });

  it("negative ranges and a range that crosses zero", () => {
    const t = niceTicks(-30, 70, 5);
    expect(t).toContain(0);
    expect(t[0]!).toBeLessThanOrEqual(-30);
    expect(t[t.length - 1]!).toBeGreaterThanOrEqual(70);
  });

  it("a flat range still gets a scale; the arguments may come in either order; rubbish gives nothing", () => {
    expect(niceTicks(5, 5).length).toBeGreaterThanOrEqual(2);
    expect(niceTicks(0, 0).length).toBeGreaterThanOrEqual(2);
    expect(niceTicks(100, 0, 4)).toEqual(niceTicks(0, 100, 4));
    expect(niceTicks(Number.NaN, 4)).toEqual([]);
  });
});

describe("lastN", () => {
  it("keeps the last n in order, and everything when there are fewer", () => {
    expect(lastN([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5]);
    expect(lastN([1, 2], 14)).toEqual([1, 2]);
    expect(lastN([], 14)).toEqual([]);
  });
});
