/**
 * The home as decisions (v6 · P5, docs/rebuild-v6/02-screens.md §2): which sections each role is given, where «كل الأرقام» leads it, and the order of «بدّها منك» — the decisions first, then the
 * runs that stopped or were missed, then the alerts — the first three shown, the rest counted. Pure.
 */
import { describe, expect, it } from "vitest";
import { NEEDS_SHOWN, asksSomething, homePlan, needsOf } from "@/core/home";
import { ROLES, hasHome } from "@/core/roles";

describe("homePlan — a role is given only the sections whose screens it may open", () => {
  it("the owner and the manager get everything; «كل الأرقام» leads to the operations screens until /numbers is built", () => {
    for (const role of ["OWNER", "MANAGER"] as const) expect(homePlan(role)).toEqual({ decisions: true, tasks: true, numbers: true, numbersHref: "/ops" });
  });

  it("the ads manager has no operations place: «كل الأرقام» leads to the ads; the ops manager to the operations", () => {
    expect(homePlan("ADS_MANAGER")).toEqual({ decisions: true, tasks: true, numbers: true, numbersHref: "/ads" });
    expect(homePlan("OPS_MANAGER")).toEqual({ decisions: true, tasks: true, numbers: true, numbersHref: "/ops" });
  });

  it("an analyst reads the tasks and the numbers but has no inbox; a viewer has neither the tasks place nor the inbox", () => {
    expect(homePlan("ANALYST")).toEqual({ decisions: false, tasks: true, numbers: true, numbersHref: "/ads" });
    expect(homePlan("VIEWER")).toEqual({ decisions: false, tasks: false, numbers: true, numbersHref: "/ops" });
  });

  it("a role that has a home always has somewhere for «كل الأرقام» to lead", () => {
    for (const role of ROLES.filter(hasHome)) expect(homePlan(role).numbersHref, role).not.toBeNull();
  });
});

describe("what asks something of him", () => {
  it("a red or orange alert does; an informational one goes to the bell and is not counted", () => {
    expect(asksSomething({ tone: "danger" })).toBe(true);
    expect(asksSomething({ tone: "warn" })).toBe(true);
    expect(asksSomething({ tone: "info" })).toBe(false);
  });
});

describe("needsOf — one list: decisions, then stopped runs, then alerts", () => {
  const d = (n: number) => Array.from({ length: n }, (_, i) => `d${i + 1}`);
  const s = (n: number) => Array.from({ length: n }, (_, i) => `s${i + 1}`);
  const a = (n: number) => Array.from({ length: n }, (_, i) => `a${i + 1}`);

  it("the first three are shown in that order, and the number beside the title is everything that waits", () => {
    expect(NEEDS_SHOWN).toBe(3);
    const n = needsOf({ decisions: d(2), stuck: s(2), alerts: a(2) });
    expect(n.total).toBe(6);
    expect(n.shown.map((x) => x.item)).toEqual(["d1", "d2", "s1"]);
    expect(n.counts).toEqual({ decisions: 2, stuck: 2, alerts: 2 });
    expect(n.left).toEqual({ decisions: 0, stuck: 1, alerts: 2 });
  });

  it("with more decisions than three, the stopped runs and the alerts are all behind the links", () => {
    const n = needsOf({ decisions: d(5), stuck: s(1), alerts: a(1) });
    expect(n.shown.map((x) => x.kind)).toEqual(["decision", "decision", "decision"]);
    expect(n.left).toEqual({ decisions: 2, stuck: 1, alerts: 1 });
  });

  it("no decision: the stopped runs lead, then the alerts", () => {
    const n = needsOf({ decisions: [], stuck: s(1), alerts: a(5) });
    expect(n.shown.map((x) => x.item)).toEqual(["s1", "a1", "a2"]);
    expect(n.left).toEqual({ decisions: 0, stuck: 0, alerts: 3 });
  });

  it("nothing waits: total zero, nothing shown (the home says «ما في شي بدّه منك ✓»)", () => {
    const n = needsOf({ decisions: [], stuck: [], alerts: [] });
    expect(n).toMatchObject({ total: 0, shown: [], counts: { decisions: 0, stuck: 0, alerts: 0 }, left: { decisions: 0, stuck: 0, alerts: 0 } });
  });

  it("the limit can be changed, and never below zero", () => {
    expect(needsOf({ decisions: d(5), stuck: [], alerts: [] }, 1).shown).toHaveLength(1);
    expect(needsOf({ decisions: d(5), stuck: [], alerts: [] }, -2).shown).toHaveLength(0);
  });
});
