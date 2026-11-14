import { describe, expect, it } from "vitest";
import { MetricRow, StockRow, VideoRow, checkRows, daysRunning, insightPatch, normalizeStatus, parseStart, planOrders, pushedOrderId, refuseIfPrivate, type MetricRowT } from "@/core/push-rows";

const row = (x: Partial<MetricRowT> = {}): MetricRowT => ({ date: "2026-11-14", level: "ad", id: "120200000000000001", ...x });

describe("checkRows — what may come in (v4 · A)", () => {
  it("takes a row with only the three keys that say which object and which day", () => {
    const { rows, problems } = checkRows([row()]);
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  it("refuses a key the schema does not know — a customer field included — and says which", () => {
    const { rows, problems } = checkRows([row(), { ...row(), phone: "0912345678" }, { ...row(), customer_name: "x" }]);
    expect(rows.map((r) => r.index)).toEqual([0]);
    expect(problems.map((p) => p.index)).toEqual([1, 2]);
    expect(problems[0]!.error).toContain("phone");
  });

  it("refuses a phone, an e-mail or a key inside a text field", () => {
    for (const name of ["اتصل 0912345678", "a@b.com", "Bearer abcdefghijklmnopqrstuvwxyz"]) {
      const { rows, problems } = checkRows([row({ name })]);
      expect(rows, name).toHaveLength(0);
      expect(problems[0]!.error, name).toContain("انرفض");
    }
  });

  it("does not mistake a Meta id (15–18 digits) or a campaign name for a phone", () => {
    const { rows, problems } = checkRows([row({ id: "120210000012345678", name: "SY_TRF01_WEB_CRT_261026", parent_id: "23851234567890123", account_id: "act_000000000000001" })]);
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  it("refuses a date that does not exist, and a negative number", () => {
    expect(checkRows([row({ date: "2026-02-30" })]).problems[0]!.error).toContain("تاريخ");
    expect(checkRows([row({ spend: -1 })]).problems).toHaveLength(1);
    expect(checkRows([{ ...row(), date: "14/11/2026" }]).problems).toHaveLength(1);
  });

  it("takes real orders only for an ad or a product", () => {
    expect(checkRows([row({ real_orders: 3 })]).problems).toEqual([]);
    expect(checkRows([row({ level: "product", id: "TRF01", real_orders: 3 })]).problems).toEqual([]);
    expect(checkRows([row({ level: "campaign", real_orders: 3 })]).problems[0]!.error).toContain("real_orders");
  });

  it("keeps the good rows and returns the index of each bad one", () => {
    const { rows, problems } = checkRows([row({ id: "a" }), "not an object", row({ id: "b", spend: 5 })]);
    expect(rows.map((r) => r.index)).toEqual([0, 2]);
    expect(problems.map((p) => p.index)).toEqual([1]);
  });

  it("is a closed schema", () => {
    expect(MetricRow.safeParse({ ...row(), extra: 1 }).success).toBe(false);
  });
});

describe("insightPatch — only what was sent, or what can be computed", () => {
  it("is null for a row that carries no delivery number (so an update never zeroes what is there)", () => {
    expect(insightPatch(row({ name: "x", status: "ACTIVE", budget_daily: 20 }))).toBeNull();
    expect(insightPatch(row({ real_orders: 4 }))).toBeNull();
  });

  it("carries exactly the fields that were sent", () => {
    expect(insightPatch(row({ spend: 12.345, pixel_purchases: 3 }))).toEqual({ spend: 12.35, purchases: 3 });
  });

  it("computes impressions from spend and CPM, clicks from impressions and CTR, frequency from impressions and reach", () => {
    const p = insightPatch(row({ spend: 10, cpm: 5, ctr: 2 }))!;
    expect(p.impressions).toBe(2000);
    expect(p.linkClicks).toBe(40);
    expect(insightPatch(row({ impressions: 3000, reach: 1000 }))!.frequency).toBe(3);
  });

  it("never overrides a number that was sent with a computed one", () => {
    const p = insightPatch(row({ spend: 10, cpm: 5, impressions: 5000, link_clicks: 7, ctr: 50 }))!;
    expect(p.impressions).toBe(5000);
    expect(p.linkClicks).toBe(7);
  });

  it("does not invent anything from a CPM of zero or without a spend", () => {
    expect(insightPatch(row({ cpm: 0, spend: 10 }))).toEqual({ spend: 10 });
    expect(insightPatch(row({ cpm: 4 }))).toBeNull();
  });
});

describe("days running and dates", () => {
  const now = new Date("2026-11-14T10:00:00Z");
  it("counts the day it started as day 1", () => {
    expect(daysRunning(new Date("2026-11-14T00:30:00Z"), now)).toBe(1);
    expect(daysRunning(new Date("2026-11-11T23:00:00Z"), now)).toBe(4);
  });
  it("is null when the start is unknown, and never below 1", () => {
    expect(daysRunning(null, now)).toBeNull();
    expect(daysRunning(new Date("2026-12-01T00:00:00Z"), now)).toBe(1);
  });
  it("reads Meta's start_time or a plain date, and nothing else", () => {
    expect(parseStart("2026-11-11T08:00:00+0200")?.toISOString()).toBe("2026-11-11T06:00:00.000Z");
    expect(parseStart("2026-11-11")?.toISOString()).toBe("2026-11-11T00:00:00.000Z");
    expect(parseStart("soon")).toBeNull();
    expect(parseStart(undefined)).toBeNull();
  });
  it("speaks Meta's statuses however they are spelled", () => {
    expect(normalizeStatus("paused")).toBe("PAUSED");
    expect(normalizeStatus(" Campaign Paused ")).toBe("CAMPAIGN_PAUSED");
    expect(normalizeStatus("شغال")).toBe("ACTIVE");
    expect(normalizeStatus(undefined)).toBeUndefined();
  });
});

describe("planOrders — the tally as plain order rows", () => {
  const by = (list: ReturnType<typeof planOrders>) => list.reduce<Record<string, number>>((m, o) => ({ ...m, [o.status]: (m[o.status] ?? 0) + 1 }), {});

  it("makes exactly N orders, most advanced first", () => {
    const list = planOrders({ orders: 10, confirmed: 7, shipped: 5, delivered: 3, returned: 1 }, true);
    expect(list).toHaveLength(10);
    expect(by(list)).toEqual({ returned: 1, delivered: 3, shipped: 1, confirmed: 2, new: 3 });
    expect(list.map((o) => o.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("lets delivered and returned imply shipped, and shipped imply confirmed", () => {
    const list = planOrders({ orders: 6, delivered: 2, returned: 1 }, true);
    expect(by(list)).toEqual({ returned: 1, delivered: 2, new: 3 });
    const shipped = planOrders({ orders: 4, shipped: 3 }, true);
    expect(by(shipped)).toEqual({ shipped: 3, new: 1 });
  });

  it("never exceeds N and never invents an order", () => {
    expect(planOrders({ orders: 3, confirmed: 9, delivered: 9, returned: 9 }, true)).toHaveLength(3);
    expect(planOrders({ orders: 0, confirmed: 5 }, true)).toEqual([]);
    expect(planOrders({ orders: -2 }, true)).toEqual([]);
  });

  it("marks every confirmed order mature; the rest follow the day (all of a finished day, none of a running one)", () => {
    expect(planOrders({ orders: 5, confirmed: 2 }, true).every((o) => o.mature)).toBe(true);
    const today = planOrders({ orders: 5, confirmed: 2 }, false);
    expect(today.filter((o) => o.mature)).toHaveLength(2);
    expect(today.filter((o) => o.mature).every((o) => o.status !== "new")).toBe(true);
  });

  it("takes the mature count that was sent, but never fewer than the confirmed ones", () => {
    expect(planOrders({ orders: 10, confirmed: 4, mature: 8 }, false).filter((o) => o.mature)).toHaveLength(8);
    expect(planOrders({ orders: 10, confirmed: 4, mature: 1 }, false).filter((o) => o.mature)).toHaveLength(4);
  });

  it("spreads the collected cash over the delivered orders only", () => {
    const list = planOrders({ orders: 5, delivered: 2, collected: 41 }, true);
    expect(list.filter((o) => o.collected !== null)).toHaveLength(2);
    expect(list.find((o) => o.status === "delivered")!.collected).toBe(20.5);
    expect(planOrders({ orders: 5, delivered: 2 }, true).every((o) => o.collected === null)).toBe(true);
  });

  it("gives an order the same id every time, and an id no OMS order can have", () => {
    expect(pushedOrderId("ad", "123", "2026-11-14", 2)).toBe("mcp:ad:123:2026-11-14:2");
    expect(pushedOrderId("ad", "123", "2026-11-14", 2)).toBe(pushedOrderId("ad", "123", "2026-11-14", 2));
  });
});

describe("stock, videos and free text", () => {
  it("checks a stock row", () => {
    expect(StockRow.safeParse({ product: "TRF01", units: 120, days_cover: 9.5 }).success).toBe(true);
    expect(StockRow.safeParse({ product: "TRF01" }).success).toBe(false);
    expect(StockRow.safeParse({ product: "TRF01", days_cover: 3, phone: "1" }).success).toBe(false);
  });
  it("checks a video row and its status", () => {
    expect(VideoRow.safeParse({ job: "JOB-12", v_name: "V45", product: "TRF01", status: "ready" }).success).toBe(true);
    expect(VideoRow.safeParse({ job: "JOB-12", v_name: "V45", product: "TRF01", status: "deleted" }).success).toBe(false);
  });
  it("refuses a private text and passes a clean one", () => {
    expect(refuseIfPrivate("كلّم 0912345678")).toContain("انرفض");
    expect(refuseIfPrivate("طلب 4 هوكات للطنين", undefined)).toBeNull();
  });
});
