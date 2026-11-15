import { describe, expect, it } from "vitest";
import { PEOPLE, PRIORITIES, TASK_BOARDS, TASK_COLUMNS, assigneeName, byUrgency, dueState, duplicateGroups, groupByStatus, normalize, parseQuickAdd, similar, type CardLike } from "@/core/tasks";
import { TASK_STATUSES } from "@/server/tasks";

// Saturday 2026-11-14, noon in Amman
const NOW = new Date("2026-11-14T09:00:00Z");
const q = (s: string) => parseQuickAdd(s, NOW);

describe("the columns, the boards and the people", () => {
  it("the five columns are the five task statuses, in order", () => {
    expect(TASK_COLUMNS.map((c) => c.key)).toEqual([...TASK_STATUSES]);
    expect(TASK_COLUMNS.map((c) => c.label)).toEqual(["جديد", "شغّال", "بانتظار موافقة", "متوقف", "خلص"]);
  });
  it("the four operations boards live beside the main one", () => {
    expect(TASK_BOARDS.map((b) => b.key)).toEqual(["main", "confirmation", "leak", "basha", "stock"]);
    expect(TASK_BOARDS.find((b) => b.key === "leak")?.label).toBe("سد التسريب");
  });
  it("names people and agents the way the owner says them; an unknown key is shown as it is", () => {
    expect(assigneeName("muse")).toBe("ميوز");
    expect(assigneeName("claude")).toBe("Claude");
    expect(assigneeName("someone")).toBe("someone");
    expect(assigneeName(null)).toBeNull();
    expect(PEOPLE.map((p) => p.key)).toEqual(["abdullah", "hassan", "laith", "mohammad", "hermes", "muse", "claude"]);
    expect(PRIORITIES.map((p) => p.key)).toEqual(["low", "normal", "high", "urgent"]);
  });
});

describe("reading Arabic as it is typed", () => {
  it("drops the marks, unifies the alefs, the ya and the ta marbuta, and reads Arabic digits", () => {
    expect(normalize("الأَحَد")).toBe("الاحد");
    expect(normalize("إثنين")).toBe("اثنين");
    expect(normalize("الجمعة")).toBe("الجمعه");
    expect(normalize("مصطفى")).toBe("مصطفي");
    expect(normalize("٤ هوكات")).toBe("4 هوكات");
    expect(normalize("  Muse ")).toBe("muse");
  });
});

describe("the one-line quick add (v3 · E)", () => {
  it("«بكرا لميوز: …» → tomorrow, for Muse, and the rest is the title", () => {
    expect(q("بكرا لميوز: اعمل 4 هوكات للطنين")).toEqual({ title: "اعمل 4 هوكات للطنين", assignee: "muse", due_at: "2026-11-15" });
  });
  it("a line with no words that count is only a title", () => {
    expect(q("راجع المخزون قبل ما نطلق")).toEqual({ title: "راجع المخزون قبل ما نطلق" });
  });
  it("today, the day after tomorrow, a weekday (the next one) and a written date", () => {
    expect(q("اليوم لعبدالله: ابعت التقرير")).toEqual({ title: "ابعت التقرير", assignee: "abdullah", due_at: "2026-11-14" });
    expect(q("بعد بكرا لهيرمز: سكربت جديد")).toEqual({ title: "سكربت جديد", assignee: "hermes", due_at: "2026-11-16" });
    expect(q("الاثنين لليث: دفعة فيديوهات")).toEqual({ title: "دفعة فيديوهات", assignee: "laith", due_at: "2026-11-16" });
    expect(q("السبت: جرد المخزون")?.due_at).toBe("2026-11-21"); // today is Saturday: «Saturday» is the next one
    expect(q("الخميس لحسان: متابعة الشحن")?.due_at).toBe("2026-11-19");
    expect(q("2026-12-01 لمحمد: اجتماع")).toEqual({ title: "اجتماع", assignee: "mohammad", due_at: "2026-12-01" });
  });
  it("a name counts with the «to» lam, with a colon after it, or after a date — not as the first word of a sentence", () => {
    expect(q("لميوز: سكربت")?.assignee).toBe("muse");
    expect(q("ليث: دفعة")?.assignee).toBe("laith");
    expect(q("بكرا حسان اتصل بالشحن")).toEqual({ title: "اتصل بالشحن", assignee: "hassan", due_at: "2026-11-15" });
    expect(q("حسان تأخر بالرد على الشحنات")).toEqual({ title: "حسان تأخر بالرد على الشحنات" });
  });
  it("a hashtag picks the board and «!عاجل» the urgency, anywhere in the line", () => {
    expect(q("بكرا لعبدالله: ابعت تقرير التأكيد #confirmation !عاجل")).toEqual({ title: "ابعت تقرير التأكيد", assignee: "abdullah", due_at: "2026-11-15", board: "confirmation", priority: "urgent" });
    expect(q("سدّ فتحة الصرف #التسريب")?.board).toBe("leak");
    expect(q("جرد #المخزون !مهم")).toEqual({ title: "جرد", board: "stock", priority: "high" });
    expect(q("كلّم الباشا #nope")?.title).toBe("كلّم الباشا #nope"); // an unknown tag stays in the text
  });
  it("urgent words at the start set the priority", () => {
    expect(q("عاجل: كلّم شركة الشحن")).toEqual({ title: "كلّم شركة الشحن", priority: "urgent" });
    expect(q("بكرا مهم لميوز: تصوير")).toMatchObject({ priority: "high", assignee: "muse", due_at: "2026-11-15" });
  });
  it("Arabic digits and the Latin or Arabic spelling of a name", () => {
    expect(q("بكرا لـ Muse: ٤ هوكات")?.title).toBe("4 هوكات".replace("4", "٤"));
    expect(q("بكره لعبد الله: x y")).toMatchObject({ due_at: "2026-11-15" });
  });
  it("nothing left to do is not a task", () => {
    expect(q("")).toBeNull();
    expect(q("   ")).toBeNull();
    expect(q("بكرا لميوز:")).toBeNull();
    expect(q("#leak !عاجل")).toBeNull();
  });
  it("on the Amman clock: late at night in UTC is already tomorrow there", () => {
    expect(parseQuickAdd("اليوم: س", new Date("2026-11-14T22:30:00Z"))?.due_at).toBe("2026-11-15");
  });
});

