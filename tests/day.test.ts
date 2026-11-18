import { describe, expect, it } from "vitest";
import { actorLabel, approvalItem, countItems, dayBounds, dayState, dayTitle, decisionItem, dueItem, expiryItem, groupItems, handoffItem, metricsText, runItem, lineTime, scheduledItem, scheduledItems, summaryOfDay, taskDoneItem, videoItem, type DayItem } from "@/core/day";

// Saturday 2026-11-14, noon in Amman
const NOW = new Date("2026-11-14T09:00:00Z");

describe("the day (v3 · G)", () => {
  it("an Amman day runs from 21:00 UTC the evening before to 21:00 UTC", () => {
    const b = dayBounds("2026-11-14");
    expect(b.from.toISOString()).toBe("2026-11-13T21:00:00.000Z");
    expect(b.to.toISOString()).toBe("2026-11-14T21:00:00.000Z");
  });

  it("past, today or future, on the Amman clock", () => {
    expect(dayState("2026-11-13", NOW)).toBe("past");
    expect(dayState("2026-11-14", NOW)).toBe("today");
    expect(dayState("2026-11-15", NOW)).toBe("future");
    // 22:30 UTC on the 14th is already the 15th in Amman
    expect(dayState("2026-11-15", new Date("2026-11-14T22:30:00Z"))).toBe("today");
  });

  it("names the day the way the owner says it", () => {
    expect(dayTitle("2026-11-14", NOW)).toBe("اليوم · السبت 14/11");
    expect(dayTitle("2026-11-13", NOW)).toBe("امبارح · الجمعة 13/11");
    expect(dayTitle("2026-11-15", NOW)).toBe("بكرا · الأحد 15/11");
    expect(dayTitle("2026-11-20", NOW)).toBe("الجمعة 20/11");
  });

  it("names people and agents", () => {
    expect(actorLabel("owner")).toBe("المالك");
    expect(actorLabel("claude")).toBe("Claude");
    expect(actorLabel("muse")).toBe("ميوز");
    expect(actorLabel("system")).toBe("النظام (قواعد وأمان)");
    expect(actorLabel("u1", { u1: "أحمد" })).toBe("أحمد");
    expect(actorLabel("someone-else")).toBe("someone-else");
  });
});

const item = (actor: string, at: string, text = "x"): DayItem => ({ at, actor, kind: "task", text });

describe("grouping", () => {
  it("one group per who: the owner first, then Claude, the system, then the rest by name; each in time order", () => {
    const groups = groupItems([item("muse", "2026-11-14T10:00:00Z"), item("claude", "2026-11-14T09:00:00Z", "b"), item("owner", "2026-11-14T08:00:00Z"), item("claude", "2026-11-14T07:00:00Z", "a"), item("system", "2026-11-14T06:00:00Z"), item("abdullah", "2026-11-14T05:00:00Z")]);
    expect(groups.map((g) => g.key)).toEqual(["owner", "claude", "system", "abdullah", "muse"]);
    expect(groups[1]!.items.map((i) => i.text)).toEqual(["a", "b"]);
    expect(countItems(groups)).toBe(6);
  });
  it("an empty day has no groups", () => {
    expect(groupItems([])).toEqual([]);
    expect(countItems([])).toBe(0);
  });
});

