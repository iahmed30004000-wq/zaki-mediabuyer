/**
 * ONE MARK OF SOURCE (v6 · P6, R-23, docs/rebuild-v6/04-numbers.md §6): every tile, report and export asks `freshness()`. The OMS silent for three hours or more turns EVERY figure that stands on it
 * into «تقدير» — not a line of one report; Meta's figures stay «ميتا».
 */
import { describe, expect, it } from "vitest";
import { homeTiles, wasNow } from "@/core/compare";
import { freshness, omsWord, sourceAfter, stampOf } from "@/core/freshness";
import { SET_KEYS, type NumbersSet } from "@/core/numbers";
import type { SourceFacts } from "@/core/numbers-readiness";

const NOW = "2026-11-22T12:00:00.000Z";
const FACTS: SourceFacts = { now: NOW, metaLinked: true, metaLastSyncAt: "2026-11-22T11:48:00.000Z", spendYesterday: true, omsLinked: true, omsLastPullAt: "2026-11-22T11:00:00.000Z", productsWithoutBreakeven: 0, unmappedFolders: 0, productsWithoutName: 0, stockFresh: true };
const set = (over: Partial<NumbersSet> = {}): NumbersSet => ({ ...Object.fromEntries(SET_KEYS.map((k) => [k, null])), ...over }) as NumbersSet;

describe("freshness — the OMS is real while it answers, an estimate the moment it goes quiet", () => {
  it("under three hours: «حقيقي» with its age; Meta is «ميتا» with its own age", () => {
    const f = freshness(FACTS);
    expect(f.oms).toMatchObject({ key: "oms", kind: "real", word: "حقيقي", ageText: "قبل ساعة" });
    expect(f.meta).toMatchObject({ key: "meta", kind: "meta", word: "ميتا", ageText: "قبل 12 دقيقة" });
    expect(f.allReal).toBe(true);
  });

  it("three hours exactly is already an estimate; so is a pull never made and an OMS that is not linked — each with its own sentence", () => {
    expect(freshness({ ...FACTS, omsLastPullAt: "2026-11-22T09:01:00.000Z" }).oms.kind).toBe("real"); // 2h59
    const stale = freshness({ ...FACTS, omsLastPullAt: "2026-11-22T09:00:00.000Z" });
    expect(stale.oms).toMatchObject({ kind: "estimate", word: "تقدير" });
    expect(stale.allReal).toBe(false);
    expect(stale.oms.note).toBe("نظام الطلبات ما ردّ من 3 ساعات (أكتر من 3 ساعات): الأرقام تقدير");
    expect(freshness({ ...FACTS, omsLastPullAt: null }).oms.note).toBe("ما سحبنا من نظام الطلبات لسا: الأرقام تقدير");
    expect(freshness({ ...FACTS, omsLastPullAt: null, omsLinked: false }).oms.note).toBe("نظام الطلبات مش مربوط: الأرقام تقدير");
  });

  it("the line under the switcher says when the numbers last moved and where each side comes from; an estimate says it", () => {
    expect(freshness(FACTS).line).toBe("آخر تحديث قبل 12 دقيقة · الطلبات من نظام الطلبات، الصرف من ميتا");
    expect(freshness({ ...FACTS, omsLastPullAt: "2026-11-22T03:00:00.000Z", metaLastSyncAt: null }).line).toBe("آخر تحديث قبل 9 ساعات · الطلبات تقدير (نظام الطلبات واقف)، الصرف من ميتا");
    expect(freshness({ ...FACTS, omsLastPullAt: null, metaLastSyncAt: null }).line).toBe("ما في تحديث لسا · الطلبات تقدير (نظام الطلبات واقف)، الصرف من ميتا");
  });

  it("Meta not linked and no spend row: the note says so; with no age known it only says where the spend comes from", () => {
    expect(freshness({ ...FACTS, metaLinked: false, spendYesterday: false, metaLastSyncAt: null }).meta.note).toBe("ميتا مش مربوطة");
    expect(freshness({ ...FACTS, metaLastSyncAt: undefined }).meta.note).toBe("الصرف من ميتا");
  });
});

describe("the word follows the source", () => {
  it("sourceAfter: Meta's figures stay Meta's; the OMS's become an estimate when it is silent", () => {
    expect(sourceAfter("meta", FACTS)).toBe("meta");
    expect(sourceAfter("meta", { ...FACTS, omsLastPullAt: null })).toBe("meta");
    expect(sourceAfter("real", FACTS)).toBe("real");
    expect(sourceAfter("real", { ...FACTS, omsLastPullAt: "2026-11-22T08:00:00.000Z" })).toBe("estimate");
  });

  it("every tile of the home takes the mark: the OMS's three turn «تقدير», the spend stays «ميتا»", () => {
    const cur = set({ ordersIn: 70, spend: 700, costPerOrder: 10, confirmRate: 50 });
    const win = { days: 7, toDay: "2026-11-21" };
    expect(homeTiles(cur, cur, FACTS, win).map((t) => [t.key, t.source])).toEqual([["realCost", "real"], ["orders", "real"], ["confirmRate", "real"], ["spend", "meta"]]);
    const silent = { ...FACTS, omsLastPullAt: "2026-11-22T02:00:00.000Z" };
    expect(homeTiles(cur, cur, silent, win).map((t) => [t.key, t.source])).toEqual([["realCost", "estimate"], ["orders", "estimate"], ["confirmRate", "estimate"], ["spend", "meta"]]);
    expect(wasNow("costPerConfirmed", cur, cur, [], silent, win).source).toBe("estimate");
    expect(wasNow("deliveredRate", cur, cur, [], silent, win).source).toBe("estimate");
  });

  it("a report or an export carries one stamp: the word and, for an estimate, why", () => {
    expect(omsWord(FACTS)).toBe("حقيقي");
    expect(omsWord({ ...FACTS, omsLastPullAt: null })).toBe("تقدير");
    expect(stampOf(FACTS)).toBe("حقيقي — من نظام الطلبات، آخر سحب قبل ساعة");
    expect(stampOf({ ...FACTS, omsLastPullAt: "2026-11-22T02:00:00.000Z" })).toBe("تقدير — نظام الطلبات ما ردّ من 10 ساعات (أكتر من 3 ساعات)");
  });
});
