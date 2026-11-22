/**
 * «شو عملنا» (v6 · P6, docs/rebuild-v6/04-numbers.md §5): the events on the chart are written by the code from facts a table holds. A trial (`dry_run`) change is never an event; the chart carries
 * six marks at most (the days with the most happening) and every other event is in the list; nothing says one thing caused another.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  db: {
    workflowRun: { findMany: vi.fn() },
    changeSet: { findMany: vi.fn() },
    videoBankItem: { findMany: vi.fn() },
    standingOrder: { findMany: vi.fn() },
    productEconomics: { findMany: vi.fn() },
    productAlias: { findMany: vi.fn() },
  },
}));
vi.mock("@/server/db", () => ({ db: h.db }));

import { MAX_MARKS, VIDEOS_MIN, changeEvent, dayAgoWords, nightRoundEvent, orderEvents, splitMarks, videoEvents, type ChartEvent } from "@/core/chart-events";
import { chartRange, loadEvents } from "@/lib/events-view";

const ev = (day: string, text = "حدث", kind: ChartEvent["kind"] = "scale"): ChartEvent => ({ day, text, href: null, kind });

describe("the sentences — written by the code from a fact", () => {
  it("the night round: «كبّرت 2 ووقّفت 3» (the ad sets and the ads it stopped add up); one side only says one side; nothing done is no event", () => {
    const run = { id: "r1", day: "2026-11-20", jobKey: "night-round" };
    expect(nightRoundEvent({ ...run, metrics: { scaled: 2, paused: 1, ads_paused: 2 } })).toEqual({ day: "2026-11-20", text: "جولة الليل: كبّرت 2 ووقّفت 3", href: "/tasks/night-round/runs/r1", kind: "scale" });
    expect(nightRoundEvent({ ...run, metrics: { paused: 4 } })?.text).toBe("جولة الليل: وقّفت 4");
    expect(nightRoundEvent({ ...run, metrics: { scaled: 1 } })?.text).toBe("جولة الليل: كبّرت 1");
    expect(nightRoundEvent({ ...run, metrics: { scaled: 0, paused: 0 } })).toBeNull();
    expect(nightRoundEvent({ ...run, metrics: null })).toBeNull();
    expect(nightRoundEvent({ ...run, metrics: { scaled: "كتير", paused: -2 } })).toBeNull();
  });

  it("a change: only an EXECUTED change in LIVE mode — the trial (dry_run) is never drawn", () => {
    const c = { id: "c1", kind: "raise_step", sentence: "كبّرنا «حرير 3» +20%", writeMode: "live", state: "executed", day: "2026-11-18" };
    expect(changeEvent(c)).toEqual({ day: "2026-11-18", text: "كبّرنا «حرير 3» +20%", href: "/inbox/change%3Ac1", kind: "scale" });
    expect(changeEvent({ ...c, writeMode: "dry_run" })).toBeNull();
    expect(changeEvent({ ...c, state: "pending_approval" })).toBeNull();
    expect(changeEvent({ ...c, state: "rolled_back" })).toBeNull();
    // the kinds: a stop is «pause», a new ad or test is «launch», a kind the chart has no place for is not drawn
    expect(changeEvent({ ...c, kind: "safety_pause" })?.kind).toBe("pause");
    expect(changeEvent({ ...c, kind: "new_ad" })?.kind).toBe("launch");
    expect(changeEvent({ ...c, kind: "test_campaign" })?.kind).toBe("launch");
    expect(changeEvent({ ...c, kind: "connect_asset" })).toBeNull();
    expect(changeEvent({ ...c, sentence: "   " })).toBeNull();
  });

  it("videos: from five a day for one product (a couple of files is not news), with the Arabic name", () => {
    expect(VIDEOS_MIN).toBe(5);
    const four = Array.from({ length: 4 }, () => ({ productCode: "ALB", day: "2026-11-17" }));
    expect(videoEvents(four, () => "حرير")).toEqual([]);
    const twelve = Array.from({ length: 12 }, () => ({ productCode: "ALB", day: "2026-11-17" }));
    expect(videoEvents(twelve, (c) => (c === "ALB" ? "حرير" : c))).toEqual([{ day: "2026-11-17", text: "نزل 12 فيديو جديد على «حرير»", href: "/ads/videos", kind: "videos" }]);
    // two products on the same day are counted apart
    const mixed = [...Array.from({ length: 5 }, () => ({ productCode: "A", day: "2026-11-17" })), ...Array.from({ length: 3 }, () => ({ productCode: "B", day: "2026-11-17" }))];
    expect(videoEvents(mixed, (c) => c)).toHaveLength(1);
  });

  it("standing orders: «أمر: …» the day it began and «رجع: …» the day it ended; one that is waiting for the owner or was refused is not an event", () => {
    const o = { id: "o1", text: "ولا فيديو جديد", startsDay: "2026-11-10", endedDay: "2026-11-15", status: "ended" };
    expect(orderEvents([o], "2026-11-01", "2026-11-21").map((e) => [e.day, e.text])).toEqual([["2026-11-10", "أمر: ولا فيديو جديد"], ["2026-11-15", "رجع: ولا فيديو جديد"]]);
    expect(orderEvents([o], "2026-11-12", "2026-11-21").map((e) => e.text)).toEqual(["رجع: ولا فيديو جديد"]);
    expect(orderEvents([{ ...o, status: "pending" }, { ...o, status: "rejected" }], "2026-11-01", "2026-11-21")).toEqual([]);
  });
});

describe("splitMarks — six circles at most", () => {
  it("up to six days: every day is a mark, numbered oldest first; the list under the chart is empty", () => {
    const { marks, rest } = splitMarks([ev("2026-11-12"), ev("2026-11-10"), ev("2026-11-15")]);
    expect(marks.map((m) => m.day)).toEqual(["2026-11-10", "2026-11-12", "2026-11-15"]);
    expect(rest).toEqual([]);
  });

  it("more than six days: the days with the most events win, then the most recent; the others are in the list, newest first — nothing is dropped", () => {
    expect(MAX_MARKS).toBe(6);
    const events = [
      ...Array.from({ length: 8 }, (_, i) => ev(`2026-11-${String(i + 1).padStart(2, "0")}`, `يوم ${i + 1}`)), // eight days, one event each
      ev("2026-11-03", "ثاني حدث بيوم 3"), // day 3 has two
    ];
    const { marks, rest } = splitMarks(events);
    expect(marks).toHaveLength(6);
    // the day with two events is surely marked; of the one-event days the six most recent minus it are kept: 8,7,6,5,4 + day 3
    expect(marks.map((m) => m.day)).toEqual(["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
    expect(marks[0]!.text).toBe("يوم 3 · ثاني حدث بيوم 3");
    expect(rest.map((e) => e.day)).toEqual(["2026-11-02", "2026-11-01"]);
    expect(marks.flatMap((m) => m.events).length + rest.length).toBe(events.length);
  });

  it("a mark links to the first event of its day that has a link", () => {
    const { marks } = splitMarks([ev("2026-11-10", "أ"), { ...ev("2026-11-10", "ب"), href: "/inbox/x" }]);
    expect(marks[0]!.href).toBe("/inbox/x");
  });

  it("nothing in, nothing out; the list says how long ago in words", () => {
    expect(splitMarks([])).toEqual({ marks: [], rest: [] });
    expect(dayAgoWords("2026-11-21", "2026-11-22")).toBe("قبل يوم");
    expect(dayAgoWords("2026-11-20", "2026-11-22")).toBe("قبل يومين");
    expect(dayAgoWords("2026-11-22", "2026-11-22")).toBe("اليوم");
    expect(dayAgoWords("2026-11-19", "2026-11-22")).toBe("قبل 3 أيام");
    expect(dayAgoWords("2026-11-10", "2026-11-22")).toBe("قبل 12 يوم");
  });
});

describe("loadEvents — from the tables, trial changes never asked for", () => {
  const NOW = new Date("2026-11-22T09:00:00.000Z");
  beforeEach(() => {
    for (const t of Object.values(h.db)) for (const fn of Object.values(t)) (fn as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue([]);
    delete process.env.MOCK_MODE;
  });

  it("the chart covers 30 days ending yesterday", () => {
    expect(chartRange(NOW)).toEqual({ from: "2026-10-23", to: "2026-11-21" });
  });

  it("asks only for live executed changes (a trial never leaves the database), and turns the rows into sentences on their Amman day", async () => {
    h.db.workflowRun.findMany.mockResolvedValue([{ id: "r9", startedAt: new Date("2026-11-20T21:35:00.000Z"), metrics: { scaled: 2, paused: 3 }, workflow: { key: "night-round" } }]);
    h.db.changeSet.findMany.mockResolvedValue([{ id: "c7", kind: "raise_step", sentence: "كبّرنا «حرير 3» +20%", writeMode: "live", state: "executed", executedAt: new Date("2026-11-18T09:00:00.000Z") }]);
    h.db.videoBankItem.findMany.mockResolvedValue(Array.from({ length: 6 }, () => ({ productCode: "ALBETCHU", createdAt: new Date("2026-11-17T10:00:00.000Z") })));
    h.db.productEconomics.findMany.mockResolvedValue([{ productCode: "ALBETCHU", name: "ALBETCHU" }]);
    h.db.productAlias.findMany.mockResolvedValue([{ productCode: "ALBETCHU", alias: "حرير" }]);
    h.db.standingOrder.findMany.mockResolvedValue([{ id: "o1", text: "ولا فيديو جديد", startsAt: new Date("2026-11-10T08:00:00.000Z"), endedAt: null, status: "active" }]);
    const out = await loadEvents(chartRange(NOW));
    // the night round that started at 00:35 on the 21st (Amman) belongs to the 21st
    expect(out.map((e) => [e.day, e.text])).toEqual([
      ["2026-11-10", "أمر: ولا فيديو جديد"],
      ["2026-11-17", "نزل 6 فيديوهات جديدة على «حرير»"],
      ["2026-11-18", "كبّرنا «حرير 3» +20%"],
      ["2026-11-21", "جولة الليل: كبّرت 2 ووقّفت 3"],
    ]);
    const where = (h.db.changeSet.findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ state: "executed", writeMode: "live" });
  });

  it("a row outside the days is left out; the demo draws nothing rather than invent a history", async () => {
    h.db.changeSet.findMany.mockResolvedValue([{ id: "old", kind: "raise_step", sentence: "قديم", writeMode: "live", state: "executed", executedAt: new Date("2026-08-01T09:00:00.000Z") }]);
    expect(await loadEvents(chartRange(NOW))).toEqual([]);
    process.env.MOCK_MODE = "1";
    expect(await loadEvents(chartRange(NOW))).toEqual([]);
    delete process.env.MOCK_MODE;
  });
});
