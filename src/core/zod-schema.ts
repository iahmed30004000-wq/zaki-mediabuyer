/**
 * A tiny zod → JSON Schema for the MCP tool list: one source of truth (the zod validators the tools really use), so
 * what Claude is told about a tool can never drift from what the tool accepts. It covers the shapes the tools use
 * (objects, strings, numbers, booleans, enums, literals, arrays, records, unions, optional/default) and nothing else.
 *
 * Written against zod 4's public definition (`schema.def`, `.description`, `.isOptional()`), and held byte for byte by
 * tests/mcp-schemas.snapshot.test.ts: the answer Claude gets must not change when the library does.
 */
import type { ZodType } from "zod";

export type JsonSchema = { [key: string]: unknown };

// what the converter reads of a zod definition (zod 4: `schema.def`; a check's own definition is `check._zod.def`)
interface Def {
  type: string;
  shape?: Record<string, ZodType>;
  catchall?: ZodType;
  checks?: { _zod: { def: CheckDef } }[];
  entries?: Record<string, string | number>;
  values?: unknown[];
  element?: ZodType;
  keyType?: ZodType;
  valueType?: ZodType;
  options?: ZodType[];
  innerType?: ZodType;
  in?: ZodType;
  out?: ZodType;
}
interface CheckDef {
  check: string;
  format?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  value?: number | bigint;
  pattern?: RegExp;
}

const defOf = (s: ZodType): Def => (s as unknown as { def: Def }).def;

export function toJsonSchema(schema: ZodType): JsonSchema {
  const def = defOf(schema);
  const checks = (def.checks ?? []).map((c) => c._zod.def);
  const describe = (s: JsonSchema): JsonSchema => (schema.description ? { ...s, description: schema.description } : s);
  switch (def.type) {
    case "object": {
      const shape = def.shape ?? {};
      const properties = Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, toJsonSchema(v)]));
      const required = Object.entries(shape).filter(([, v]) => !v.isOptional()).map(([k]) => k);
      // `.passthrough()` is a catch-all of «anything»; `.strict()` (a catch-all of «never») and the default (strip) both say `false`
      const loose = def.catchall !== undefined && ["unknown", "any"].includes(defOf(def.catchall).type);
      return describe({ type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: loose });
    }
    case "string": {
      const s: JsonSchema = { type: "string" };
      for (const c of checks) {
        if (c.check === "min_length") s.minLength = Number(c.minimum);
        if (c.check === "max_length") s.maxLength = Number(c.maximum);
        if (c.check === "string_format" && c.format === "regex" && c.pattern) s.pattern = c.pattern.source;
        if (c.check === "string_format" && c.format === "datetime") s.format = "date-time";
        if (c.check === "string_format" && c.format === "email") s.format = "email";
      }
      return describe(s);
    }
    case "number": {
      const s: JsonSchema = { type: "number" };
      for (const c of checks) {
        if (c.check === "number_format" && c.format === "safeint") s.type = "integer";
        if (c.check === "greater_than") s.minimum = Number(c.value);
        if (c.check === "less_than") s.maximum = Number(c.value);
      }
      return describe(s);
    }
    case "boolean":
      return describe({ type: "boolean" });
    case "enum":
      return describe({ type: "string", enum: Object.values(def.entries ?? {}) });
    case "literal":
      return describe({ const: (def.values ?? [])[0] });
    case "array": {
      const s: JsonSchema = { type: "array", items: toJsonSchema(def.element as ZodType) };
      // the same rule as before: a minimum of 0 says nothing, so it is left out
      const min = checks.filter((c) => c.check === "min_length").map((c) => Number(c.minimum)).pop();
      const max = checks.filter((c) => c.check === "max_length").map((c) => Number(c.maximum)).pop();
      if (min) s.minItems = min;
      if (max !== undefined) s.maxItems = max;
      return describe(s);
    }
    case "record":
      return describe({ type: "object", additionalProperties: toJsonSchema(def.valueType as ZodType) });
    case "union":
      return describe({ anyOf: (def.options ?? []).map(toJsonSchema) });
    case "optional":
    case "nullable":
    case "default":
    case "prefault": {
      const inner = toJsonSchema(def.innerType as ZodType);
      return schema.description && !inner.description ? { ...inner, description: schema.description } : inner;
    }
    case "pipe": {
      // `.transform()` / `.preprocess()` are a pipe with a transform on one side: what the model must send is the other side
      const input = defOf(def.in as ZodType).type === "transform" ? (def.out as ZodType) : (def.in as ZodType);
      return toJsonSchema(input);
    }
    default:
      return describe({});
  }
}
