import { describe, expect, it } from "vitest";
import { checkRows } from "@/core/push-rows";
import { detectDelimiter, fieldOf, parsePaste, readDate, readNumber, splitLine } from "@/core/paste-parse";

const ctx = { day: "2026-11-14", level: "ad" as const };

describe("numbers as people write them", () => {
  it("reads plain, grouped, decimal-comma, money, percent and Arabic-digit numbers", () => {
    const cases: [string, number][] = [["5", 5], ["12.5", 12.5], ["1,234", 1234], ["1,234,567", 1234567], ["1,234.50", 1234.5], ["1.234,50", 1234.5], ["12,5", 12.5], ["1.234.567", 1234567], ["$12", 12], ["12%", 12], ["1 234", 1234], ["٣٬٤٥٠", 3450], ["٣٬٤٥٠٫٥", 3450.5], ["١٢٫٥", 12.5], ["USD 7", 7], ["-3", -3]];
    for (const [raw, n] of cases) expect(readNumber(raw), raw).toBe(n);
  });
  it("says null for what is not a number", () => {
    for (const raw of ["", "-", "—", "N/A", "abc", "1,2,3x", "12abc"]) expect(readNumber(raw), raw).toBeNull();
  });
  it("reads dates year-first or day-first, refuses impossible ones", () => {
    expect(readDate("2026-11-14")).toBe("2026-11-14");
    expect(readDate("14/11/2026")).toBe("2026-11-14");
    expect(readDate("٠٣/١٠/٢٠٢٦")).toBe("2026-10-03");
    expect(readDate("2026-11-14T10:00:00Z")).toBe("2026-11-14");
    for (const bad of ["2026-13-40", "31/02/2026", "tomorrow", "11/2026", ""]) expect(readDate(bad), bad).toBeNull();
  });
});

describe("cells and delimiters", () => {
  it("keeps a quoted comma inside its cell", () => {
    expect(splitLine('a,"b,c",d,"he said ""hi"""', ",")).toEqual(["a", "b,c", "d", 'he said "hi"']);
  });
  it("picks the delimiter that splits the header the most (tab first on a tie)", () => {
    expect(detectDelimiter("a\tb\tc").name).toBe("tab");
    expect(detectDelimiter("a,b,c").name).toBe("comma");
    expect(detectDelimiter("a;b;c").name).toBe("semicolon");
    expect(detectDelimiter("a|b").name).toBe("pipe");
    expect(detectDelimiter("alone").name).toBe("none");
  });
});

describe("headers", () => {
  it("know Ads Manager's English names and the Arabic ones, ignoring brackets and case", () => {
    expect(fieldOf("Amount spent (USD)")).toBe("spend");
    expect(fieldOf("CTR (link click-through rate)")).toBe("ctr");
    expect(fieldOf("CPM (cost per 1,000 impressions)")).toBe("cpm");
    expect(fieldOf("Ad ID")).toBe("id:ad");
    expect(fieldOf("المبلغ المنفق")).toBe("spend");
    expect(fieldOf("مرات الظهور")).toBe("impressions");
    expect(fieldOf("Reporting starts")).toBe("date");
    expect(fieldOf("Something odd")).toBeNull();
  });
});

