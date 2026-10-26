import { describe, expect, it } from "vitest";
import { guessMapping, parseCsv, readRows, toDay } from "@/io/import";

const EN = '﻿Day,Ad ID,Ad name,Amount spent (USD),Impressions,Reach,Link clicks,Landing page views,Purchases\n2026-10-20,120211000000001,CR00147_H07_HER_LP1,"1,204.50",50000,41000,900,700,40\n2026-10-20,,Total,1204.5,50000,41000,900,700,40\n';
const AR = "اليوم;معرف الإعلان;المبلغ المنفق (USD);مرات الظهور\n25/10/2026;120211000000002;12.5;3000\n";

describe("the import (spec S13 · 17.2)", () => {
  it("reads quotes, a BOM, commas or semicolons", () => {
    expect(parseCsv(EN)[1]![3]).toBe("1,204.50");
    expect(parseCsv(AR)[0]).toHaveLength(4);
  });
  it("guesses the columns in English and in Arabic", () => {
    expect(guessMapping(parseCsv(EN)[0]!)).toMatchObject({ day: 0, adId: 1, adName: 2, spend: 3, impressions: 4, reach: 5, linkClicks: 6, lpv: 7, purchases: 8 });
    expect(guessMapping(parseCsv(AR)[0]!)).toMatchObject({ day: 0, adId: 1, spend: 2, impressions: 3 });
  });
  it("dates: ISO, day/month, month/day when the day is > 12", () => {
    expect(toDay("2026-10-20")?.toISOString().slice(0, 10)).toBe("2026-10-20");
    expect(toDay("25/10/2026")?.toISOString().slice(0, 10)).toBe("2026-10-25");
    expect(toDay("10/25/2026")?.toISOString().slice(0, 10)).toBe("2026-10-25");
    expect(toDay("yesterday")).toBeNull();
  });
  it("rows: numbers with thousands, a total line skipped, a missing column said", () => {
    const t = parseCsv(EN);
    const { rows, errors } = readRows(t, guessMapping(t[0]!));
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ adId: "120211000000001", spend: 1204.5, impressions: 50000, purchases: 40 });
    expect(readRows(t, { day: 0 }).errors[0]).toContain("المبلغ المصروف");
  });
  it("the same ad and day twice: one row, and it says so", () => {
    const t = parseCsv("Day,Ad ID,Amount spent,Impressions\n2026-10-20,1,5,100\n2026-10-20,1,6,120\n");
    const r = readRows(t, guessMapping(t[0]!));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.spend).toBe(6);
    expect(r.errors[0]).toContain("مكرر");
  });
});