describe("the lines", () => {
  it("a run: who ran it, how it ended, the summary and the first numbers it reported", () => {
    const r = runItem({ name: "الفحص اليومي", status: "ok", at: "2026-11-14T06:00:00Z", summary: "3 تنبيهات", metrics: { alerts: 3, orders_read: 49, day: "2026-11-13", extra: 1 }, source: "mcp" });
    expect(r).toMatchObject({ actor: "claude", kind: "run", text: "الفحص اليومي — خلص ✓: 3 تنبيهات", tone: "ok" });
    expect(r.numbers).toEqual(["alerts 3", "orders read 49", "day 2026-11-13"]);
    expect(runItem({ name: "x", status: "failed", at: "t", summary: null, metrics: null, source: "worker" })).toMatchObject({ actor: "system", tone: "danger", text: "x — فشل ✗" });
    expect(runItem({ name: "x", status: "waiting", at: "t", summary: null, metrics: null, source: "ui" })).toMatchObject({ actor: "claude", tone: "warn" });
    expect(runItem({ name: "x", status: "ok", at: "t", summary: null, metrics: null, source: "n8n" }).actor).toBe("n8n");
  });
  it("a metric that is long text is left out", () => {
    expect(metricsText({ a: 1, b: "a very long text that is not a number at all", c: "ok" })).toEqual(["a 1", "c ok"]);
    expect(metricsText(null)).toEqual([]);
  });
  it("a decision: a person → the owner, a rule or the kill switch → the system, an agent → «وكيل»; with its money a day", () => {
    expect(decisionItem({ source: "user", sentence: "وقف يدوي: X", at: "t", spendDeltaDaily: -12.5 })).toMatchObject({ actor: "owner", numbers: ["-12.5$ باليوم"] });
    expect(decisionItem({ source: "rule", sentence: "وقّفت", at: "t", spendDeltaDaily: 0 })).toMatchObject({ actor: "system", numbers: [] });
    expect(decisionItem({ source: "kill_switch", sentence: "x", at: "t", spendDeltaDaily: 0 }).actor).toBe("system");
    expect(decisionItem({ source: "agent", sentence: "x", at: "t", spendDeltaDaily: 8 })).toMatchObject({ actor: "agent", numbers: ["+8$ باليوم"] });
    // a rule's proposal that the owner approved is his decision; one the level approved by itself is the system's
    expect(decisionItem({ source: "rule", sentence: "x", at: "t", spendDeltaDaily: 8, approvedBy: "u_123" }).actor).toBe("owner");
    expect(decisionItem({ source: "rule", sentence: "x", at: "t", spendDeltaDaily: -4, approvedBy: "level-1" }).actor).toBe("system");
  });
  it("an answer of the owner's", () => {
    expect(approvalItem({ status: "approved", title: "رفع السقف", at: "t", amount: 100 })).toMatchObject({ actor: "owner", text: "وافق على: رفع السقف", numbers: ["100$"] });
    expect(approvalItem({ status: "rejected", title: "x", at: "t", amount: null })).toMatchObject({ tone: "warn", numbers: [] });
    expect(approvalItem({ status: "pending", title: "x", at: "t", amount: null })).toBeNull();
    expect(approvalItem({ status: "expired", title: "x", at: "t", amount: null })).toBeNull();
  });
  it("a closed task is its assignee's; a video only when it moved on from the bank", () => {
    expect(taskDoneItem({ title: "جرد", at: "t", assignee: "laith" }).actor).toBe("laith");
    expect(taskDoneItem({ title: "جرد", at: "t", assignee: null }).actor).toBe("owner");
    expect(videoItem({ vName: "V45", job: "JOB-1", status: "uploaded", at: "t" })?.text).toBe("فيديو V45 (JOB-1): انرفع لميتا");
    expect(videoItem({ vName: "V45", job: "JOB-1", status: "bank", at: "t" })).toBeNull();
  });
  it("a handover answered: Claude's, or whoever it was given to", () => {
    expect(handoffItem({ title: "قراءة الطلبات", assignee: "claude_desktop", at: "t", note: "3 طلبات" })).toMatchObject({ actor: "claude", text: "سلّمت: قراءة الطلبات — 3 طلبات" });
    expect(handoffItem({ title: "x", assignee: "hermes", at: "t", note: null }).actor).toBe("hermes");
  });
  it("what is planned: a scheduled run by who does it, a task due, a decision that will lapse", () => {
    expect(scheduledItem({ name: "جولة الليل", executor: "claude_task" }, "t").actor).toBe("claude");
    expect(scheduledItem({ name: "x", executor: "hermes" }, "t").actor).toBe("hermes");
    expect(scheduledItem({ name: "x", executor: "person" }, "t").actor).toBe("owner");
    expect(scheduledItem({ name: "x", executor: "http" }, "t").actor).toBe("system");
    expect(dueItem({ title: "تقرير", dueAt: "2026-11-15T00:00:00Z", assignee: "abdullah", priority: "urgent" })).toMatchObject({ actor: "abdullah", tone: "warn", text: "موعدها: تقرير" });
    expect(expiryItem({ title: "رفع السقف", at: "t" })).toMatchObject({ actor: "owner", tone: "warn" });
  });
});

