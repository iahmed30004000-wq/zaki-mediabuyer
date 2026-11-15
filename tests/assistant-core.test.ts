import { describe, expect, it } from "vitest";
import {
  buildMessages, calculate, costUsd, dateNumbers, isBacked, markCited, mentions, normalizeAr, numbersIn, rangeQuery, resolveProduct, resultText, scrubForModel, systemPrompt,
  toolSpecs, unsupportedNumbers, noUsage, LIMITS,
} from "@/core/assistant";
import { z } from "zod";

const NOW = new Date("2026-11-15T09:00:00Z"); // 12:00 in Amman → 2026-11-15

describe("numbers an answer says as data", () => {
  it("reads money, percent and decimals; Arabic digits are the same numbers", () => {
    const m = mentions("تكلفة الطلب 4.15$ وتأكيد 62.5% وعدد 1,250 طلب وكمان ٤٫٢٥ دولار");
    expect(m.map((x) => x.value)).toEqual([4.15, 62.5, 1250, 4.25]);
    expect(m[0]).toMatchObject({ decimals: 2, marked: true });
    expect(m[3]).toMatchObject({ decimals: 2, marked: true });
  });

  it("leaves out dates, clock times, ids, list numbers, years, small whole numbers and code", () => {
    expect(mentions("بتاريخ 2026-11-14 الساعة 14:30 وبـ 14/11")).toEqual([]);
    expect(mentions("إعلان CR00174 للمنتج TIN01 نسخة v2")).toEqual([]);
    expect(mentions("1. أول شي\n2) تاني شي\n3- تالت شي")).toEqual([]);
    expect(mentions("عندك 3 خطوات و 10 دقايق")).toEqual([]);
    expect(mentions("بسنة 2026 وبـ 14 نوفمبر")).toEqual([]);
    expect(mentions("```\n123.45 99\n```")).toEqual([]);
    expect(mentions("استعمل {{limit_12345}} بالبرومبت")).toEqual([]);
  });

  it("checks what is left: counts above ten, any decimal, anything with $ or %", () => {
    expect(mentions("12 طلب").map((m) => m.value)).toEqual([12]);
    expect(mentions("3.5 مرات").map((m) => m.value)).toEqual([3.5]);
    expect(mentions("خسرت 5$ و 8%").map((m) => m.value)).toEqual([5, 8]);
    expect(mentions("$7.50 باليوم").map((m) => m.value)).toEqual([7.5]);
  });

  it("collects every number of a tool result, in numbers and inside strings, ignoring signs", () => {
    const got = numbersIn({ a: 4.15, b: -3, c: "الصرف 118.00$ من 2026-11-14", d: [{ e: "٢٧" }], f: "1,250.50" });
    for (const n of [4.15, 3, 118, 2026, 11, 14, 27, 1250.5]) expect(got).toContain(n);
  });

  it("backs a number at the precision the answer wrote it", () => {
    expect(isBacked({ value: 4.15, decimals: 2 }, [4.1523])).toBe(true);
    expect(isBacked({ value: 4.2, decimals: 1 }, [4.1523])).toBe(true);
    expect(isBacked({ value: 4.1, decimals: 1 }, [4.1523])).toBe(false);
    expect(isBacked({ value: 4, decimals: 0 }, [4.1523])).toBe(true);
    expect(isBacked({ value: 5, decimals: 0 }, [4.1523])).toBe(false);
    expect(isBacked({ value: 4.16, decimals: 2 }, [4.1523])).toBe(false);
  });

  it("names the numbers no tool returned", () => {
    const allowed = [4.15, 27, 118, ...dateNumbers(NOW)];
    expect(unsupportedNumbers("تكلفة الطلب 4.15$ وعندك 27 مؤكد", allowed)).toEqual([]);
    expect(unsupportedNumbers("تكلفة الطلب 5.20$ وعندك 27 مؤكد", allowed)).toEqual(["5.20$"]);
    expect(unsupportedNumbers("صرفت 118.00$ بس 140 طلب؟", allowed)).toEqual(["140"]);
    // a day the model may name is not a claim about the owner's numbers
    expect(unsupportedNumbers("امبارح 14 نوفمبر 2026", allowed)).toEqual([]);
  });

  it("a number the person typed is theirs, and a repeated claim is named once", () => {
    const allowed = [...numbersIn("زوّد الميزانية 20%")];
    expect(unsupportedNumbers("تمام، 20% زيادة", allowed)).toEqual([]);
    expect(unsupportedNumbers("زاد 35% وكمان 35%", allowed)).toEqual(["35%"]);
  });

  it("marks the facts the answer says", () => {
    const facts = [
      { label: "تكلفة الطلب الحقيقي", value: "4.15$", raw: 4.15, source: "n" },
      { label: "الصرف", value: "118.00$", raw: 118, source: "n" },
      { label: "نظرة", value: "", raw: null, source: "o" },
    ];
    const cited = markCited(facts, "تكلفة الطلب الحقيقي 4.15$");
    expect(cited.map((f) => f.cited)).toEqual([true, false, false]);
  });
});

