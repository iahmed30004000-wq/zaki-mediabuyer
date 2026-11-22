import { describe, expect, it } from "vitest";
import { describeReport, isEmptyDoc, writeValue } from "@/core/report-body";

describe("how a value is written", () => {
  it("numbers with English digits, booleans in words, nothing as a dash — never JSON", () => {
    expect(writeValue(1234.5)).toBe("1,234.5");
    expect(writeValue(0)).toBe("0");
    expect(writeValue(true)).toBe("أيوه");
    expect(writeValue(false)).toBe("لأ");
    expect(writeValue(null)).toBe("—");
    expect(writeValue(undefined)).toBe("—");
    expect(writeValue("")).toBe("—");
    expect(writeValue("   ")).toBe("—");
    expect(writeValue(Number.NaN)).toBe("—");
    expect(writeValue("جاهز")).toBe("جاهز");
    expect(writeValue(["أ", "ب", 3])).toBe("أ، ب، 3");
    expect(writeValue([])).toBe("—");
    expect(writeValue({ a: 1 })).toBe("…");
  });
});

describe("a report of the code as sentences and a table", () => {
  it("flat values become label · value lines, with the owner's words where the key is known", () => {
    const doc = describeReport({ scaled: 2, ads_paused: 3, ok: true }, { labels: { scaled: "كبّرنا", ads_paused: "وقّفنا إعلانات" } });
    expect(doc.facts).toEqual([
      { label: "كبّرنا", value: "2" },
      { label: "وقّفنا إعلانات", value: "3" },
      { label: "ok", value: "أيوه" },
    ]);
    expect(doc.tables).toEqual([]);
    expect(doc.sections).toEqual([]);
  });

  it("a key with no word is written as it is, with the underscore as a space", () => {
    expect(describeReport({ stock_checked: 4 }).facts[0]).toEqual({ label: "stock checked", value: "4" });
  });

  it("a list of objects is a table: the columns are the keys, a missing cell is a dash", () => {
    const doc = describeReport({ products: [{ name: "حرير", orders: 12 }, { name: "قطن" }] }, { labels: { products: "المنتجات", name: "المنتج", orders: "الطلبات" } });
    expect(doc.tables).toHaveLength(1);
    expect(doc.tables[0]).toEqual({ title: "المنتجات", columns: ["المنتج", "الطلبات"], rows: [["حرير", "12"], ["قطن", "—"]], more: 0 });
    expect(doc.facts).toEqual([]);
  });

  it("a long table is cut and says how many rows it left out", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ n: i }));
    const t = describeReport({ rows }, { maxRows: 10 }).tables[0]!;
    expect(t.rows).toHaveLength(10);
    expect(t.more).toBe(20);
    expect(describeReport({ rows }).tables[0]!.rows).toHaveLength(25);
  });

  it("an object inside an object is a section; nesting stops at the depth limit and says so", () => {
    const doc = describeReport({ night: { scaled: 1, deep: { deeper: { deepest: 1 } } } }, { labels: { night: "جولة الليل" }, maxDepth: 3 });
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]!.title).toBe("جولة الليل");
    expect(doc.sections[0]!.doc.facts).toEqual([{ label: "scaled", value: "1" }]);
    // night → deep is followed; deep → deeper is past the limit and is written «…»
    expect(doc.sections[0]!.doc.sections[0]!.title).toBe("deep");
    expect(doc.sections[0]!.doc.sections[0]!.doc.facts).toEqual([{ label: "deeper", value: "…" }]);
    // at the limit a deeper object is «…», not an unbounded walk
    const shallow = describeReport({ a: { b: { c: 1 } } }, { maxDepth: 1 });
    expect(shallow.facts).toEqual([{ label: "a", value: "…" }]);
  });

  it("a list of plain values is one line, not a table", () => {
    const doc = describeReport({ tags: ["أ", "ب"] });
    expect(doc.tables).toEqual([]);
    expect(doc.facts).toEqual([{ label: "tags", value: "أ، ب" }]);
  });

  it("dates are written as ISO text", () => {
    const d = new Date("2026-11-21T06:00:00.000Z");
    expect(describeReport({ at: d }).facts).toEqual([{ label: "at", value: "2026-11-21T06:00:00.000Z" }]);
  });

  it("a value that is not an object is one line with no label; nothing at all is empty", () => {
    expect(describeReport(42).facts).toEqual([{ label: "", value: "42" }]);
    expect(describeReport("خلصت").facts).toEqual([{ label: "", value: "خلصت" }]);
    expect(isEmptyDoc(describeReport({}))).toBe(true);
    expect(isEmptyDoc(describeReport({ a: {} }))).toBe(true);
    expect(isEmptyDoc(describeReport({ a: 1 }))).toBe(false);
    expect(isEmptyDoc(describeReport({ list: [{ x: 1 }] }))).toBe(false);
  });

  it("the output is never a JSON string", () => {
    const text = JSON.stringify(describeReport({ a: { b: [1, 2] }, c: [{ d: 1 }] }, { labels: {} }));
    // the document is made of plain strings: no braces of the original report leak into a value
    const doc = describeReport({ a: { b: [1, 2] }, c: [{ d: 1 }] });
    const values = [...doc.facts, ...doc.sections.flatMap((s) => s.doc.facts)].map((f) => f.value);
    for (const v of values) expect(v).not.toMatch(/[{}[\]"]/);
    expect(text.length).toBeGreaterThan(0);
  });
});
