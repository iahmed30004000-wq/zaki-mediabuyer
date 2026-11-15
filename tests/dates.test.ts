import { describe, expect, it } from "vitest";
import { MAX_CUSTOM_DAYS, addDays, ammanKey, baselineWindow, daysBetween, eachDay, isKey, parseRange, previousRange, rangeLabel } from "@/core/dates";

describe("the business day (Asia/Amman)", () => {
  it("is the Amman date, not the UTC one — between 21:00 and midnight UTC it is already tomorrow", () => {
    expect(ammanKey(new Date("2026-11-14T20:59:00Z"))).toBe("2026-11-14");
    expect(ammanKey(new Date("2026-11-14T21:00:00Z"))).toBe("2026-11-15");
    expect(ammanKey(new Date("2026-12-31T22:30:00Z"))).toBe("2027-01-01");
  });

  it("does date arithmetic on keys without a time zone in the way", () => {
    expect(addDays("2026-11-14", 1)).toBe("2026-11-15");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-11-01", "2026-11-14")).toBe(13);
    expect(eachDay("2026-11-12", "2026-11-14")).toEqual(["2026-11-12", "2026-11-13", "2026-11-14"]);
    expect(eachDay("2026-11-14", "2026-11-12")).toEqual([]);
  });

  it("knows a real date from a made-up one", () => {
    expect(isKey("2026-02-28")).toBe(true);
    expect(isKey("2026-02-30")).toBe(false);
    expect(isKey("14/11/2026")).toBe(false);
    expect(isKey(undefined)).toBe(false);
  });
});

describe("the date switcher: اليوم / امبارح / 7 أيام / مخصص", () => {
  const now = new Date("2026-11-14T10:00:00Z");

  it("reads each choice", () => {
    expect(parseRange({}, now)).toEqual({ key: "today", from: "2026-11-14", to: "2026-11-14", days: 1 });
    expect(parseRange({ d: "today" }, now).days).toBe(1);
    expect(parseRange({ d: "yesterday" }, now)).toEqual({ key: "yesterday", from: "2026-11-13", to: "2026-11-13", days: 1 });
    expect(parseRange({ d: "7d" }, now)).toEqual({ key: "7d", from: "2026-11-08", to: "2026-11-14", days: 7 });
    expect(parseRange({ d: "custom", from: "2026-11-01", to: "2026-11-10" }, now)).toEqual({ key: "custom", from: "2026-11-01", to: "2026-11-10", days: 10 });
  });

  it("puts a custom range in order, caps its length, and falls back to today when it cannot be read", () => {
    expect(parseRange({ d: "custom", from: "2026-11-10", to: "2026-11-01" }, now)).toMatchObject({ from: "2026-11-01", to: "2026-11-10" });
    const long = parseRange({ d: "custom", from: "2025-01-01", to: "2026-11-10" }, now);
    expect(long.days).toBe(MAX_CUSTOM_DAYS);
    expect(long.to).toBe("2026-11-10");
    expect(parseRange({ d: "custom", from: "nope", to: "2026-11-10" }, now).key).toBe("today");
    expect(parseRange({ d: "forever" }, now).key).toBe("today");
  });

  it("follows the Amman clock: just after 21:00 UTC «today» is already the next date", () => {
    expect(parseRange({}, new Date("2026-11-14T21:30:00Z")).from).toBe("2026-11-15");
  });

  it("compares with the window right before it (yesterday for a day) and with the seven days before it", () => {
    const day = parseRange({}, now);
    expect(previousRange(day)).toEqual({ from: "2026-11-13", to: "2026-11-13" });
    expect(baselineWindow(day)).toEqual({ from: "2026-11-07", to: "2026-11-13", days: 7 });
    const week = parseRange({ d: "7d" }, now);
    expect(previousRange(week)).toEqual({ from: "2026-11-01", to: "2026-11-07" });
    expect(baselineWindow(week)).toEqual({ from: "2026-11-01", to: "2026-11-07", days: 7 });
  });

  it("names a range for the screen", () => {
    expect(rangeLabel(parseRange({ d: "yesterday" }, now))).toBe("امبارح (2026-11-13)");
    expect(rangeLabel(parseRange({ d: "7d" }, now))).toBe("7 أيام (2026-11-08 ← 2026-11-14)");
    expect(rangeLabel(parseRange({ d: "custom", from: "2026-11-01", to: "2026-11-10" }, now))).toBe("2026-11-01 ← 2026-11-10");
  });
});

describe("a date that only looks like one", () => {
  it("is not a key — and asking never throws (it may be a query string somebody typed)", () => {
    for (const bad of ["2026-13-40", "2026-02-30", "2026-00-10", "9999-99-99", "2026-11-31"]) expect(isKey(bad), bad).toBe(false);
    expect(isKey("2026-02-28")).toBe(true);
    const now = new Date("2026-11-14T09:00:00Z");
    expect(parseRange({ d: "custom", from: "2026-13-40", to: "2026-13-41" }, now)).toMatchObject({ key: "today", from: "2026-11-14" });
  });
});
