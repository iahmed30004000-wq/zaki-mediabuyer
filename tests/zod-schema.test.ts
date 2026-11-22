/**
 * zod 4 (v6 P0-4): the converter that tells Claude what a tool accepts, and the few zod behaviours the site leans on.
 * The 22 real tools are held byte for byte by tests/mcp-schemas.snapshot.test.ts; here are the shapes the tools do not use today.
 */
import { describe, expect, it } from "vitest";
import { ZodError, z } from "zod";
import { toJsonSchema } from "@/core/zod-schema";
import { TOOLS } from "@/server/mcp/tools";
import { saveRules } from "@/server/rules";

describe("toJsonSchema on zod 4", () => {
  it("strings: length, pattern, e-mail and date-time; the trim step says nothing", () => {
    expect(toJsonSchema(z.string().trim().min(2).max(9))).toEqual({ type: "string", minLength: 2, maxLength: 9 });
    expect(toJsonSchema(z.string().regex(/^[a-z]+$/))).toEqual({ type: "string", pattern: "^[a-z]+$" });
    expect(toJsonSchema(z.string().email())).toEqual({ type: "string", format: "email" });
    expect(toJsonSchema(z.string().datetime())).toEqual({ type: "string", format: "date-time" });
    expect(toJsonSchema(z.string().min(0))).toEqual({ type: "string", minLength: 0 });
  });

  it("numbers: integer, minimum and maximum (positive() and nonnegative() say 0 as the minimum)", () => {
    expect(toJsonSchema(z.number().int().min(1).max(5))).toEqual({ type: "integer", minimum: 1, maximum: 5 });
    expect(toJsonSchema(z.number().int())).toEqual({ type: "integer" });
    expect(toJsonSchema(z.number().nonnegative())).toEqual({ type: "number", minimum: 0 });
    expect(toJsonSchema(z.number().positive())).toEqual({ type: "number", minimum: 0 });
    expect(toJsonSchema(z.number().finite())).toEqual({ type: "number" });
  });

  it("objects: strict and the default say additionalProperties false, passthrough says true; optional keys are not required", () => {
    const shape = { a: z.string(), b: z.number().optional(), c: z.boolean().default(true), d: z.string().nullable() };
    expect(toJsonSchema(z.object(shape).strict())).toMatchObject({ additionalProperties: false, required: ["a", "d"] });
    expect(toJsonSchema(z.object(shape))).toMatchObject({ additionalProperties: false });
    expect(toJsonSchema(z.object(shape).passthrough())).toMatchObject({ additionalProperties: true });
    expect(toJsonSchema(z.object({ a: z.string().optional() }))).not.toHaveProperty("required");
  });

  it("arrays: a minimum of 0 is left out, as it always was", () => {
    expect(toJsonSchema(z.array(z.string()).min(0).max(3))).toEqual({ type: "array", items: { type: "string" }, maxItems: 3 });
    expect(toJsonSchema(z.array(z.string()).nonempty())).toEqual({ type: "array", items: { type: "string" }, minItems: 1 });
  });

  it("enum, literal, union, record", () => {
    expect(toJsonSchema(z.enum(["x", "y"]))).toEqual({ type: "string", enum: ["x", "y"] });
    expect(toJsonSchema(z.literal(7))).toEqual({ const: 7 });
    expect(toJsonSchema(z.union([z.string(), z.number().int()]))).toEqual({ anyOf: [{ type: "string" }, { type: "integer" }] });
    expect(toJsonSchema(z.record(z.string(), z.union([z.string(), z.number()])))).toEqual({ type: "object", additionalProperties: { anyOf: [{ type: "string" }, { type: "number" }] } });
  });

  it("a transform or a preprocess shows the side the model must send", () => {
    expect(toJsonSchema(z.union([z.string(), z.number()]).transform((v) => String(v)))).toEqual({ anyOf: [{ type: "string" }, { type: "number" }] });
    expect(toJsonSchema(z.preprocess((v) => v, z.string().min(1)))).toEqual({ type: "string", minLength: 1 });
  });

  it("a description survives optional, nullable and default — before or after them", () => {
    expect(toJsonSchema(z.string().describe("d1").optional())).toEqual({ type: "string", description: "d1" });
    expect(toJsonSchema(z.string().optional().describe("d2"))).toEqual({ type: "string", description: "d2" });
    expect(toJsonSchema(z.number().default(1).describe("d3"))).toEqual({ type: "number", description: "d3" });
    expect(toJsonSchema(z.object({ k: z.string().describe("d4") }).describe("d5"))).toMatchObject({ description: "d5", properties: { k: { type: "string", description: "d4" } } });
  });

  it("a refinement does not change what is said", () => {
    expect(toJsonSchema(z.string().min(1).refine((s) => s !== "x", "no x"))).toEqual({ type: "string", minLength: 1 });
    expect(toJsonSchema(z.record(z.string(), z.string()).refine((o) => Object.keys(o).length < 3, "few"))).toEqual({ type: "object", additionalProperties: { type: "string" } });
  });
});

describe("what each tool says it needs is what it checks", () => {
  for (const t of TOOLS) {
    it(`${t.name}: an empty call passes exactly when nothing is required`, () => {
      const s = toJsonSchema(t.input) as { required?: string[] };
      expect(t.input.safeParse({}).success).toBe(!(s.required && s.required.length));
    });
    it(`${t.name}: a key nobody declared is refused`, () => {
      const s = toJsonSchema(t.input) as { additionalProperties?: boolean };
      if (s.additionalProperties === false) expect(t.input.safeParse({ __not_a_field__: 1 }).success).toBe(false);
    });
  }
});

describe("zod behaviours the site leans on", () => {
  it("a failed parse() throws a ZodError that the routes recognise", () => {
    let thrown: unknown;
    try {
      z.object({ a: z.number() }).strict().parse({ a: "x" });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ZodError);
    expect((thrown as ZodError).issues[0]?.path).toEqual(["a"]);
  });

  it("the rules save throws a ZodError for a bad set (the route turns it into words)", async () => {
    await expect(saveRules({ nonsense: true }, "u1")).rejects.toBeInstanceOf(ZodError);
  });

  it("a record needs its key type: string keys, any value", () => {
    const r = z.record(z.string(), z.number().int().nonnegative());
    expect(r.safeParse({ a: 1, b: 2 }).success).toBe(true);
    expect(r.safeParse({ a: -1 }).success).toBe(false);
    expect(r.safeParse({ a: 1.5 }).success).toBe(false);
  });

  it("an integer is a safe integer, and infinity is refused", () => {
    expect(z.number().int().safeParse(2 ** 53).success).toBe(false);
    expect(z.number().safeParse(Infinity).success).toBe(false);
    expect(z.number().int().min(0).safeParse(12).success).toBe(true);
  });

  it("a default fills a missing key and keeps a given one", () => {
    const s = z.object({ kind: z.enum(["a", "b"]).default("a") });
    expect(s.parse({})).toEqual({ kind: "a" });
    expect(s.parse({ kind: "b" })).toEqual({ kind: "b" });
  });
});