describe("the time of a line", () => {
  it("a clock time on the Amman clock; a task that is due has a day, not an hour", () => {
    expect(lineTime({ at: "2026-11-14T06:00:00Z", actor: "claude", kind: "run", text: "x" })).toBe("09:00");
    expect(lineTime(dueItem({ title: "x", dueAt: "2026-11-15T00:00:00Z", assignee: null, priority: "normal" }))).toBe("—");
  });
  it("and the summary does not invent an hour for it", () => {
    const g = groupItems([dueItem({ title: "تقرير", dueAt: "2026-11-15T00:00:00Z", assignee: "abdullah", priority: "normal" })]);
    expect(summaryOfDay("بكرا", [], g)).toContain("• — موعدها: تقرير");
  });
});

describe("scheduled runs", () => {
  const w = { name: "جولة الليل", executor: "claude_task" };
  it("a job that runs a few times a day is a line per run", () => {
    const l = scheduledItems(w, ["2026-11-15T09:00:00Z", "2026-11-15T15:00:00Z"]);
    expect(l).toHaveLength(2);
    expect(l[0]).toMatchObject({ actor: "claude", kind: "scheduled", text: "بيشتغل: جولة الليل" });
  });
  it("one that runs often is one line: how many times, from when to when (Amman clock)", () => {
    const times = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, 10, 15, 5 + i)).toISOString());
    const l = scheduledItems(w, times);
    expect(l).toHaveLength(1);
    expect(l[0]!.text).toBe("بيشتغل: جولة الليل — 12 مرة (من 08:00 لـ 19:00)");
    expect(l[0]!.at).toBe(times[0]);
  });
  it("nothing scheduled is nothing", () => {
    expect(scheduledItems(w, [])).toEqual([]);
  });
});

describe("the summary of a day", () => {
  const done = groupItems([item("claude", "2026-11-14T06:00:00Z", "الفحص اليومي — خلص ✓"), { ...item("system", "2026-11-14T07:30:00Z", "وقّفت الإعلان"), tone: "danger", numbers: ["-12$ باليوم"] }]);
  const planned = groupItems([item("muse", "2026-11-15T07:00:00Z", "موعدها: سكربت")]);
  it("lists the done and the planned, each line with its time on the Amman clock", () => {
    const t = summaryOfDay("اليوم · السبت 14/11", done, planned);
    expect(t.split("\n")[0]).toBe("الميديا باير — الإنجاز · اليوم · السبت 14/11");
    expect(t).toContain("اللي انعمل (2)");
    expect(t).toContain("— Claude");
    expect(t).toContain("• 09:00 الفحص اليومي — خلص ✓");
    expect(t).toContain("✗ 10:30 وقّفت الإعلان · -12$ باليوم");
    expect(t).toContain("المخطّط (1)");
    expect(t).toContain("• 10:00 موعدها: سكربت");
  });
  it("says so when there is nothing, and when it is the demo", () => {
    expect(summaryOfDay("بكرا", [], [])).toContain("ما في شي مسجّل لهاليوم.");
    expect(summaryOfDay("بكرا", [], [], true)).toContain("(بيانات تجريبية)");
  });
  it("a long list is cut at twelve lines a group and says how many are left", () => {
    const many = groupItems(Array.from({ length: 15 }, (_, i) => item("claude", `2026-11-14T0${i % 10}:00:00Z`, `t${i}`)));
    expect(summaryOfDay("اليوم", many, [])).toContain("… و3 غيرها");
  });
});