describe("calculate", () => {
  it("adds, takes away, multiplies, divides and nests", () => {
    expect(calculate("(4.15 - 3.8) / 3.8 * 100")).toMatchObject({ ok: true, text: "9.210526" });
    expect(calculate("2 + 3 * 4")).toMatchObject({ ok: true, value: 14 });
    expect(calculate("-(2 + 3) * 2")).toMatchObject({ ok: true, value: -10 });
    expect(calculate("١٢ × ٣ ÷ ٤")).toMatchObject({ ok: true, value: 9 });
  });
  it("refuses anything else, and a division by zero", () => {
    for (const bad of ["", "abc", "process.exit()", "2 ** 3", "1 / 0", "(1 + 2", "1 + 2)", "2 3", "alert(1)", "1e3"]) expect(calculate(bad).ok).toBe(false);
    expect(calculate("1".repeat(300)).ok).toBe(false);
    expect(calculate("((((((((((((((((((((((1))))))))))))))))))))))").ok).toBe(false);
  });
});

describe("finding the product and the range", () => {
  const products = [
    { code: "TRF01", name: "ماء الكمأة" },
    { code: "TIN01", name: "قطرة طنين الأذن" },
    { code: "HAR01", name: "كريم الأذن" },
  ];
  it("by code, by the whole name, and by a word without the article", () => {
    expect(resolveProduct("tin01", products)).toMatchObject({ ok: true, item: { code: "TIN01" } });
    expect(resolveProduct("ماء الكمأة", products)).toMatchObject({ ok: true, item: { code: "TRF01" } });
    expect(resolveProduct("الطنين", products)).toMatchObject({ ok: true, item: { code: "TIN01" } });
    expect(resolveProduct("الكمأه", products)).toMatchObject({ ok: true, item: { code: "TRF01" } });
    expect(resolveProduct("قطره طنين", products)).toMatchObject({ ok: true, item: { code: "TIN01" } });
  });
  it("does not guess between two, and says what there is when none fits", () => {
    const many = resolveProduct("الأذن", products);
    expect(many).toMatchObject({ ok: false, reason: "many" });
    expect(many.ok ? [] : many.candidates.map((p) => p.code)).toEqual(["TIN01", "HAR01"]);
    expect(resolveProduct("سيارة", products)).toMatchObject({ ok: false, reason: "none", candidates: products });
    expect(resolveProduct("   ", products)).toMatchObject({ ok: false, reason: "none" });
  });
  it("normalises Arabic spelling", () => {
    expect(normalizeAr("الأَذن")).toBe("الاذن");
    expect(normalizeAr("كمأة،  الكمأة!")).toBe("كماه الكماه");
  });

  it("turns what the model says into the screens' own range query", () => {
    expect(rangeQuery({}, NOW)).toMatchObject({ ok: true, q: { d: "today" } });
    expect(rangeQuery({ range: "yesterday" }, NOW)).toMatchObject({ ok: true, q: { d: "yesterday" } });
    expect(rangeQuery({ range: "last7" }, NOW)).toMatchObject({ ok: true, q: { d: "7d" } });
    expect(rangeQuery({ range: "last30" }, NOW)).toMatchObject({ ok: true, q: { d: "custom", from: "2026-10-17", to: "2026-11-15" } });
    expect(rangeQuery({ range: "custom", from: "2026-11-10" }, NOW)).toMatchObject({ ok: true, q: { d: "custom", from: "2026-11-10", to: "2026-11-10" } });
    expect(rangeQuery({ from: "2026-11-01", to: "2026-11-07" }, NOW)).toMatchObject({ ok: true, q: { d: "custom", from: "2026-11-01", to: "2026-11-07" } });
  });
  it("refuses an unreadable or a future date, in words", () => {
    expect(rangeQuery({ range: "custom", from: "14/11/2026" }, NOW)).toMatchObject({ ok: false });
    expect(rangeQuery({ range: "custom" }, NOW)).toMatchObject({ ok: false });
    expect(rangeQuery({ range: "custom", from: "2026-12-01" }, NOW)).toMatchObject({ ok: false });
  });
});

