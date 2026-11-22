import { describe, expect, it } from "vitest";
import {
  BOARD_TEMPLATES, ENTITIES, LIMITS, UiConfigSchema, UiOpSchema, activeFields, addBoard, addField, archiveBoard, archiveField,
  boardWords, cleanHref, cleanLabel, convertField, effectiveBoards, emptyUi, fieldsFor, mergeBoards, mergeFields, moveBoard, moveBoardTo, moveField, moveFieldTo,
  parseUiConfig, renameBoard, resolveBoard, restoreBoard, restoreField, setBoardHidden, suggestMerges, updateField,
  validateValue, valueText, visibleBoards, type UiConfig, type UiEdit,
} from "@/core/customize";

const AT = "2026-11-15T10:00:00.000Z";

/** The config an edit made; the edit must have worked. */
const ok = (e: UiEdit): UiConfig => {
  if (!e.ok) throw new Error(e.error);
  return e.config;
};
const err = (e: UiEdit): string => (e.ok ? "" : e.error);

describe("the boards", () => {
  it("start as the five built-in ones; the main board is locked", () => {
    const b = effectiveBoards(emptyUi());
    expect(b.map((x) => x.key)).toEqual(["main", "confirmation", "leak", "basha", "stock"]);
    expect(b.find((x) => x.key === "main")?.locked).toBe(true);
    expect(err(setBoardHidden(emptyUi(), "main", true))).toContain("الرئيسية");
    expect(err(archiveBoard(emptyUi(), "main", 0, AT))).toContain("الرئيسية");
  });

  it("makes a board from a template with its fields on that board only; a blank one has none", () => {
    const shipments = BOARD_TEMPLATES.find((t) => t.id === "shipments")!;
    const c = ok(addBoard(emptyUi(), { id: "bd-ship", label: "شحنات الأسبوع", template: "shipments", fieldIds: ["f-1", "f-2", "f-3"] }));
    expect(effectiveBoards(c).find((b) => b.key === "bd-ship")).toMatchObject({ label: "شحنات الأسبوع", builtin: false, template: "shipments" });
    expect(c.fields.map((f) => [f.label, f.type, f.boards])).toEqual(shipments.fields.map((f) => [f.label, f.type, ["bd-ship"]]));
    expect(fieldsFor(c, "task", "bd-ship")).toHaveLength(3);
    expect(fieldsFor(c, "task", "main")).toHaveLength(0);
    const blank = ok(addBoard(emptyUi(), { id: "bd-b", label: "فاضية", template: "blank" }));
    expect(blank.fields).toHaveLength(0);
    expect(err(addBoard(emptyUi(), { id: "bd-x", label: "س", template: "shipments", fieldIds: ["f-1"] }))).toContain("معرّفات");
    expect(err(addBoard(emptyUi(), { id: "bd-x", label: "س", template: "nope" }))).toContain("القالب");
    expect(err(addBoard(emptyUi(), { id: "bd-x", label: "المخزون والتصنيع" }))).toContain("بنفس الاسم");
  });

  it("no template carries a customer, an amount of money or a key", () => {
    for (const t of BOARD_TEMPLATES) {
      expect(cleanLabel(t.name).ok).toBe(true);
      for (const f of t.fields) {
        expect(cleanLabel(f.label).ok).toBe(true);
        for (const o of f.options ?? []) expect(cleanLabel(o).ok).toBe(true);
        expect(`${f.label}${(f.options ?? []).join("")}`).not.toMatch(/[$٪%]|\d{4}/);
      }
    }
  });

  it("renames, hides (its tab only), moves", () => {
    let c = ok(renameBoard(emptyUi(), "leak", "سد التسريب 2"));
    expect(effectiveBoards(c).find((b) => b.key === "leak")?.label).toBe("سد التسريب 2");
    c = ok(setBoardHidden(c, "basha", true));
    expect(visibleBoards(effectiveBoards(c)).map((b) => b.key)).not.toContain("basha");
    c = ok(moveBoard(c, "stock", -1)); // swaps with leak (basha is hidden)
    expect(visibleBoards(effectiveBoards(c)).map((b) => b.key)).toEqual(["main", "confirmation", "stock", "leak"]);
    expect(err(moveBoard(c, "main", -1))).toContain("أول");
  });

  it("puts away only an unused board — one with tasks must be merged", () => {
    const c = ok(addBoard(emptyUi(), { id: "bd-1", label: "جديدة" }));
    expect(err(archiveBoard(c, "bd-1", 3, AT))).toContain("3 مهمة");
    const gone = ok(archiveBoard(c, "bd-1", 0, AT));
    expect(effectiveBoards(gone).find((b) => b.key === "bd-1")?.archived).toBe(true);
    expect(ok(restoreBoard(gone, "bd-1")).boards.find((b) => b.key === "bd-1")?.archivedAt).toBeUndefined();
  });

  it("merges two boards without losing anything: the ids are kept, the fields follow, and it can be undone", () => {
    let c = ok(addBoard(emptyUi(), { id: "bd-a", label: "شحن", template: "shipments", fieldIds: ["f-1", "f-2", "f-3"] }));
    c = ok(addBoard(c, { id: "bd-b", label: "توصيل" }));
    c = ok(addField(c, { id: "f-9", entity: "task", label: "ملاحظة التوصيل", type: "text", boards: ["bd-a", "bd-b"] }));
    const m = ok(mergeBoards(c, { from: "bd-a", into: "bd-b", taskIds: ["t1", "t2", "t3"], taskCount: 3 }, AT));
    const a = effectiveBoards(m).find((b) => b.key === "bd-a")!;
    expect(a).toMatchObject({ archived: true, mergedInto: "bd-b", movedCount: 3, canMoveBack: true });
    // what lived on the first board now shows on the second too
    expect(fieldsFor(m, "task", "bd-b").map((f) => f.label)).toEqual(["رقم الشحنة", "شركة الشحن", "موعد التسليم", "ملاحظة التوصيل"]);
    // …and a task made later for the first board belongs to the second
    expect(resolveBoard(m, "bd-a")).toBe("bd-b");
    expect(resolveBoard(m, "bd-b")).toBe("bd-b");
    expect(resolveBoard(m, "unknown")).toBe("unknown");
    // undoing it asks for the same ids to go back
    const back = restoreBoard(m, "bd-a");
    expect(back.ok && back.moveBack).toEqual({ from: "bd-a", into: "bd-b", ids: ["t1", "t2", "t3"] });
    expect(ok(back).boards.find((b) => b.key === "bd-a")).toEqual({ key: "bd-a", custom: true, label: "شحن", template: "shipments" });
    expect(resolveBoard(ok(back), "bd-a")).toBe("bd-a");
    // …and it puts back exactly what the merge changed: the template's fields are on «شحن» again and no longer on «توصيل»
    const r = ok(back);
    expect(fieldsFor(r, "task", "bd-a").map((f) => f.label)).toEqual(["رقم الشحنة", "شركة الشحن", "موعد التسليم", "ملاحظة التوصيل"]);
    expect(fieldsFor(r, "task", "bd-b").map((f) => f.label)).toEqual(["ملاحظة التوصيل"]);
    expect(UiConfigSchema.safeParse(m).success && UiConfigSchema.safeParse(r).success).toBe(true);
  });

  it("a big merge remembers how many moved but not their ids (so it cannot be undone from here); the rules around it", () => {
    const c = ok(addBoard(emptyUi(), { id: "bd-a", label: "كبيرة" }));
    const m = ok(mergeBoards(c, { from: "bd-a", into: "main", taskIds: Array.from({ length: 300 }, (_, i) => `t${i}`), taskCount: 5000 }, AT));
    expect(effectiveBoards(m).find((b) => b.key === "bd-a")).toMatchObject({ movedCount: 5000, canMoveBack: false });
    expect(UiConfigSchema.safeParse(m).success).toBe(true);
    expect(err(mergeBoards(c, { from: "main", into: "bd-a", taskIds: [], taskCount: 0 }, AT))).toContain("الوجهة");
    expect(err(mergeBoards(c, { from: "bd-a", into: "bd-a", taskIds: [], taskCount: 0 }, AT))).toContain("مختلفتين");
    expect(err(mergeBoards(m, { from: "bd-a", into: "leak", taskIds: [], taskCount: 0 }, AT))).toContain("المحذوفات");
    // a merge chain resolves to the end, and a loop cannot hang it
    const chain: UiConfig = { ...emptyUi(), boards: [{ key: "x", custom: true, label: "x", mergedInto: "y" }, { key: "y", custom: true, label: "y", mergedInto: "x" }] };
    expect(["x", "y"]).toContain(resolveBoard(chain, "x"));
  });

  it("reads «#word» of a quick add: the key and the label, with spaces as «_»", () => {
    const c = ok(addBoard(emptyUi(), { id: "bd-ship", label: "شحنات الأسبوع" }));
    const w = boardWords(c);
    expect(w["bd-ship"]).toBe("bd-ship");
    expect(w["شحنات_الاسبوع"]).toBe("bd-ship");
    expect(w.main).toBe("main");
    expect(boardWords(ok(archiveBoard(c, "bd-ship", 0, AT)))["bd-ship"]).toBeUndefined();
  });
});

