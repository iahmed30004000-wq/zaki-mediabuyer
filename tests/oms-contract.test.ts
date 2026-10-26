import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OmsOrder, OmsProduct, PRODUCT_FIELDS } from "@/adapters/oms";

/**
 * THE FROZEN CONTRACT WITH THE OMS — `contracts/oms-mediabuyer.v1/`.
 *
 * The source is the OMS (MKory18/Zaki-ai-CRM, same path); this folder is a verbatim copy. These tests hold the
 * adapter to it: the golden pages parse, the adapter reads no field the contract does not promise, and asks the
 * catalogue for nothing outside it. v1 only grows — a removed, renamed or retyped field is v2.
 */

const DIR = join(process.cwd(), "contracts", "oms-mediabuyer.v1");
const read = (name: string) => readFileSync(join(DIR, name), "utf8");
const json = (name: string) => JSON.parse(read(name));

/**
 * The copy is VERBATIM: a hash of each file as the OMS published it (line endings normalised, because a Windows
 * checkout turns LF into CRLF). Editing a file here fails this test — the change belongs on the OMS, then copied.
 */
const PINNED: Record<string, string> = {
  "README.md": "4f41127f3da53e7337a2d08ff37fd9f35998a52cdad578ed77a72baa1ced66ab",
  "attribution-page.example.json": "02345d00f787cc2b3910534a7856aaf41ad8c2ccd067b1ca6e95ff1568285097",
  "attribution-page.schema.json": "be643f5e1ace9762b879bfc0736eaaa8b79bd252f69eb299fad6e4a639407111",
  "products-page.example.json": "373ba6f14e1eb5df381da11acf511e00e6549c879613c5f3f03ce943a22c1991",
  "products-page.schema.json": "28c4672c30b3b18b59894d46b80970f145aefe81127404be17e7405bc5432325",
};

describe("the copy is the OMS's, byte for byte", () => {
  it("every file matches the hash it was published with, and there is no extra file", () => {
    expect(readdirSync(DIR).sort()).toEqual(Object.keys(PINNED).sort());
    for (const [name, hash] of Object.entries(PINNED)) {
      expect(createHash("sha256").update(read(name).replace(/\r\n/g, "\n")).digest("hex"), name).toBe(hash);
    }
  });
});

describe("the adapter reads what the contract promises, and nothing else", () => {
  const ORDER = json("attribution-page.schema.json").properties.items.items;
  const PRODUCT = json("products-page.schema.json").properties.items.items;

  it("every golden order and product parses", () => {
    for (const o of json("attribution-page.example.json").items) expect(() => OmsOrder.parse(o)).not.toThrow();
    for (const p of json("products-page.example.json").items) expect(() => OmsProduct.parse(p)).not.toThrow();
  });

  it("the order fields the adapter knows are exactly the contract's", () => {
    expect(Object.keys(OmsOrder.shape).sort()).toEqual(Object.keys(ORDER.properties).sort());
  });

  it("the status words agree", () => {
    expect([...OmsOrder.shape.status.options].sort()).toEqual([...ORDER.properties.status.enum].sort());
  });

  it("the product fields the adapter reads, and the ones it asks for, are all declared", () => {
    const declared = Object.keys(PRODUCT.properties);
    for (const k of Object.keys(OmsProduct.shape)) expect(declared, k).toContain(k);
    for (const f of PRODUCT_FIELDS) expect(declared, f).toContain(f);
  });

  it("the contract carries no customer field for the adapter to ever receive", () => {
    const keys = Object.keys(ORDER.properties);
    for (const k of keys) expect(k).not.toMatch(/^(?:name|full_?name|customer|phone|raw_?phone|alt_?phone|address|city|email)$/i);
  });
});

describe("CAPI stays in the OMS — no customer identifier ever leaves it (D11)", () => {
  const walk = (dir: string): string[] =>
    readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? walk(join(dir, d.name)) : /\.(ts|tsx|mjs)$/.test(d.name) ? [join(dir, d.name)] : [],
    );

  it("nothing in the code asks the OMS to open a capi_ref", () => {
    const offenders = ["src", "worker", "scripts"]
      .flatMap(walk)
      .filter((f) => /capi\/identifiers|readCapiIdentifiers|phone_e164/.test(readFileSync(join(process.cwd(), f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")));
    // `src/core/capi.ts` keeps the pure formulas (a hashed-phone field name included) and calls nothing.
    expect(offenders.filter((f) => !f.split("\\").join("/").endsWith("src/core/capi.ts"))).toEqual([]);
  });
});