describe("what goes to the model", () => {
  it("blanks a string that looks like a phone, an e-mail or a key — at any depth, and leaves the rest", () => {
    const key = `sk-${"a1b2c3d4".repeat(4)}`;
    const out = scrubForModel({ title: "اتصل على 0944123456", ok: "تابع الكرتون", deep: [{ note: "a@b.com" }, { note: `key ${key}` }], n: 5 });
    expect(out).toEqual({ title: "[محجوب]", ok: "تابع الكرتون", deep: [{ note: "[محجوب]" }, { note: "[محجوب]" }], n: 5 });
  });
  it("a result too big for the model becomes a note that says to narrow the question — valid JSON, never half of one", () => {
    const big = { rows: Array.from({ length: 4000 }, (_, i) => ({ i, name: `row ${i}` })) };
    const s = resultText(big, 2000);
    expect(s.length).toBeLessThan(2100);
    expect(JSON.parse(s)).toMatchObject({ truncated: true });
    expect(resultText({ a: 1 })).toBe('{"a":1}');
  });
  it("the conversation: the last few turns, short, starting with the person and alternating", () => {
    const history = [
      { role: "assistant" as const, text: "أهلين" },
      { role: "user" as const, text: "كم الصرف؟" },
      { role: "assistant" as const, text: "118$" },
      { role: "assistant" as const, text: "(وكمان)" },
    ];
    const msgs = buildMessages(history, "وبالمؤكد؟");
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(msgs[1]!.content).toBe("118$\n(وكمان)");
    expect(msgs[2]!.content).toBe("وبالمؤكد؟");
    const long = Array.from({ length: 30 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", text: `x${i}`.padEnd(5000, "y") }));
    const cut = buildMessages(long, "سؤال");
    expect(cut.length).toBeLessThanOrEqual(LIMITS.history + 1);
    expect(cut.every((m) => m.content.length <= LIMITS.historyText * 2 + 200)).toBe(true);
    expect(cut[0]!.role).toBe("user");
    // a question after a person's own unanswered turn joins it instead of making two in a row
    expect(buildMessages([{ role: "user", text: "أول" }], "تاني").map((m) => m.content)).toEqual(["أول\nتاني"]);
  });
  it("the system prompt says today and yesterday on the Amman clock, where the owner is, and the products", () => {
    const p = systemPrompt({ now: NOW, place: { key: "ads", label: "الإعلانات" }, products: [{ code: "TIN01", name: "قطرة طنين الأذن" }] });
    expect(p).toContain("2026-11-15");
    expect(p).toContain("2026-11-14");
    expect(p).toContain("«الإعلانات»");
    expect(p).toContain("TIN01 = قطرة طنين الأذن");
    expect(p).toContain("calculate");
    expect(p).toContain("propose_change");
    expect(systemPrompt({ now: NOW, place: null, products: [] })).not.toContain("المالك هلأ بصفحة");
  });
});

describe("tools as the API wants them", () => {
  it("one schema from the validator the tool really runs", () => {
    const specs = toolSpecs([
      { name: "t", description: "d", access: "read", status: "s", input: z.object({ a: z.string().describe("x"), b: z.number().int().min(1).max(5).optional() }).strict(), run: async () => ({ data: {}, sources: [], facts: [] }) },
    ]);
    expect(specs[0]).toEqual({
      name: "t",
      description: "d",
      input_schema: { type: "object", properties: { a: { type: "string", description: "x" }, b: { type: "integer", minimum: 1, maximum: 5 } }, required: ["a"], additionalProperties: false },
    });
  });
});

describe("what it costs", () => {
  it("prices the tokens the API reported, and a model it does not know as the dearest", () => {
    const u = { ...noUsage(), input: 10_000, output: 1_000 };
    expect(costUsd("claude-opus-5-5", u)).toBeCloseTo(0.04 + 0.02, 6);
    expect(costUsd("claude-sonnet-5-5", u)).toBeCloseTo(0.02 + 0.01, 6);
    expect(costUsd("something-new", u)).toBeCloseTo(0.06, 6);
    expect(costUsd("claude-opus-5-5", { ...noUsage(), cacheRead: 100_000 })).toBeCloseTo(0.04, 6);
    expect(costUsd("claude-opus-5-5", { ...noUsage(), cacheWrite: 100_000 })).toBeCloseTo(0.5, 6);
  });
});
