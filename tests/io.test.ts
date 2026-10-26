import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { restoreOrder } from "@/ops/backup";
import { buildWorkbook } from "@/io/export";
import { sendTelegram, splitMessage } from "@/adapters/telegram";
import { attributionOf, toAttributedOrder, OmsOrder } from "@/adapters/oms";

describe("Excel export (T1.10)", () => {
  it("has the truth sheet and a sheet explaining every indicator", async () => {
    const buf = await buildWorkbook([{ level: "إعلان", name: "CR00147_H07_HER_LP1", spend: 121.2, orders: 30, confirmed: 22, delivered: 16, costPerConfirmed: 5.51, ceiling: 6.64, confirmRate: 0.733, deliveryRate: 0.762, profit: 107.77, roas: 2.21 }], "test");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(buf) as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["الحقيقة", "شرح المؤشرات"]);
    expect(wb.getWorksheet("الحقيقة")!.getRow(3).getCell(7).value).toBe(5.51);
    const help = wb.getWorksheet("شرح المؤشرات")!;
    const names = help.getColumn(1).values.filter(Boolean);
    expect(names).toContain("تكلفة الطلب المؤكد");
  });
});

describe("Telegram", () => {
  it("splits long reports on line breaks under the limit", () => {
    const parts = splitMessage(Array.from({ length: 300 }, (_, i) => `سطر ${i} `.repeat(4)).join("\n"), 1000);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 1000)).toBe(true);
  });
  it("sends to the owner's chat only", async () => {
    const f = vi.fn().mockResolvedValue(new Response("{}"));
    await sendTelegram({ token: "123:abc", chatId: "42", fetch: f as unknown as typeof fetch }, "تقرير");
    expect(JSON.parse(f.mock.calls[0]![1].body)).toMatchObject({ chat_id: "42", text: "تقرير" });
  });
});

describe("OMS orders (spec 9.2)", () => {
  const base = OmsOrder.parse({ order_id: "77812", product_code: "TRF01", country: "SY", channel: "website", ad_id: "120211", ad_name: "CR00147_H07_HER_LP1", status: "confirmed", created_at: "2026-10-26T06:00:00+03:00", order_value: "20.00", currency: "USD" });
  it("ties an order to its ad, best method first", () => {
    expect(attributionOf(base)).toEqual({ method: "ad_id", creativeCode: "CR00147" });
    expect(attributionOf({ ...base, ad_id: null })).toEqual({ method: "naming", creativeCode: "CR00147" });
    expect(attributionOf({ ...base, ad_id: null, ad_name: null })).toEqual({ method: "none", creativeCode: null });
  });
  it("matures after the confirm window", () => {
    expect(toAttributedOrder(base, 24).matureAt.toISOString()).toBe("2026-10-27T03:00:00.000Z");
  });
  it("refuses a phone-like value in a public field", () => {
    expect(() => toAttributedOrder({ ...base, ad_name: "اتصل 0944123456" }, 24)).toThrow(/refused/);
  });
});

describe("the restore order (spec 17.4)", () => {
  it("every table comes after the tables it points to, and none is missing", () => {
    const models = Prisma.dmmf.datamodel.models;
    const order = restoreOrder(models).map((m) => m.name);
    expect(order).toHaveLength(models.length);
    expect(order.indexOf("AdAccount")).toBeLessThan(order.indexOf("Campaign"));
    expect(order.indexOf("Campaign")).toBeLessThan(order.indexOf("AdSet"));
    expect(order.indexOf("AdSet")).toBeLessThan(order.indexOf("Ad"));
    expect(order.indexOf("ChangeSet")).toBeLessThan(order.indexOf("ChangeItem"));
    expect(order.indexOf("CreativeAsset")).toBeLessThan(order.indexOf("ThumbnailCandidate"));
  });
});
