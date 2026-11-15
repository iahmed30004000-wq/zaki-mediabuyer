import { describe, expect, it } from "vitest";
import { isValidCron, nextRuns, parseCron, runsBetween } from "@/core/cron";

// Amman is UTC+3; 14/11/2026 is a Saturday
const SAT = new Date("2026-11-14T00:00:00Z");
const iso = (list: Date[]) => list.map((d) => d.toISOString().slice(0, 16));

describe("cron on the Amman clock", () => {
  it("finds the next daily run (10:43 Amman = 07:43 UTC)", () => {
    expect(iso(nextRuns("43 10 * * *", SAT))).toEqual(["2026-11-14T07:43"]);
    expect(iso(nextRuns("43 10 * * *", new Date("2026-11-14T07:43:00Z")))).toEqual(["2026-11-15T07:43"]); // strictly after
  });

  it("finds a run just after midnight (00:35 Amman is yesterday evening in UTC)", () => {
    expect(iso(nextRuns("35 0 * * *", SAT))).toEqual(["2026-11-14T21:35"]);
  });

  it("reads a range: every hour from 10 to 22", () => {
    const runs = iso(nextRuns("0 10-22 * * *", SAT, 14));
    expect(runs[0]).toBe("2026-11-14T07:00");
    expect(runs[12]).toBe("2026-11-14T19:00");
    expect(runs[13]).toBe("2026-11-15T07:00");
  });

  it("reads a range with a step: 11:07 to 21:07 every two hours", () => {
    expect(iso(nextRuns("7 11-21/2 * * *", SAT, 6))).toEqual(["2026-11-14T08:07", "2026-11-14T10:07", "2026-11-14T12:07", "2026-11-14T14:07", "2026-11-14T16:07", "2026-11-14T18:07"]);
  });

  it("reads a weekday: Thursday at 11:20 (the next Thursday is the 19th)", () => {
    expect(iso(nextRuns("20 11 * * 4", SAT))).toEqual(["2026-11-19T08:20"]);
  });

  it("matches the day of the month OR the weekday when both are given, like cron does", () => {
    // the 1st of the month or any Monday, 09:00
    const runs = iso(nextRuns("0 9 1 * 1", SAT, 3, 30));
    expect(runs).toEqual(["2026-11-16T06:00", "2026-11-23T06:00", "2026-11-30T06:00"]);
  });

  it("lists the runs of tomorrow only", () => {
    const from = new Date("2026-11-14T21:00:00Z"); // 00:00 on the 15th in Amman
    const to = new Date("2026-11-15T21:00:00Z");
    const day = runsBetween("0 10-22 * * *", from, to);
    expect(day).toHaveLength(13);
    expect(day[0]!.toISOString()).toBe("2026-11-15T07:00:00.000Z");
    expect(runsBetween("20 11 * * 4", from, to)).toEqual([]); // the 15th is a Sunday
  });

  it("refuses what it cannot read, in words", () => {
    expect(isValidCron("43 10 * * *")).toBe(true);
    expect(isValidCron("43 10 * *")).toBe(false);
    expect(isValidCron("61 10 * * *")).toBe(false);
    expect(isValidCron("*/0 * * * *")).toBe(false);
    expect(isValidCron("a b c d e")).toBe(false);
    expect(() => parseCron("0 25 * * *")).toThrow(/الساعة/);
  });

  it("treats 7 as Sunday, like cron", () => {
    expect(parseCron("0 9 * * 7").dow).toEqual([0]);
  });
});
