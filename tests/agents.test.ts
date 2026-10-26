import { describe, expect, it } from "vitest";
import { benchmarks, diagnose, STARTING_POINTS, type Funnel } from "@/core/diagnosis";
import { checkItems, kindOf } from "@/agents/preparer";

const f = (o: Partial<Funnel>): Funnel => ({ code: "TRF01", impressions: 20000, hooks: 6000, clicks: 240, lpv: 180, orders: 14, matureOrders: 12, confirmed: 8, shipments: 10, delivered: 8, returned: 2, ...o });

describe("M02 by code: the weakest funnel step (spec 11.4)", () => {
  it("a weak hook is named, with its sample", () => {
    const d = diagnose(f({ hooks: 2400 }), STARTING_POINTS);
    expect(d).toMatchObject({ weak_point: "hook", status: "weak" });
    expect(d.sample).toContain("20,000 ظهور");
  });
  it("too few impressions: «not enough», never a verdict", () => expect(diagnose(f({ impressions: 1200 }), STARTING_POINTS).status).toBe("not_enough"));
  it("a step with a small sample is not judged (10 shipments needed for returns)", () => {
    expect(diagnose(f({ shipments: 6, returned: 4 }), STARTING_POINTS).weak_point).not.toBe("return");
  });
  it("with 3+ products the account's own median replaces the starting points", () => {
    const b = benchmarks([f({ code: "A", hooks: 4000 }), f({ code: "B", hooks: 5000 }), f({ code: "C", hooks: 6000 })]);
    expect(b.hook).toBeCloseTo(0.25);
    expect(benchmarks([f({})]).hook).toBe(STARTING_POINTS.hook);
  });
});

describe("M04: the code checks what the agent prepared", () => {
  const db: Record<string, { metaId: string; status: string; dailyBudget: number | null }> = { AS1: { metaId: "AS1", status: "ACTIVE", dailyBudget: 40 }, CR00147: { metaId: "120211", status: "ACTIVE", dailyBudget: null } };
  const find = async (_: string, id: string) => db[id] ?? null;
  it("only pause/resume/budget, only real objects, ±50% at most, «before» from the database", async () => {
    const r = await checkItems([
      { op: "pause", object_type: "ad", object_id: "CR00147" },
      { op: "set_budget", object_type: "adset", object_id: "AS1", after: { daily_budget: 48 }, before: { daily_budget: 999 } },
      { op: "set_budget", object_type: "adset", object_id: "AS1", after: { daily_budget: 90 } },
      { op: "create", object_type: "campaign", object_id: "X" },
      { op: "pause", object_type: "ad", object_id: "NOPE" },
    ], find);
    expect(r.items.map((i) => `${i.op}:${i.objectId}`)).toEqual(["pause:120211", "set_budget:AS1"]);
    expect(r.items[1]!.before.dailyBudget).toBe(40);
    expect(r.refused).toHaveLength(3);
  });
  it("the kind follows the money: pauses are safety, a raise is a raise", () => {
    expect(kindOf([{ op: "pause", objectType: "ad", objectId: "1", before: {}, after: {} }])).toBe("safety_pause");
    expect(kindOf([{ op: "set_budget", objectType: "adset", objectId: "1", before: { dailyBudget: 40 }, after: { dailyBudget: 30 } }])).toBe("safety_reduce");
    expect(kindOf([{ op: "set_budget", objectType: "adset", objectId: "1", before: { dailyBudget: 40 }, after: { dailyBudget: 48 } }])).toBe("raise_step");
  });
});