const card = (id: string, x: Partial<CardLike & { board: string }> = {}): CardLike & { board: string } => ({ id, title: "t" + id, status: "new", assignee: null, priority: "normal", dueAt: null, createdAt: "2026-11-10T00:00:00Z", board: "main", ...x });

describe("the cards", () => {
  it("urgent first, then the nearest date (no date last), then the newest", () => {
    const list = [
      card("a", { dueAt: "2026-11-20" }),
      card("b", { priority: "urgent" }),
      card("c", { dueAt: "2026-11-15" }),
      card("d", { createdAt: "2026-11-12T00:00:00Z" }),
      card("e", { priority: "high", dueAt: "2026-11-30" }),
    ];
    expect([...list].sort(byUrgency).map((c) => c.id)).toEqual(["b", "e", "c", "a", "d"]);
  });
  it("groups by status in every column, an unknown status lands in «جديد»", () => {
    const g = groupByStatus([card("a"), card("b", { status: "done" }), card("c", { status: "weird" }), card("d", { status: "stalled" })]);
    expect(g.new.map((c) => c.id).sort()).toEqual(["a", "c"]);
    expect(g.done.map((c) => c.id)).toEqual(["b"]);
    expect(g.stalled.map((c) => c.id)).toEqual(["d"]);
    expect(g.doing).toEqual([]);
  });
  it("late, today, soon — a finished task is never late", () => {
    expect(dueState("2026-11-13", "new", NOW)).toBe("late");
    expect(dueState("2026-11-14T00:00:00Z", "doing", NOW)).toBe("today");
    expect(dueState("2026-11-16", "new", NOW)).toBe("soon");
    expect(dueState("2026-11-17", "new", NOW)).toBeNull();
    expect(dueState("2026-11-01", "done", NOW)).toBeNull();
    expect(dueState(null, "new", NOW)).toBeNull();
  });
});

describe("duplicates", () => {
  it("the same words, or nearly all of the shorter title's words", () => {
    expect(similar("ابعت تقرير التأكيد لحسان", "ابعت تقرير التأكيد")).toBe(true);
    expect(similar("اعمل هوكات للطنين", "اعمل ٤ هوكات للطنين")).toBe(true);
    expect(similar("اتصل بالشحن", "اتصل بحسان")).toBe(false);
    expect(similar("جرد المخزون", "تصوير فيديو جديد")).toBe(false);
    expect(similar("", "x")).toBe(false);
  });
  it("groups open cards of the same board; a finished one or another board is left out", () => {
    const list = [
      card("a", { title: "ابعت تقرير التأكيد لحسان" }),
      card("b", { title: "ابعت تقرير التأكيد" }),
      card("c", { title: "ابعت تقرير التأكيد", board: "confirmation" }),
      card("d", { title: "ابعت تقرير التأكيد", status: "done" }),
      card("e", { title: "جرد المخزون" }),
    ];
    const groups = duplicateGroups(list);
    expect(groups.map((g) => g.map((c) => c.id))).toEqual([["a", "b"]]);
  });
});
