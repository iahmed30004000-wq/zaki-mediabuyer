import { describe, expect, it } from "vitest";
import { appliesTo, endNeedsOwner, hasLapsed, initialStatus, isActive, touchesProduct, untilWords } from "@/core/orders";

const now = new Date("2026-11-16T10:00:00Z");
const order = (over: Partial<{ status: string; startsAt: string; endsAt: string | null; domain: string; jobKeys: string[]; products: string[] }> = {}) => ({ status: "active", startsAt: "2026-11-16T00:00:00Z", endsAt: null as string | null, domain: "ads", jobKeys: [] as string[], products: [] as string[], ...over });

describe("when an order is in force", () => {
  it("active, started, and not yet ended", () => {
    expect(isActive(order(), now)).toBe(true);
    expect(isActive(order({ endsAt: "2026-11-17T00:00:00Z" }), now)).toBe(true);
  });
  it("one that has not started yet, one whose end passed, and one that is not «active» are not", () => {
    expect(isActive(order({ startsAt: "2026-11-17T00:00:00Z" }), now)).toBe(false);
    expect(isActive(order({ endsAt: "2026-11-16T09:59:00Z" }), now)).toBe(false);
    for (const status of ["pending", "ended", "rejected"]) expect(isActive(order({ status }), now)).toBe(false);
  });
  it("an active order whose end passed has lapsed (the site closes it); a pending one has not", () => {
    expect(hasLapsed(order({ endsAt: "2026-11-16T10:00:00Z" }), now)).toBe(true);
    expect(hasLapsed(order({ endsAt: "2026-11-16T10:01:00Z" }), now)).toBe(false);
    expect(hasLapsed(order({ status: "pending", endsAt: "2026-11-16T09:00:00Z" }), now)).toBe(false);
    expect(hasLapsed(order(), now)).toBe(false);
  });
});

describe("which jobs and products an order touches", () => {
  it("the domain must match, or be «all»", () => {
    expect(appliesTo(order({ domain: "ads" }), { key: "night-round", domain: "ads" })).toBe(true);
    expect(appliesTo(order({ domain: "ads" }), { key: "team-round", domain: "ops" })).toBe(false);
    expect(appliesTo(order({ domain: "all" }), { key: "team-round", domain: "ops" })).toBe(true);
  });
  it("an empty job list is every job of the domain; a list names them", () => {
    expect(appliesTo(order({ jobKeys: [] }), { key: "x", domain: "ads" })).toBe(true);
    expect(appliesTo(order({ jobKeys: ["a", "b"] }), { key: "b", domain: "ads" })).toBe(true);
    expect(appliesTo(order({ jobKeys: ["a", "b"] }), { key: "c", domain: "ads" })).toBe(false);
  });
  it("products: empty is all; asked only when a product is given", () => {
    expect(appliesTo(order({ products: ["TIN01"] }), { key: "x", domain: "ads" })).toBe(true);
    expect(appliesTo(order({ products: ["TIN01"] }), { key: "x", domain: "ads" }, "TIN01")).toBe(true);
    expect(appliesTo(order({ products: ["TIN01"] }), { key: "x", domain: "ads" }, "TRF01")).toBe(false);
    expect(touchesProduct(order(), "ANY")).toBe(true);
    expect(touchesProduct(order({ products: ["A"] }), "B")).toBe(false);
  });
});

describe("who may start and end an order", () => {
  it("a tightening order is active at once, from anyone", () => {
    expect(initialStatus("restrict", { source: "mcp", isOwner: false })).toBe("active");
    expect(initialStatus("restrict", { source: "ui", isOwner: true })).toBe("active");
  });
  it("a loosening order is active only when the owner makes it on the site; otherwise it waits for his yes", () => {
    expect(initialStatus("allow", { source: "ui", isOwner: true })).toBe("active");
    expect(initialStatus("allow", { source: "mcp", isOwner: false })).toBe("pending");
    expect(initialStatus("allow", { source: "mcp", isOwner: true })).toBe("pending");
    expect(initialStatus("allow", { source: "ui", isOwner: false })).toBe("pending");
  });
  it("ending a tightening order is a loosening: Claude's request waits for the owner; his own «ارجع» on the site does not", () => {
    expect(endNeedsOwner("restrict", { source: "mcp", isOwner: false })).toBe(true);
    expect(endNeedsOwner("restrict", { source: "ui", isOwner: true })).toBe(false);
    expect(endNeedsOwner("allow", { source: "mcp", isOwner: false })).toBe(false);
  });
});

describe("the end in words", () => {
  it("no end says «until you say ارجع»; an end says the date", () => {
    expect(untilWords(null)).toContain("ارجع");
    expect(untilWords("2026-11-20T10:00:00Z")).toMatch(/^لحد /);
  });
});