describe("a whole paste", () => {
  const csv = ["Day,Ad ID,Ad name,Amount spent (USD),Impressions,Link clicks,Purchases,Delivery", "2026-11-13,120001,TIN_V01_hook,12.50,\"3,400\",85,2,active", "2026-11-13,120002,TIN_V02_hook,٧٫٥,1200,30,0,paused"].join("\n");

  it("turns an Ads Manager export into metric rows the push accepts", () => {
    const r = parsePaste(csv, ctx);
    expect(r.delimiter).toBe("comma");
    expect(r.issues).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]!.row).toEqual({ date: "2026-11-13", level: "ad", id: "120001", name: "TIN_V01_hook", spend: 12.5, impressions: 3400, link_clicks: 85, pixel_purchases: 2, status: "active" });
    expect(r.rows[1]!.row).toMatchObject({ spend: 7.5, impressions: 1200 });
    const checked = checkRows(r.rows.map((x) => x.row));
    expect(checked.problems).toEqual([]);
    expect(checked.rows).toHaveLength(2);
  });

  it("reads a table copied from a sheet (tabs) and uses the chosen day when there is no date column", () => {
    const r = parsePaste("Campaign ID\tCampaign name\tAmount spent\n555\tCMP one\t$20\n", { day: "2026-11-14", level: "ad" });
    expect(r.delimiter).toBe("tab");
    expect(r.rows[0]!.row).toEqual({ date: "2026-11-14", level: "campaign", id: "555", name: "CMP one", spend: 20 });
    expect(r.mapped.map((m) => m.field)).toEqual(["id", "name", "spend"]);
  });

  it("an export with several id columns: the most specific is the row's id, the level above is its parent, the account is the account", () => {
    const r = parsePaste("Account ID,Campaign ID,Ad set ID,Ad ID,Amount spent\nact_9,C1,S1,A1,5\nact_9,C1,S2,A2,6", { day: "2026-11-14", level: "campaign" });
    expect(r.issues).toEqual([]);
    expect(r.rows[0]!.row).toEqual({ date: "2026-11-14", level: "ad", id: "A1", parent_id: "S1", account_id: "act_9", spend: 5 });
    expect(r.unmapped).toEqual(["Campaign ID"]);
    expect(checkRows(r.rows.map((x) => x.row)).problems).toEqual([]);
    const c = parsePaste("Account ID,Campaign ID,Campaign name,Amount spent\nact_9,C1,One,5", { day: "2026-11-14", level: "ad" });
    expect(c.rows[0]!.row).toEqual({ date: "2026-11-14", level: "campaign", id: "C1", parent_id: "act_9", name: "One", spend: 5 });
    const s = parsePaste("Campaign ID,Ad set ID,Ad set name\nC1,S1,Two", ctx);
    expect(s.rows[0]!.row).toMatchObject({ level: "adset", id: "S1", parent_id: "C1" });
  });

  it("lists the columns it does not know and leaves them out", () => {
    const r = parsePaste("Ad ID,Amount spent,Quality ranking\n1,5,above average", ctx);
    expect(r.unmapped).toEqual(["Quality ranking"]);
    expect(r.rows[0]!.row).not.toHaveProperty("Quality ranking");
  });

  it("says per line what it could not read, and still reads the other lines", () => {
    const r = parsePaste("Ad ID,Amount spent,Impressions\n1,abc,10\n2,5,10.5\n3,4,7\n,5,5", ctx);
    expect(r.rows.map((x) => x.row.id)).toEqual(["3"]);
    expect(r.issues.map((i) => i.line)).toEqual([2, 3, 5]);
    expect(r.issues[0]!.error).toContain("Amount spent");
    expect(r.issues[1]!.error).toContain("عدد صحيح");
    expect(r.issues[2]!.error).toContain("بلا معرّف");
  });

  it("never makes up an id: no id column is one clear problem, no rows", () => {
    const r = parsePaste("Ad name,Amount spent\nTIN_V01,5", ctx);
    expect(r.rows).toEqual([]);
    expect(r.issues[0]!.error).toContain("معرّف");
  });

  it("a negative number, an impossible date and a name carrying a phone number are refused (the last by the push check)", () => {
    const r = parsePaste("Day,Ad ID,Ad name,Amount spent\n2026-13-40,1,x,5\n2026-11-14,2,x,-5\n2026-11-14,3,call 0791234567,5", ctx);
    expect(r.rows).toHaveLength(1);
    expect(r.issues.map((i) => i.line)).toEqual([2, 3]);
    expect(checkRows(r.rows.map((x) => x.row)).problems).toHaveLength(1);
  });

  it("refuses an empty paste, a header with no delimiter, and a paste that is too long", () => {
    expect(parsePaste("", ctx).issues[0]!.error).toContain("الصق");
    expect(parsePaste("only one line", ctx).issues[0]!.error).toContain("الصق");
    expect(parsePaste("just words\nmore words", ctx).issues[0]!.error).toContain("عناوين");
    const many = "Ad ID,Amount spent\n" + Array.from({ length: 501 }, (_, i) => `${i},1`).join("\n");
    expect(parsePaste(many, ctx).issues[0]!.error).toContain("500");
    expect(parsePaste("x".repeat(200_001), ctx).issues[0]!.error).toContain("طويل");
  });
});
