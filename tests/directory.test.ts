import { describe, expect, it } from "vitest";
import { ACTOR_KEY, TEAMS, checkActor, displayName, fallbackDirectory, teamLabel } from "@/core/directory";
import { isMoneyKey, stripMoney } from "@/core/redact-money";
import { PEOPLE } from "@/core/tasks";

describe("the team directory (§4)", () => {
  it("the fallback keeps the seven who always existed, with the same keys (an old Task.assignee still points at somebody)", () => {
    const d = fallbackDirectory();
    expect(d.map((e) => e.key)).toEqual(PEOPLE.map((p) => p.key));
    expect(d.filter((e) => e.kind === "agent").map((e) => e.key)).toEqual(["hermes", "muse", "claude"]);
    expect(d.every((e) => e.active && !e.hasTelegram)).toBe(true);
  });
  it("a row that still carries only its key shows the label the code always showed; a name the owner wrote wins", () => {
    expect(displayName({ key: "muse", name: "muse" })).toBe(PEOPLE.find((p) => p.key === "muse")!.label);
    expect(displayName({ key: "muse", name: "Muse الجديد" })).toBe("Muse الجديد");
    expect(displayName({ key: "sara", name: "sara" })).toBe("sara");
  });
  it("a key is lower-case latin, digits, dash, underscore; the six teams have names", () => {
    for (const k of ["sara", "a1", "team-lead_2"]) expect(ACTOR_KEY.test(k), k).toBe(true);
    for (const k of ["S", "سارة", "1ab", "a b", "x".repeat(40)]) expect(ACTOR_KEY.test(k), k).toBe(false);
    expect(TEAMS.map((t) => t.key)).toEqual(["management", "ads", "confirm", "stock", "video", "shipping"]);
    expect(teamLabel("confirm")).toBe("التأكيد");
    expect(teamLabel(null)).toBe("بلا فريق");
  });
  it("what the screen may save: a name only (no e-mail, no number), a kind, a known team", () => {
    expect(checkActor({ key: "sara", name: "سارة", kind: "person", team: "confirm" }, { creating: true })).toEqual({ ok: true, value: { key: "sara", name: "سارة", kind: "person", team: "confirm" } });
    expect(checkActor({ key: "Bad Key", name: "x", kind: "person" }, { creating: true }).ok).toBe(false);
    expect(checkActor({ key: "a1", name: "", kind: "person" }, { creating: true }).ok).toBe(false);
    expect(checkActor({ key: "a1", name: "sara@example.com", kind: "person" }, { creating: true }).ok).toBe(false);
    expect(checkActor({ key: "a1", name: "0791234567", kind: "person" }, { creating: true }).ok).toBe(false);
    expect(checkActor({ key: "a1", name: "سارة", kind: "robot" }, { creating: true }).ok).toBe(false);
    expect(checkActor({ key: "a1", name: "سارة", kind: "person", team: "nowhere" }, { creating: true }).ok).toBe(false);
    // editing never changes the key, so it is not asked for
    expect(checkActor({ name: "سارة", kind: "agent", team: "" }, { creating: false })).toMatchObject({ ok: true, value: { kind: "agent", team: null } });
  });
});

describe("no money without money.view", () => {
  it("the money keys: profit, margin, a product's cost, break-even — not the spend, the orders or the cost per order", () => {
    for (const k of ["profit", "profitPerDelivered", "estimated_profit", "margin", "breakeven", "breakEven", "unitCost", "cogsDelivered", "netProfit"]) expect(isMoneyKey(k), k).toBe(true);
    for (const k of ["spend", "orders", "ordersIn", "costPerOrder", "costPerConfirmed", "name", "code", "confirmed", "roas"]) expect(isMoneyKey(k), k).toBe(false);
  });
  it("hidden numbers become null at any depth, everything else is kept, and the input is not changed", () => {
    const src = { spend: 40, profit: 12, products: [{ code: "A", breakeven: 8, unitCost: 3, current: { spend: 9, costPerOrder: 2, profitPerDelivered: 1.5 } }], day: new Date("2026-11-16"), note: "x" };
    const out = stripMoney(src);
    expect(out).toEqual({ spend: 40, profit: null, products: [{ code: "A", breakeven: null, unitCost: null, current: { spend: 9, costPerOrder: 2, profitPerDelivered: null } }], day: src.day, note: "x" });
    expect(src.profit).toBe(12);
    expect(src.products[0]!.breakeven).toBe(8);
  });
  it("a missing number stays missing (null), never becomes zero", () => {
    expect(stripMoney({ profit: null, margin: undefined as unknown as number })).toEqual({ profit: null, margin: undefined });
  });
});

describe("a person field knows the directory", () => {
  it("a key of the directory passes when the server hands the keys over; a stranger never does", async () => {
    const { validateValue } = await import("@/core/customize");
    const f = { type: "person" as const, label: "مين" };
    expect(validateValue(f, "sara", ["sara", "muse"])).toEqual({ ok: true, value: "sara" });
    expect(validateValue(f, "sara").ok).toBe(false);
    expect(validateValue(f, "stranger", ["sara"]).ok).toBe(false);
    expect(validateValue(f, "muse")).toEqual({ ok: true, value: "muse" });
  });
});
