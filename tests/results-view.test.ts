/**
 * «النتائج» (v6 · P3, docs/rebuild-v6/02-screens.md §3.4 and §3.6): a report with nothing in it is not listed; a report of the code is read as sentences and a table, never as braces of
 * JSON; the numbers of a run have the owner's names; the same line said twice in a day is said once; the bell's rows are the person's own.
 */
import { describe, expect, it } from "vitest";
import { agoWords, bellItem, bellItems, BELL_LIMIT, lampOfUrgency, safeInternalHref } from "@/core/bell";
import { collapseDayItems } from "@/core/day-collapse";
import type { DayItem } from "@/core/day";
import { agentLamp, agentLine } from "@/core/agent-state";
import { describeReport, docToText, readReportText } from "@/core/report-body";
import { isEmptyReportObject } from "@/core/report-empty";
import { unmappedFoldersSentence } from "@/core/drive-library";
import { METRIC_AR, metricLabel, unnamedMetrics } from "@/lib/glossary";
import { runReportIsEmpty } from "@/server/reports";

describe("a report with nothing in it (isEmptyReportObject)", () => {
  it("every figure zero, every text blank, every list and object empty — the code's own markers do not count as content", () => {
    expect(isEmptyReportObject({ total_usd: 0, daily_allocation: [], risks: [], by: "code" })).toBe(true);
    expect(isEmptyReportObject({ gaps: [], attribution_health: "good", attributed_pct: null, capi_issues: [] })).toBe(true);
    expect(isEmptyReportObject({ products: [], top_decisions: [], nested: { a: 0, b: "" } })).toBe(true);
    expect(isEmptyReportObject({ day: "2026-11-21", orders_read: 0 })).toBe(true);
    expect(isEmptyReportObject(null)).toBe(true);
    expect(isEmptyReportObject([])).toBe(true);
    expect(isEmptyReportObject(false)).toBe(true);
  });

  it("anything real is content: a figure, a sentence, a row, a true", () => {
    expect(isEmptyReportObject({ total_usd: 40 })).toBe(false);
    expect(isEmptyReportObject({ note: "في مشكلة بالرابط" })).toBe(false);
    expect(isEmptyReportObject({ products: [{ code: "X", orders: 0 }] })).toBe(false);
    expect(isEmptyReportObject({ ok: true })).toBe(false);
    expect(isEmptyReportObject({ deep: { deeper: [0, 0, 3] } })).toBe(false);
  });

  it("a run whose report is empty JSON and that has no sentence has nothing to show; any sentence keeps it", () => {
    expect(runReportIsEmpty({ summary: null, report: JSON.stringify({ products: [], total_usd: 0 }) })).toBe(true);
    expect(runReportIsEmpty({ summary: null, report: null })).toBe(true);
    expect(runReportIsEmpty({ summary: "  ", report: "   " })).toBe(true);
    expect(runReportIsEmpty({ summary: "خلصت 3 مهام", report: JSON.stringify({ total_usd: 0 }) })).toBe(false);
    expect(runReportIsEmpty({ summary: null, report: "نص حقيقي كتبه الوكيل" })).toBe(false);
    expect(runReportIsEmpty({ summary: null, report: JSON.stringify({ total_usd: 12 }) })).toBe(false);
  });
});

