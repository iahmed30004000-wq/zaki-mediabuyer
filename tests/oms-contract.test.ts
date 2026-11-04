import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CapiIdentifiers, OmsOrder, OmsProduct, PRODUCT_FIELDS, toAttributedOrder } from "@/adapters/oms";
import { economicsFromOms } from "@/jobs/truth";

/**
 * THE FROZEN CONTRACT WITH THE OMS — `contracts/oms-mediabuyer.v1/`.
 *
 * The source is the OMS (MKory18/Zaki-ai-CRM, same path); this folder is a verbatim copy. These tests hold the adapter
 * to it: the golden pages parse, the adapter reads no field the contract does not promise, and asks the catalogue for
 * nothing outside it. v1 only grows — a removed, renamed or retyped field is v2. Copied on 2026-11-04 from the OMS
 * branch `feat/mediabuyer-integrations-4-1`, and checked identical to OMS main after PR #164 merged (`67c08905`).
 */

const DIR = join(process.cwd(), "contracts", "oms-mediabuyer.v1");
const read = (name: string) => readFileSync(join(DIR, name), "utf8");
const json = (name: string) => JSON.parse(read(name));

/** A hash of each file as the OMS published it (line endings normalised: a Windows checkout turns LF into CRLF). */
const PINNED: Record<string, string> = {
  "README.md": "d65e146a27d84bc55e6b0d62fe0ace9151e8e04138aea8b5a032c34fbdca6511",
  "attribution-page.example.json": "02345d00f787cc2b3910534a7856aaf41ad8c2ccd067b1ca6e95ff1568285097",
  "attribution-page.schema.json": "be643f5e1ace9762b879bfc0736eaaa8b79bd252f69eb299fad6e4a639407111",
  "capi-identifiers.example.json": "87b1007bca8636cec4f668470cebd530190c9fc6316025c15280a12d61fdf6e2",
  "capi-identifiers.schema.json": "4da61f889e60b8e734590a29e6707f9785ae7aa3da9ccf410b5da4973c0eb3d4",
  "products-page.example.json": "373ba6f14e1eb5df381da11acf511e00e6549c879613c5f3f03ce943a22c1991",
  "products-page.schema.json": "9c80c9cf89c13e55b2ab10e2272eb5402ff1bd25200d42129f8dbcae306402d2",
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

  it("every golden order, product and identifier row parses", () => {
    for (const o of json("attribution-page.example.json").items) expect(() => OmsOrder.parse(o)).not.toThrow();
    for (const p of json("products-page.example.json").items) expect(() => OmsProduct.parse(p)).not.toThrow();
    for (const c of json("capi-identifiers.example.json").items) expect(() => CapiIdentifiers.parse(c)).not.toThrow();
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
    for (const k of Object.keys(ORDER.properties)) expect(k).not.toMatch(/^(?:name|full_?name|customer|phone|raw_?phone|alt_?phone|address|city|email)$/i);
  });

  it("a golden order becomes a stored row, the offset in its dates read right", () => {
    const row = toAttributedOrder(OmsOrder.parse(json("attribution-page.example.json").items[0]), 24);
    expect(row.createdAtOms.toISOString()).toBe("2026-10-26T04:00:00.000Z");
    expect(row.adId).toBe("120211000000000001");
    expect(row.method).toBe("ad_id");
  });
});

describe("the OMS's «no value» never wipes what the owner typed", () => {
  it("a null fee is left out of the update, so the row keeps the owner's number", () => {
    const { update } = economicsFromOms(OmsProduct.parse(json("products-page.example.json").items[0]));
    expect(update).toMatchObject({ name: "ماء الكمأة", price: "20.00", unitCost: "3.25", stockDays: 13 });
    for (const k of ["deliveryFee", "returnFee", "codFeePct"]) expect(update).not.toHaveProperty(k);
  });
  it("a new row gets 0 for what the OMS could not say, and what it said", () => {
    const { create } = economicsFromOms(OmsProduct.parse(json("products-page.example.json").items[0]));
    expect(create).toMatchObject({ productCode: "TRF01", deliveryFee: "0", returnFee: "0", codFeePct: "0", unitCost: "3.25" });
  });
  it("a fee the OMS does send is taken", () => {
    const { update } = economicsFromOms(OmsProduct.parse({ code: "X", name: "x", delivery_fee: "2.50", return_fee: "1.00", cod_fee_pct: "0.0300" }));
    expect(update).toMatchObject({ deliveryFee: "2.50", returnFee: "1.00", codFeePct: "0.0300" });
  });
});
