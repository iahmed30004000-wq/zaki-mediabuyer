import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { PERSON_FIELDS, PUSH_LEVELS, checkRows } from "@/core/push-rows";

const person = (over: Record<string, unknown> = {}) => ({ date: "2026-11-16", level: "person", id: "abdullah", claims: 20, confirmed: 14, rejected: 3, no_answer: 2, no_answer_fast: 1, first_claim_sec: 40, stuck_48h: 1, reactivated: 2, delivered: 9, reject_reasons: [{ reason: "السعر", count: 2 }], ...over });

describe("a team member's day (level «person»)", () => {
  it("is a level of push_metrics", () => {
    expect(PUSH_LEVELS).toContain("person");
  });

  it("a row with a known key of the team directory lands", () => {
    const r = checkRows([person()]);
    expect(r.problems).toEqual([]);
    expect(r.rows).toHaveLength(1);
  });

  it("an id that is not in the team directory is refused, and the answer lists the known keys", () => {
    const r = checkRows([person({ id: "somebody-new" })]);
    expect(r.rows).toHaveLength(0);
    expect(r.problems[0]!.error).toContain("somebody-new");
    expect(r.problems[0]!.error).toContain("abdullah");
  });

  it("a person row carries only the person's numbers: no spend, no orders, no product fields", () => {
    for (const stray of [{ spend: 5 }, { real_orders: 3 }, { orders_in: 9 }, { product: "TIN01" }, { status: "ACTIVE" }]) {
      const r = checkRows([person(stray)]);
      expect(r.rows, JSON.stringify(stray)).toHaveLength(0);
      expect(r.problems).toHaveLength(1);
    }
  });

  it("the person-only fields are refused on any other level", () => {
    for (const k of ["claims", "no_answer", "no_answer_fast", "first_claim_sec", "stuck_48h", "reactivated"]) {
      const r = checkRows([{ date: "2026-11-16", level: "product", id: "TIN01", [k]: 3 }]);
      expect(r.rows, k).toHaveLength(0);
      expect(r.problems[0]!.error).toContain("person");
    }
  });

  it("a phone number or an e-mail in the reasons is refused (employees' rows too)", () => {
    const r = checkRows([person({ reject_reasons: [{ reason: "كلّمه 0791234567", count: 1 }] })]);
    expect(r.rows).toHaveLength(0);
    expect(r.problems[0]!.error).toContain("رقم هاتف");
  });

  it("a negative or fractional number is refused", () => {
    expect(checkRows([person({ claims: -1 })]).rows).toHaveLength(0);
    expect(checkRows([person({ stuck_48h: 1.5 })]).rows).toHaveLength(0);
  });
});

describe("what the table holds", () => {
  it("PersonDay has no column that could hold a customer (name, phone, address, e-mail…)", () => {
    const fields = Prisma.dmmf.datamodel.models.find((m) => m.name === "PersonDay")!.fields.map((f) => f.name.toLowerCase());
    for (const f of fields) expect(f, f).not.toMatch(/phone|mobile|address|email|customer|client|buyer|whatsapp|name$/);
    expect(fields).toContain("actorkey");
    // the numbers a row may carry are exactly the columns (plus the shared ones)
    expect(PERSON_FIELDS.length).toBe(10);
  });
});