describe("a report of the code is sentences — never braces", () => {
  it("a report that is JSON is read as a value; plain text stays text; JSON that does not parse is raw text", () => {
    expect(readReportText(JSON.stringify({ a: 1 }))).toEqual({ kind: "value", value: { a: 1 } });
    expect(readReportText("[1,2]")).toEqual({ kind: "value", value: [1, 2] });
    expect(readReportText("خلصنا الجولة")).toEqual({ kind: "text", text: "خلصنا الجولة" });
    expect(readReportText("{ not json")).toEqual({ kind: "text", text: "{ not json" });
    expect(readReportText("")).toEqual({ kind: "none" });
    expect(readReportText(null)).toEqual({ kind: "none" });
    expect(readReportText("42")).toEqual({ kind: "text", text: "42" });
  });

  it("the three reports of the code, written out, have no brace, bracket or quote in them", () => {
    const plan = { total_usd: 120.5, daily_allocation: [{ product_code: "X", bucket: "scale", usd: 40 }, { product_code: "Y", bucket: "test", usd: 20 }], risks: ["سقف قريب"], by: "code", nested: { a: { b: { c: 1 } } } };
    const attribution = { gaps: [{ ad: "A1", gap_pct: 22 }], attributed_pct: 62.5, capi_accepted_pct: null, capi_issues: [], notify: [] };
    const analysis = { products: [{ code: "X", verdict: "ماشي" }], top_decisions: ["كبّر X"], ok: true };
    for (const report of [plan, attribution, analysis]) {
      const text = docToText(describeReport(report, { labels: METRIC_AR }));
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/[{}[\]"]/);
    }
  });

  it("a key with the owner's name is written with it; a key without is shown as it is (with the underscore as a space) and is listed to be named", () => {
    expect(metricLabel("orders_read")).toBe(METRIC_AR.orders_read);
    expect(metricLabel("weird_new_key")).toBe("weird new key");
    expect(unnamedMetrics(["orders_read", "weird_new_key", "weird_new_key", "another"])).toEqual(["weird_new_key", "another"]);
    const doc = describeReport({ ads_paused: 3, weird_new_key: 1 }, { labels: METRIC_AR });
    expect(doc.facts.map((f) => f.label)).toEqual([METRIC_AR.ads_paused, "weird new key"]);
  });
});

describe("the same line said once (U-11)", () => {
  const video = (n: number, status: string, hour = 18): DayItem => ({ at: `2026-11-22T${hour}:${String(n % 60).padStart(2, "0")}:00.000Z`, actor: "claude", kind: "video", text: `فيديو V${n} (حرير): ${status}`, href: "/ads/videos" });

  it("104 videos that went up are ONE line with a count; the lines it stands for are kept inside it", () => {
    const items = Array.from({ length: 104 }, (_, i) => video(i, "انرفع لميتا"));
    const lines = collapseDayItems(items);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ text: "104 فيديو انرفعوا لميتا", count: 104, kind: "video" });
    expect(lines[0]!.items).toHaveLength(104);
  });

  it("videos are folded by what became of them, and the trial is said as a trial", () => {
    const items = [...Array.from({ length: 5 }, (_, i) => video(i, "جاهز")), ...Array.from({ length: 3 }, (_, i) => video(10 + i, "تجربة: ما انبعت لميتا", 19)), video(30, "انرفع لميتا")];
    const lines = collapseDayItems(items);
    // in the time of the first line of each: the ready ones (18:00), the single one that went up (18:30), the trial ones (19:10)
    expect(lines.map((l) => l.text)).toEqual(["5 فيديو جاهزين", "فيديو V30 (حرير): انرفع لميتا", "3 فيديو تجربة: ما انبعتوا لميتا"]);
  });

  it("fewer than three are read one by one; lines that are word for word the same fold with «× N»; the order is the time of the first line", () => {
    const run = (m: number): DayItem => ({ at: `2026-11-22T10:0${m}:00.000Z`, actor: "claude", kind: "run", text: "الفحص اليومي — خلص ✓" });
    const other: DayItem = { at: "2026-11-22T09:00:00.000Z", actor: "owner", kind: "approval", text: "وافق على: زيادة صرف" };
    const lines = collapseDayItems([run(1), run(2), run(3), other, video(1, "جاهز"), video(2, "جاهز")]);
    expect(lines.map((l) => l.text)).toEqual(["وافق على: زيادة صرف", "الفحص اليومي — خلص ✓ × 3", "فيديو V1 (حرير): جاهز", "فيديو V2 (حرير): جاهز"]);
    expect(lines.find((l) => l.text.endsWith("× 3"))!.count).toBe(3);
    expect(lines.find((l) => l.text === "وافق على: زيادة صرف")!.count).toBe(1);
    // two videos are two lines
    expect(lines.filter((l) => l.kind === "video")).toHaveLength(2);
  });
});