describe("the fields", () => {
  const field = (c: UiConfig, over: Partial<Parameters<typeof addField>[1]> = {}) => addField(c, { id: "f-1", entity: "task", label: "رقم الشحنة", type: "text", ...over });

  it("adds each type; a select needs two options; the scope must be real boards", () => {
    const c = ok(field(emptyUi()));
    expect(c.fields[0]).toMatchObject({ id: "f-1", entity: "task", label: "رقم الشحنة", type: "text", onCard: true });
    for (const type of ["number", "date", "person", "link"] as const) expect(field(emptyUi(), { type, label: type }).ok).toBe(true);
    expect(err(field(emptyUi(), { type: "select", options: ["واحد"] }))).toContain("خيارين");
    const s = ok(field(emptyUi(), { type: "select", options: ["أ", "ب", "أ", " ب "] }));
    expect(s.fields[0]?.options).toEqual(["أ", "ب"]);
    expect(err(field(emptyUi(), { boards: ["nope"] }))).toContain("مش موجودة");
    expect(err(field(emptyUi(), { entity: "video", boards: ["main"] }))).toContain("للمهام");
    expect(ok(field(emptyUi(), { boards: ["leak"] })).fields[0]?.boards).toEqual(["leak"]);
    expect(err(field(c, { id: "f-2" }))).toContain("بنفس الاسم والنوع");
    expect(field(c, { id: "f-2", type: "number" }).ok).toBe(true);
    expect(err(field(emptyUi(), { label: "اتصل 0944123456" }))).toContain("رقم هاتف");
    expect(err(field(emptyUi(), { type: "select", options: Array.from({ length: LIMITS.options + 1 }, (_, i) => `خيار ${i}`) }))).toContain("أقصى شي");
  });

  it("shows a field on its boards only, hidden ones only when asked, and keeps the order they were made in", () => {
    let c = ok(field(emptyUi(), { boards: ["leak"] }));
    c = ok(field(c, { id: "f-2", label: "مين", type: "person" }));
    expect(fieldsFor(c, "task", "leak").map((f) => f.id)).toEqual(["f-1", "f-2"]);
    expect(fieldsFor(c, "task", "main").map((f) => f.id)).toEqual(["f-2"]);
    expect(fieldsFor(c, "video").map((f) => f.id)).toEqual([]);
    c = ok(updateField(c, "f-2", { hidden: true }));
    expect(fieldsFor(c, "task", "main")).toEqual([]);
    expect(fieldsFor(c, "task", "main", { hidden: true }).map((f) => f.id)).toEqual(["f-2"]);
    c = ok(moveField(c, "f-1", 1));
    expect(c.fields.map((f) => f.id)).toEqual(["f-2", "f-1"]);
    expect(err(moveField(c, "f-1", 1))).toContain("آخر");
  });

  it("updates the name, the options, the scope, the card chip — never the type", () => {
    let c = ok(field(emptyUi(), { type: "select", options: ["أ", "ب"] }));
    c = ok(updateField(c, "f-1", { label: "الحالة", options: ["أ", "ب", "ج"], boards: ["leak", "stock"], onCard: false }));
    expect(c.fields[0]).toMatchObject({ label: "الحالة", options: ["أ", "ب", "ج"], boards: ["leak", "stock"], onCard: false });
    c = ok(updateField(c, "f-1", { boards: null }));
    expect(c.fields[0]?.boards).toBeUndefined();
    expect(err(updateField(c, "f-1", { options: ["أ"] }))).toContain("خيارين");
    expect(err(updateField(ok(field(emptyUi())), "f-1", { options: ["أ", "ب"] }))).toContain("للاختيار");
    expect(err(updateField(c, "nope", { label: "س" }))).toContain("مش موجود");
  });

  it("puts away only a field nobody filled in; one with values is hidden or merged", () => {
    const c = ok(field(emptyUi()));
    expect(err(archiveField(c, "f-1", 4, AT))).toContain("4 قيمة");
    const gone = ok(archiveField(c, "f-1", 0, AT));
    expect(activeFields(gone, "task")).toHaveLength(0);
    expect(activeFields(ok(restoreField(gone, "f-1")), "task")).toHaveLength(1);
    expect(err(restoreField(c, "f-1"))).toContain("مش محذوف");
    const clash = ok(field(gone, { id: "f-2" }));
    expect(err(restoreField(clash, "f-1"))).toContain("نشط بنفس الاسم");
  });

  it("merges two fields of the same card and type: the first is put away with a pointer, a select keeps both lists, scopes widen", () => {
    let c = ok(field(emptyUi(), { id: "f-a", label: "الحالة", type: "select", options: ["أ", "ب"], boards: ["leak"] }));
    c = ok(field(c, { id: "f-b", label: "حالة التوصيل", type: "select", options: ["ب", "ج"], boards: ["stock"] }));
    const m = ok(mergeFields(c, "f-a", "f-b", AT));
    expect(m.fields.find((f) => f.id === "f-a")).toMatchObject({ mergedInto: "f-b" });
    expect(m.fields.find((f) => f.id === "f-b")).toMatchObject({ options: ["ب", "ج", "أ"], boards: ["leak", "stock"] });
    expect(activeFields(m, "task").map((f) => f.id)).toEqual(["f-b"]);
    // a field everywhere widens the other to everywhere
    let d = ok(field(emptyUi(), { id: "f-a", label: "رقم", type: "text" }));
    d = ok(field(d, { id: "f-b", label: "رقم الطلب", type: "text", boards: ["leak"] }));
    expect(ok(mergeFields(d, "f-a", "f-b", AT)).fields.find((f) => f.id === "f-b")?.boards).toBeUndefined();
    // what is refused
    const num = ok(field(c, { id: "f-n", label: "عدد", type: "number" }));
    expect(err(mergeFields(num, "f-a", "f-n", AT))).toContain("النوعين مختلفين");
    const vid = ok(addField(c, { id: "f-v", entity: "video", label: "الحالة", type: "select", options: ["أ", "ب"] }));
    expect(err(mergeFields(vid, "f-a", "f-v", AT))).toContain("نفس نوع البطاقة");
    expect(err(mergeFields(c, "f-a", "f-a", AT))).toContain("مختلفين");
    expect(err(mergeFields(m, "f-a", "f-b", AT))).toContain("المحذوفات");
    const wide = ok(field(emptyUi(), { id: "f-a", label: "أ", type: "select", options: Array.from({ length: 8 }, (_, i) => `خيار ${i}`) }));
    const wide2 = ok(field(wide, { id: "f-b", label: "ب", type: "select", options: Array.from({ length: 8 }, (_, i) => `نوع ${i}`) }));
    expect(err(mergeFields(wide2, "f-a", "f-b", AT))).toContain("بعد الدمج");
  });
});

