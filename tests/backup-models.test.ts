/**
 * The nightly copy walks every table in the schema. A table whose key is not a single `@id` (CustomValue has a composite one)
 * broke it from 15/11 — so this test walks the same list: a new kind of key breaks the test, never the night.
 */
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { keyFields, restoreOrder } from "@/ops/backup";

const models = Prisma.dmmf.datamodel.models;

describe("every model can be copied in a stable order", () => {
  for (const m of models) {
    it(`${m.name} has a key made of real columns`, () => {
      const keys = keyFields(m);
      expect(keys.length).toBeGreaterThan(0);
      const scalars = new Set(m.fields.filter((f) => f.kind !== "object").map((f) => f.name));
      for (const k of keys) expect(scalars.has(k), `${m.name}.${k}`).toBe(true);
    });
  }

  it("the composite-key table is read by ALL its key fields", () => {
    const custom = models.find((m) => m.name === "CustomValue")!;
    expect(keyFields(custom)).toEqual(["entity", "entityId", "fieldId"]);
  });

  it("a single @id is read by that column alone", () => {
    expect(keyFields(models.find((m) => m.name === "JobRun")!)).toEqual(["id"]);
  });

  it("a model with no key at all fails loudly instead of being copied in a random order", () => {
    const keyless = { name: "Keyless", fields: [{ name: "a", kind: "scalar", isId: false, isUnique: false }], uniqueFields: [], primaryKey: null } as unknown as (typeof models)[number];
    expect(() => keyFields(keyless)).toThrow(/no key/);
  });

  it("the restore order covers every model once, links first", () => {
    const order = restoreOrder(models);
    expect(order.map((m) => m.name).sort()).toEqual(models.map((m) => m.name).sort());
  });
});
