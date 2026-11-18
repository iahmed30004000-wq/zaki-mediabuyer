import { describe, expect, it } from "vitest";
import { groupHits, normalize, rank, score, searchable, type SearchItem } from "@/core/search";

const item = (kind: SearchItem["kind"], id: string, title: string, extra: Partial<SearchItem> = {}): SearchItem => ({ kind, id, title, href: `/${kind}/${id}`, ...extra });

describe("normalize", () => {
  it("makes the usual loose Arabic spellings one", () => {
    expect(normalize("الإعلانات")).toBe(normalize("اعلانات"));
    expect(normalize("أحمد")).toBe(normalize("احمد"));
    expect(normalize("مدرسة")).toBe(normalize("مدرسه"));
    expect(normalize("على")).toBe(normalize("علي"));
    expect(normalize("مُحَمَّد")).toBe("محمد");
    expect(normalize("الورك فلو")).toBe("ورك فلو");
  });
  it("lower-cases Latin, turns Arabic digits to Latin, and drops punctuation", () => {
    expect(normalize("TIN_V01-Hook")).toBe("tin v01 hook");
    expect(normalize("فيديو ٠٣")).toBe("فيديو 03");
    expect(normalize("«الطنين»؟")).toBe("طنين");
  });
  it("keeps a short word that starts with «ال»", () => {
    expect(normalize("الا")).toBe("الا");
  });
});

describe("score and rank", () => {
  const items = [
    item("page", "ads", "الإعلانات", { sub: "حملات ومجموعات وإعلانات" }),
    item("page", "workflow", "الورك فلو", { sub: "المهام اللي بتشتغل" }),
    item("product", "TIN", "الطنين", { words: "TIN KamaaEye" }),
    item("ad", "120001", "TIN_V01_hook", { sub: "إعلان · الطنين", words: "120001" }),
    item("ad", "120002", "TIN_V02_hook", { sub: "إعلان · الطنين", words: "120002" }),
    item("task", "t1", "تأكيد طلبات الطنين", { sub: "مهمة" }),
    item("video", "v1", "V12 — سد التسريب"),
    item("workflow", "daily-check", "الفحص اليومي", { words: "daily-check" }),
  ];

  it("finds a thing by its own words, loosely spelled", () => {
    expect(rank("اعلانات", items)[0]!.id).toBe("ads");
    expect(rank("ورك", items)[0]!.id).toBe("workflow");
    expect(rank("tin", items).map((h) => h.id)).toContain("TIN");
  });

  it("every typed word must be found, in the title or in what sits under it", () => {
    expect(rank("طنين تأكيد", items).map((h) => h.id)).toEqual(["t1"]);
    expect(rank("طنين zzz", items)).toEqual([]);
    expect(score("", items[0]!)).toBe(0);
  });

  it("the best match first: whole word over start over inside, a code found through its hidden words", () => {
    const hits = rank("tin", items);
    expect(hits[0]!.kind).toBe("ad"); // «tin» is a whole word of the ad's TITLE; the product only has it in its hidden words
    expect(hits.map((h) => h.id)).toContain("TIN");
    expect(rank("طنين", items)[0]!.id).toBe("TIN"); // …and the product's own title wins for its Arabic name
    expect(rank("120002", items)[0]!.id).toBe("120002");
    expect(rank("daily", items)[0]!.id).toBe("daily-check");
  });

  it("the whole phrase in a row beats the same words apart", () => {
    const a = item("task", "a", "سد التسريب أول");
    const b = item("task", "b", "التسريب بعد سد");
    expect(rank("سد التسريب", [b, a]).map((h) => h.id)).toEqual(["a", "b"]);
  });

  it("ties: pages before data, then the shorter title; the same thing is never twice", () => {
    const tie = [item("task", "x", "مبيعات"), item("page", "p", "مبيعات"), item("page", "p", "مبيعات")];
    expect(rank("مبيعات", tie).map((h) => `${h.kind}:${h.id}`)).toEqual(["page:p", "task:x"]);
  });

  it("limits the answer", () => {
    const many = Array.from({ length: 50 }, (_, i) => item("ad", String(i), `إعلان ${i}`));
    expect(rank("إعلان", many, 8)).toHaveLength(8);
  });
});

describe("grouping", () => {
  it("groups by kind in the order of the best hit, each group in its own order", () => {
    const hits = rank("طنين", [item("task", "t", "طنين مهمة"), item("product", "p", "طنين"), item("ad", "a", "إعلان الطنين")]);
    const g = groupHits(hits);
    expect(g.map((x) => x.kind)).toEqual(["product", "task", "ad"]);
    expect(g[0]!.label).toBe("منتجات");
  });
  it("a query of punctuation only is not a search", () => {
    expect(searchable("  ؟؟ ")).toBe(false);
    expect(searchable("a")).toBe(true);
  });
});