describe("what is typed into a field", () => {
  const f = (type: Parameters<typeof validateValue>[0]["type"], options?: string[]) => ({ type, options, label: "الحقل" });

  it("a text is trimmed and kept short — a phone, an e-mail or a key is refused", () => {
    expect(validateValue(f("text"), "  مرحبا   عالم ")).toEqual({ ok: true, value: "مرحبا عالم" });
    for (const bad of ["كلّمه 0944123456", "a@b.com", `sk-${"a1b2c3d4".repeat(4)}`, "٠٩٤٤١٢٣٤٥٦"]) expect(validateValue(f("text"), bad).ok, bad).toBe(false);
    expect(validateValue(f("text"), "x".repeat(LIMITS.text + 1)).ok).toBe(false);
  });
  it("a number, a date, a choice, a person", () => {
    expect(validateValue(f("number"), "1,250.5")).toEqual({ ok: true, value: 1250.5 });
    expect(validateValue(f("number"), 3)).toEqual({ ok: true, value: 3 });
    for (const bad of ["abc", Infinity, "1e12"]) expect(validateValue(f("number"), bad).ok).toBe(false);
    expect(validateValue(f("date"), "2026-11-15")).toEqual({ ok: true, value: "2026-11-15" });
    for (const bad of ["15/11/2026", "2026-13-40", "غداً"]) expect(validateValue(f("date"), bad).ok).toBe(false);
    expect(validateValue(f("select", ["أ", "ب"]), "ب")).toEqual({ ok: true, value: "ب" });
    expect(validateValue(f("select", ["أ", "ب"]), "ج").ok).toBe(false);
    expect(validateValue(f("person"), "muse")).toEqual({ ok: true, value: "muse" });
    expect(validateValue(f("person"), "stranger").ok).toBe(false);
  });
  it("a link is an address inside the site or an https one — never a script", () => {
    expect(validateValue(f("link"), "https://drive.google.com/file/d/abc")).toMatchObject({ ok: true });
    expect(validateValue(f("link"), "/workflow")).toEqual({ ok: true, value: "/workflow" });
    for (const bad of ["javascript:alert(1)", "http://x.com", "data:text/html,hi", "https://a:b@c.com"]) expect(validateValue(f("link"), bad).ok, bad).toBe(false);
  });
  it("nothing typed is a cleared value", () => {
    for (const empty of [null, undefined, "", "   "]) expect(validateValue(f("text"), empty)).toEqual({ ok: true, value: null });
  });
  it("shows a value short on a card", () => {
    expect(valueText({ type: "date" }, "2026-11-15")).toBe("15/11");
    expect(valueText({ type: "number" }, 1250.456)).toBe("1,250.46");
    expect(valueText({ type: "person" }, "muse")).toBe("ميوز");
    expect(valueText({ type: "link" }, "https://www.drive.google.com/file/x")).toBe("drive.google.com");
    expect(valueText({ type: "link" }, "/workflow")).toBe("/workflow");
    expect(valueText({ type: "text" }, "x".repeat(40))).toHaveLength(28);
    expect(valueText({ type: "text" }, "")).toBe("");
  });
});

