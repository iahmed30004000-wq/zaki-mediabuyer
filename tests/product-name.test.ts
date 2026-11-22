/**
 * THE NAME OF A PRODUCT IN ARABIC, EVERYWHERE (v6 · P6, U-08): the OMS name when it has Arabic letters, else the first Arabic alias, else what is there; the code never disappears.
 */
import { describe, expect, it } from "vitest";
import { hasArabic, nameOf, productLabel, productLabels } from "@/core/product-name";

describe("productLabel", () => {
  it("an Arabic name is the name", () => {
    expect(productLabel("TRF01", { name: "ماء الكمأة" })).toEqual({ code: "TRF01", name: "ماء الكمأة", arabic: true });
  });

  it("a Latin name gives way to the first Arabic alias (ALBETCHU → حرير); aliases in Latin are no help", () => {
    expect(productLabel("ALB", { name: "ALBETCHU", aliases: ["Albetchu", "حرير", "حرير ٢"] })).toEqual({ code: "ALB", name: "حرير", arabic: true });
    expect(productLabel("ALB", { name: "ALBETCHU", aliases: ["Albetchu"] })).toEqual({ code: "ALB", name: "ALBETCHU", arabic: false });
  });

  it("nothing named: the code, and `arabic` says so (the readiness card counts these)", () => {
    expect(productLabel("KAMAA", null)).toEqual({ code: "KAMAA", name: "KAMAA", arabic: false });
    expect(productLabel("KAMAA", { name: "  ", aliases: [] })).toEqual({ code: "KAMAA", name: "KAMAA", arabic: false });
  });

  it("hasArabic reads the letters, not the language of the rest", () => {
    expect(hasArabic("كمأة 2")).toBe(true);
    expect(hasArabic("TRF01")).toBe(false);
    expect(hasArabic(null)).toBe(false);
  });
});

describe("productLabels / nameOf", () => {
  const labels = productLabels([{ productCode: "A", name: "ماء" }, { productCode: "B", name: "BEE" }, { productCode: "C", name: "CEE" }], [{ productCode: "B", alias: "نحلة" }, { productCode: "A", alias: "Water" }]);

  it("joins the aliases of each product by its code", () => {
    expect(labels.get("A")?.name).toBe("ماء");
    expect(labels.get("B")).toEqual({ code: "B", name: "نحلة", arabic: true });
    expect(labels.get("C")?.arabic).toBe(false);
  });

  it("a code with no row is itself", () => {
    expect(nameOf(labels, "B")).toBe("نحلة");
    expect(nameOf(labels, "ZZZ")).toBe("ZZZ");
  });
});