describe("the alert of the folders that have no product (U-11)", () => {
  it("a few folders are named; many are a count and a link — «24 مجلد درايف ما إلهم منتج — اربطهم»", () => {
    expect(unmappedFoldersSentence(["حرير"], "درايف")).toContain("«حرير»");
    expect(unmappedFoldersSentence(["أ", "ب", "ج"], "درايف")).toContain("أ، ب، ج");
    const many = Array.from({ length: 24 }, (_, i) => `مجلد${i}`);
    expect(unmappedFoldersSentence(many, "درايف")).toBe("24 مجلد درايف ما إلهم منتج — اربطهم");
    expect(unmappedFoldersSentence(many, "الاستوديو")).toBe("24 مجلد الاستوديو ما إلهم منتج — اربطهم");
    expect(unmappedFoldersSentence(many, "درايف")).not.toContain("مجلد1،");
  });
});

describe("the bell", () => {
  const NOW = new Date("2026-11-22T12:00:00.000Z");
  const row = (over: Partial<Parameters<typeof bellItem>[0]> = {}) => ({ id: "n1", urgency: "orange", title: "جولة الفريق فاتت", body: "ما وصل أي تسجيل", href: "/tasks/team-round", createdAt: new Date("2026-11-22T11:55:00.000Z"), readAt: null, ...over });

  it("a lamp for the urgency, the time in words, a link inside the site, and whether it is unread", () => {
    expect(lampOfUrgency("red")).toBe("fail");
    expect(lampOfUrgency("orange")).toBe("wait");
    expect(lampOfUrgency("yellow")).toBe("off");
    expect(bellItem(row(), NOW)).toMatchObject({ lamp: "wait", when: "قبل 5 دقايق", unread: true, href: "/tasks/team-round" });
    expect(bellItem(row({ readAt: NOW }), NOW).unread).toBe(false);
  });

  it("a notice never takes the owner to another site: only an address of this one is kept", () => {
    expect(safeInternalHref("/tasks/day?day=2026-11-22")).toBe("/tasks/day?day=2026-11-22");
    expect(safeInternalHref("https://evil.example/x")).toBeNull();
    expect(safeInternalHref("//evil.example/x")).toBeNull();
    expect(safeInternalHref("javascript:alert(1)")).toBeNull();
    expect(safeInternalHref("/\\evil")).toBeNull();
    expect(safeInternalHref(null)).toBeNull();
    expect(bellItem(row({ href: "https://evil.example" }), NOW).href).toBeNull();
  });

  it("the time in words", () => {
    expect(agoWords(0)).toBe("هلق");
    expect(agoWords(1)).toBe("قبل دقيقة");
    expect(agoWords(2)).toBe("قبل دقيقتين");
    expect(agoWords(45)).toBe("قبل 45 دقيقة");
    expect(agoWords(60)).toBe("قبل ساعة");
    expect(agoWords(120)).toBe("قبل ساعتين");
    expect(agoWords(60 * 5)).toBe("قبل 5 ساعات");
    expect(agoWords(60 * 24)).toBe("قبل يوم");
    expect(agoWords(60 * 24 * 3)).toBe("قبل 3 أيام");
  });

  it("the last 30, newest first", () => {
    const rows = Array.from({ length: 40 }, (_, i) => row({ id: `n${i}`, createdAt: new Date(NOW.getTime() - i * 60_000) }));
    const items = bellItems([...rows].reverse(), NOW);
    expect(items).toHaveLength(BELL_LIMIT);
    expect(items[0]!.id).toBe("n0");
    expect(items[29]!.id).toBe("n29");
  });
});

describe("an agent in one line", () => {
  it("what the site saw — a run going, a call in the last minutes, or silence — and nothing it guessed", () => {
    const now = Date.parse("2026-11-22T12:00:00.000Z");
    expect(agentLamp("running")).toBe("run");
    expect(agentLamp("awake")).toBe("done");
    expect(agentLamp("silent")).toBe("off");
    expect(agentLine({ state: "running", lastSeenAt: null, queued: 0 }, now)).toBe("شغّال هلق");
    expect(agentLine({ state: "awake", lastSeenAt: null, queued: 2 }, now)).toBe("صاحي — عنده 2 بالانتظار");
    expect(agentLine({ state: "silent", lastSeenAt: "2026-11-22T10:00:00.000Z", queued: 0 }, now)).toBe("ساكت من ساعتين");
    expect(agentLine({ state: "silent", lastSeenAt: null, queued: 0 }, now)).toBe("ما ظهر لسا");
  });
});