describe("cleaning what the owner typed", () => {
  it("a label is trimmed, collapsed and kept to its length", () => {
    expect(cleanLabel("  لوحة   جديدة ")).toEqual({ ok: true, label: "لوحة جديدة" });
    expect(cleanLabel("")).toMatchObject({ ok: false });
    expect(cleanLabel("س".repeat(41))).toMatchObject({ ok: false });
  });
  it("a link is checked once, here", () => {
    expect(cleanHref("https://example.com/a?b=1")).toEqual({ ok: true, href: "https://example.com/a?b=1" });
    expect(cleanHref("/ads?tab=health")).toEqual({ ok: true, href: "/ads?tab=health" });
    expect(cleanHref("https://example.com/?token=" + "a".repeat(45))).toMatchObject({ ok: false });
  });
});

describe("the duplicates it suggests merging", () => {
  const base = { boardTasks: {}, fieldValues: {}, taskGroups: 0 };

  it("two boards named alike — the one with more tasks stays, the main one always stays", () => {
    let c: UiConfig = { ...emptyUi(), boards: [{ key: "bd-a", custom: true, label: "سد تسريب" }] };
    let s = suggestMerges({ ...base, cfg: c, boardTasks: { leak: 2, "bd-a": 9 } });
    expect(s.find((x) => x.kind === "board")).toMatchObject({ op: { op: "board.merge", from: "leak", into: "bd-a" } });
    s = suggestMerges({ ...base, cfg: c, boardTasks: { leak: 9, "bd-a": 2 } });
    expect(s.find((x) => x.kind === "board")).toMatchObject({ op: { op: "board.merge", from: "bd-a", into: "leak" } });
    c = { ...emptyUi(), boards: [{ key: "bd-m", custom: true, label: "الرئيسية" }] };
    expect(suggestMerges({ ...base, cfg: c }).filter((x) => x.kind === "board")).toHaveLength(1);
    expect(suggestMerges({ ...base, cfg: c }).find((x) => x.kind === "board")?.op).toMatchObject({ from: "bd-m", into: "main" });
  });

  it("two fields of one kind of card with the same name and type — the one with more values stays", () => {
    let c: UiConfig = { ...emptyUi(), fields: [{ id: "f-a", entity: "task", label: "رقم الشحنة", type: "text" }, { id: "f-b", entity: "task", label: "رقم  الشحنة", type: "number" }] };
    expect(suggestMerges({ ...base, cfg: c }).filter((x) => x.kind === "field")).toHaveLength(0);
    c = { ...c, fields: [...c.fields, { id: "f-c", entity: "task", label: "رقم شحنة", type: "text" }] };
    const s = suggestMerges({ ...base, cfg: c, fieldValues: { "f-a": 1, "f-c": 7 } });
    expect(s.find((x) => x.kind === "field")).toMatchObject({ op: { op: "field.merge", from: "f-a", into: "f-c" } });
  });

  it("similar tasks only point to the team's board; nothing else is suggested for an empty layout", () => {
    const s = suggestMerges({ ...base, cfg: emptyUi(), taskGroups: 2 });
    expect(s.find((x) => x.kind === "tasks")).toMatchObject({ href: "/tasks/team" });
    expect(suggestMerges({ ...base, cfg: emptyUi() })).toEqual([]);
  });
});

