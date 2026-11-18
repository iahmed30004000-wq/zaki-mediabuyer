/**
 * A tiny zod → JSON Schema for the MCP tool list: one source of truth (the zod validators the tools really use), so
 * what Claude is told about a tool can never drift from what the tool accepts. It covers the shapes the tools use
 * (objects, strings, numbers, booleans, enums, literals, arrays, records, unions, optional/default) and nothing else.
 */
import type { ZodTypeAny } from "zod";

export type JsonSchema = { [key: string]: unknown };

// zod's internals are not typed for this; the shapes below are zod 3's `_def`
/* eslint-disable @typescript-eslint/no-explicit-any */
export function toJsonSchema(schema: ZodTypeAny): JsonSchema {
  const def = schema._def as any;
  const describe = (s: JsonSchema): JsonSchema => (schema.description ? { ...s, description: schema.description } : s);
  switch (def.typeName) {
    case "ZodObject": {
      const shape = def.shape() as Record<string, ZodTypeAny>;
      const properties = Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, toJsonSchema(v)]));
      const required = Object.entries(shape).filter(([, v]) => !v.isOptional()).map(([k]) => k);
      return describe({ type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: def.unknownKeys === "passthrough" });
    }
    case "ZodString": {
      const s: JsonSchema = { type: "string" };
      for (const c of def.checks as { kind: string; value?: number; regex?: RegExp }[]) {
        if (c.kind === "min") s.minLength = c.value;
        if (c.kind === "max") s.maxLength = c.value;
        if (c.kind === "regex" && c.regex) s.pattern = c.regex.source;
        if (c.kind === "datetime") s.format = "date-time";
        if (c.kind === "email") s.format = "email";
      }
      return describe(s);
    }
    case "ZodNumber": {
      const s: JsonSchema = { type: "number" };
      for (const c of def.checks as { kind: string; value?: number }[]) {
        if (c.kind === "int") s.type = "integer";
        if (c.kind === "min") s.minimum = c.value;
        if (c.kind === "max") s.maximum = c.value;
      }
      return describe(s);
    }
    case "ZodBoolean":
      return describe({ type: "boolean" });
    case "ZodEnum":
      return describe({ type: "string", enum: def.values });
    case "ZodLiteral":
      return describe({ const: def.value });
    case "ZodArray": {
      const s: JsonSchema = { type: "array", items: toJsonSchema(def.type) };
      if (def.minLength) s.minItems = def.minLength.value;
      if (def.maxLength) s.maxItems = def.maxLength.value;
      return describe(s);
    }
    case "ZodRecord":
      return describe({ type: "object", additionalProperties: toJsonSchema(def.valueType) });
    case "ZodUnion":
      return describe({ anyOf: (def.options as ZodTypeAny[]).map(toJsonSchema) });
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault": {
      const inner = toJsonSchema(def.innerType);
      return schema.description && !inner.description ? { ...inner, description: schema.description } : inner;
    }
    case "ZodEffects":
      return toJsonSchema(def.schema);
    default:
      return describe({});
  }
}