describe("the edit API and the stored document", () => {
  it("accepts the ops the panel sends and nothing else", () => {
    expect(UiOpSchema.safeParse({ op: "board.add", label: "جديدة", template: "shipments" }).success).toBe(true);
    expect(UiOpSchema.safeParse({ op: "field.add", entity: "task", label: "س", type: "select", options: ["أ", "ب"], boards: null }).success).toBe(true);
    expect(UiOpSchema.safeParse({ op: "board.move", key: "leak", dir: 1 }).success).toBe(true);
    // the pages and the buttons of the old edit mode are gone (v6 · P8, Q5): their ops are not part of the API any more
    for (const bad of [{ op: "board.delete", key: "leak" }, { op: "board.rename", key: "leak" }, { op: "board.move", key: "leak", dir: 2 }, { op: "field.add", entity: "order", label: "س", type: "text" }, { op: "board.hide", key: "leak", hidden: true, extra: 1 }, { op: "page.add", kind: "link", label: "س", href: "/ads" }, { op: "page.hide", key: "ads", hidden: true }, { op: "button.add", entity: "task", label: "x", workflow: "daily" }, { op: "button.archive", id: "bt-1" }]) expect(UiOpSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it("every edit leaves a document the schema accepts; garbage reads as the empty one", () => {
    let c = ok(addBoard(emptyUi(), { id: "bd-a", label: "شحن", template: "content", fieldIds: ["f-1", "f-2", "f-3"] }));
    c = ok(mergeBoards(c, { from: "bd-a", into: "main", taskIds: ["t1"], taskCount: 1 }, AT));
    expect(UiConfigSchema.safeParse(c).success).toBe(true);
    expect(parseUiConfig(JSON.parse(JSON.stringify(c)))).toEqual(c);
    for (const garbage of [null, 5, "x", {}, { v: 2 }, { v: 1, pages: "no" }, { v: 1, pages: [], boards: [], fields: [{ id: "f" }], buttons: [] }]) expect(parseUiConfig(garbage)).toEqual(emptyUi());
  });

  it("a document saved before P8 — with pages, buttons and fields of videos and jobs — still reads, and nothing is lost when a board is changed", () => {
    const old: UiConfig = {
      v: 1,
      pages: [{ key: "pg-1", custom: true, kind: "link", label: "رابط", href: "/ads" }],
      boards: [{ key: "bd-a", custom: true, label: "شحن" }],
      fields: [{ id: "f-1", entity: "task", label: "رقم", type: "text" }, { id: "v-1", entity: "video", label: "ملاحظة", type: "text" }, { id: "w-1", entity: "workflow", label: "مين", type: "text" }],
      buttons: [{ id: "bt-1", entity: "video", label: "ابعت", workflow: "daily" }],
    };
    expect(parseUiConfig(JSON.parse(JSON.stringify(old)))).toEqual(old);
    const next = ok(renameBoard(old, "bd-a", "شحنات"));
    expect(next.pages).toEqual(old.pages);
    expect(next.buttons).toEqual(old.buttons);
    expect(next.fields).toEqual(old.fields);
    // only the team's tasks have fields that are drawn
    expect(activeFields(next, "task").map((f) => f.id)).toEqual(["f-1"]);
  });
});

describe("dragging a row onto another", () => {
  const three = () => {
    let c = emptyUi();
    for (const [id, label] of [["f-1", "أول"], ["f-2", "تاني"], ["f-3", "تالت"]] as const) c = ok(addField(c, { id, entity: "task", label, type: "text" }));
    // a field saved for a video before P8 is still in the document: it is not part of the task fields' order
    c = { ...c, fields: [...c.fields, { id: "v-1", entity: "video", label: "فيديو", type: "text" }] };
    return c;
  };
  const order = (c: UiConfig, entity = "task") => c.fields.filter((f) => f.entity === entity).map((f) => f.id);

  it("the dropped field takes the place of the one it lands on, the rest keep their order", () => {
    const c = three();
    expect(order(ok(moveFieldTo(c, "f-1", "f-3")))).toEqual(["f-2", "f-3", "f-1"]);
    expect(order(ok(moveFieldTo(c, "f-3", "f-1")))).toEqual(["f-3", "f-1", "f-2"]);
    expect(order(ok(moveFieldTo(c, "f-2", "f-3")))).toEqual(["f-1", "f-3", "f-2"]);
    expect(err(moveFieldTo(c, "f-1", "f-1"))).toContain("ترتيب");
  });

  it("never across kinds of card, never onto a put-away or missing one", () => {
    const c = three();
    expect(err(moveFieldTo(c, "f-1", "v-1"))).toContain("نفس نوع");
    expect(err(moveFieldTo(c, "f-1", "nope"))).toContain("مش موجود");
    const gone = ok(archiveField(c, "f-3", 0, AT));
    expect(err(moveFieldTo(gone, "f-1", "f-3"))).toContain("ترتيب");
    // the other kind of card keeps its place in the list
    expect(order(ok(moveFieldTo(c, "f-1", "f-3")), "video")).toEqual(["v-1"]);
  });

  it("boards move the same way", () => {
    const bd = ok(moveBoardTo(emptyUi(), "leak", "main"));
    expect(visibleBoards(effectiveBoards(bd)).map((b) => b.key)[0]).toBe("leak");
  });

  it("only the team's tasks have fields now, and the drop and convert ops are part of the edit API", () => {
    expect(ENTITIES).toEqual(["task"]);
    for (const op of [{ op: "board.drop", key: "a", onto: "b" }, { op: "field.drop", id: "a", onto: "b" }, { op: "field.convert", id: "a", to: "number" }]) expect(UiOpSchema.safeParse(op).success, JSON.stringify(op)).toBe(true);
    for (const bad of [{ op: "field.add", entity: "workflow", label: "x", type: "text" }, { op: "field.add", entity: "video", label: "x", type: "text" }, { op: "page.drop", key: "a", onto: "b" }, { op: "button.drop", id: "a", onto: "b" }]) expect(UiOpSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(UiOpSchema.safeParse({ op: "field.drop", id: "a" }).success).toBe(false);
    expect(UiOpSchema.safeParse({ op: "field.add", entity: "ad", label: "x", type: "text" }).success).toBe(false);
  });
});

describe("changing a field to another type", () => {
  const withField = (type: "text" | "number" | "select" | "date", options?: string[]) => ok(addField(emptyUi(), { id: "f-1", entity: "task", label: "الرقم", type, options }));

  it("a text whose values are all numbers becomes a number; one that is not stops and says how many", () => {
    const c = withField("text");
    const e = convertField(c, "f-1", "number", ["12", "7.5", " 3 "]);
    expect(e.ok && e.convert).toEqual({ fieldId: "f-1" });
    expect(ok(e).fields[0]).toMatchObject({ type: "number", label: "الرقم" });
    expect(err(convertField(c, "f-1", "number", ["12", "سلام", "x"]))).toContain("2 قيمة من 3");
    // nothing stored yet: always fine
    expect(convertField(c, "f-1", "date", []).ok).toBe(true);
  });

  it("a number becomes text; text to a date needs real dates", () => {
    expect(convertField(withField("number"), "f-1", "text", [12, 7.5]).ok).toBe(true);
    expect(err(convertField(withField("text"), "f-1", "date", ["2026-11-20", "غدا"]))).toContain("1 قيمة من 2");
    expect(convertField(withField("text"), "f-1", "date", ["2026-11-20"]).ok).toBe(true);
  });

  it("to a select it needs options that cover every value; from a select the options go", () => {
    const t = withField("text");
    expect(err(convertField(t, "f-1", "select", ["a"]))).toContain("خيارين");
    expect(err(convertField(t, "f-1", "select", ["a", "c"], ["a", "b"]))).toContain("1 قيمة من 2");
    const s = ok(convertField(t, "f-1", "select", ["a"], ["a", "b"]));
    expect(s.fields[0]).toMatchObject({ type: "select", options: ["a", "b"] });
    const back = ok(convertField(s, "f-1", "text", ["a"]));
    expect(back.fields[0]?.options).toBeUndefined();
  });

  it("same type, a put-away field, a missing one, and a clash with a field of the new type are refused", () => {
    const c = withField("text");
    expect(err(convertField(c, "f-1", "text", []))).toContain("أصلاً");
    expect(err(convertField(c, "nope", "number", []))).toContain("مش موجود");
    expect(err(convertField(ok(archiveField(c, "f-1", 0, AT)), "f-1", "number", []))).toContain("بالمحذوفات");
    const two = ok(addField(c, { id: "f-2", entity: "task", label: "الرقم", type: "number" }));
    expect(err(convertField(two, "f-1", "number", []))).toContain("بنفس الاسم");
  });

  it("a phone number in a text never becomes a value of another type by accident", () => {
    // the value is checked as the new type: «0944123456» is a number, not a secret, so a number field keeps it — but a text field refuses it
    expect(validateValue({ type: "text", label: "x" }, "0944123456").ok).toBe(false);
  });
});
