import { describe, expect, it } from "vitest";
import type { InsightRow, OrderRow } from "@/core/ads-table";
import { addDays, eachDay } from "@/core/dates";
import { mergeBank, type BankItemIn, type BankVideo } from "@/core/video-board";
import { assembleBoard, type BoardCtx, type RequestRowIn } from "@/lib/videos-board";
import type { Source } from "@/lib/ads-table";
import { PRODUCTS, targetsOf } from "@/lib/mock/data";

// 2026-11-15, noon in Amman
const NOW = new Date("2026-11-15T09:00:00Z");
const TODAY = "2026-11-15";
const trf = PRODUCTS.find((p) => p.code === "TRF01")!;

const ins = (id: string, day: string, spend: number): InsightRow => ({ level: "ad", id, day, spend, impressions: 1000, clicks: 20, purchases: 1, v3s: 300, thru: 100, conversations: 0, frequency: 1.5 });
const order = (adId: string, day: string): OrderRow => ({ adId, adSetId: "S1", campaignId: "C1", day, status: "confirmed", matureAt: NOW.getTime() - 86_400_000, messaging: false });

/** `perDay[i]` orders on day today-9+i (10 days: today-9 … today). */
const orders = (adId: string, perDay: number[]): OrderRow[] => eachDay(addDays(TODAY, -9), TODAY).flatMap((day, i) => Array.from({ length: perDay[i] ?? 0 }, () => order(adId, day)));
const spend = (adId: string, daily: number) => eachDay(addDays(TODAY, -9), TODAY).map((day) => ins(adId, day, daily));

const source = (): Source => ({
  demo: false,
  products: [trf],
  campaigns: [
    {
      id: "C1", name: "SY_TRF01_WEB_SCALE_261012_C01", status: "active", market: "SY", productCode: "TRF01", stage: "SCALE", namingOk: true, budget: null, start: "2026-11-01T08:00:00+03:00",
      adsets: [
        {
          id: "S1", name: "BROAD_ADV_SP_CPT0012_v1", status: "active", pageCode: "SP", budget: 40, start: "2026-11-01T08:00:00+03:00",
          ads: [
            { id: "A1", name: "SY|TRF01|V215_H2", status: "active", start: "2026-11-06T08:00:00+03:00" },
            { id: "A2", name: "SY|TRF01|V216", status: "active", start: null },
            { id: "A3", name: "CR00147_H07_HER_LP1", status: "active", start: null },
            { id: "A4", name: "حملة قديمة بلا رقم فيديو", status: "active", start: null },
          ],
        },
      ],
    },
  ],
  insights: [...spend("A1", 10), ...spend("A2", 10), ...spend("A3", 3), ...spend("A4", 50)],
  orders: [
    // V215: 2 a day in the base, 1 a day over the last two days (the cost doubles), 1 today
    ...orders("A1", [2, 2, 2, 2, 2, 2, 2, 1, 1, 1]),
    // V216: 1 a day — steady
    ...orders("A2", [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
    // CR00147: little spend, a few orders
    ...orders("A3", [0, 0, 0, 0, 0, 0, 1, 0, 1, 0]),
  ],
});

const item = (over: Partial<BankItemIn>): BankItemIn => ({ job: "345", vName: "V215", productCode: "TRF01", driveFileId: null, metaVideoId: null, scenarioFileId: null, status: "testing", notes: null, ...over });

const bank = (): BankVideo[] =>
  mergeBank(
    [
      item({ driveFileId: "1AbC_def-GHI234", scenarioFileId: "1ScEnArIo_file9" }),
      item({ job: "346", vName: "V216", driveFileId: "bad id/with space" }),
      item({ job: "400", vName: "V300", status: "ready" }),
      item({ job: "401", vName: "V301", status: "dropped" }),
    ],
    [{ crCode: "CR00147", productCode: "TRF01", driveFileId: null, metaVideoId: null, status: "live", dupOf: null, notes: null }],
  );

const request = (over: Partial<RequestRowIn>): RequestRowIn => ({ id: "r1", videoKey: "345|V215", productCode: "TRF01", kind: "new_hooks", status: "asked", via: "none", job: "345", vName: "V215", crCode: null, createdAt: new Date("2026-11-15T05:00:00Z"), deliveryError: null, resultNote: null, ...over });

const ctx = (over: Partial<BoardCtx> = {}): BoardCtx => ({ target: 3, typedMinSpend: 30, breakeven: (c) => (c === "TRF01" ? 8 : null), hermes: { api: false, chat: false }, ...over });
const build = (o: { ctx?: Partial<BoardCtx>; requests?: RequestRowIn[]; bank?: BankVideo[] } = {}) => assembleBoard(source(), o.bank ?? bank(), o.requests ?? [], NOW, ctx(o.ctx));
const trfBoard = (o: Parameters<typeof build>[0] = {}) => build(o).products.find((p) => p.code === "TRF01")!;

describe("assembleBoard — a product's videos", () => {
  const p = trfBoard();

  it("ranks the videos that spent enough by the cost of a real order, cheapest first", () => {
    expect(p.winners.map((v) => v.key)).toEqual(["345|V215", "346|V216"]);
    const [a, b] = p.winners;
    // V215: 7 days of 10$ (+1% fee) over 11 orders · V216: the same spend over 7
    expect(a!.spend).toBe(70.7);
    expect(a!.orders).toBe(11);
    expect(a!.costPerOrder).toBe(6.43);
    expect(b!.orders).toBe(7);
    expect(b!.costPerOrder).toBe(10.1);
  });

  it("a video below the minimum spend is still being judged, not ranked", () => {
    expect(p.learning.map((v) => v.key)).toEqual(["CR00147"]);
    expect(p.learning[0]!.spend).toBe(21.21);
    expect(p.minSpend).toBe(30);
    expect(p.minSpendFrom).toBe("typed");
  });

  it("without a typed minimum it is twice the cost the owner aims for per order", () => {
    const q = trfBoard({ ctx: { typedMinSpend: null } });
    expect(q.minSpendFrom).toBe("target");
    expect(q.minSpend).toBe(Math.round(2 * targetsOf(trf).tOrder * 100) / 100);
  });

  it("a video no ad runs is waiting its turn, and a dropped one is out of sight", () => {
    expect(p.rest.map((v) => v.key)).toEqual(["400|V300"]);
    expect(p.rest[0]!.status).toBe("ready");
  });

  it("the bank is everything not dropped, against 50", () => {
    expect(p.bank.count).toBe(4);
    expect(p.bank.target).toBe(50);
    expect(p.bank.short).toBe(46);
  });

  it("the ad that names no video belongs to none — its spend is nobody's", () => {
    const all = [...p.winners, ...p.learning, ...p.rest];
    expect(all.reduce((n, v) => n + v.adsCount, 0)).toBe(3);
  });

  it("the cost wears its colour against the owner's numbers", () => {
    const [a, b] = p.winners;
    expect(a!.tone).toBe("warn"); // above the target of 3$, under the break-even of 8$
    expect(b!.tone).toBe("danger"); // above the break-even
  });

  it("the tired signal comes from the video's own days: +100% over its own average", () => {
    const [a, b] = p.winners;
    expect(a!.fatigue.state).toBe("tired");
    expect(a!.fatigue.rise).toBe(1);
    expect(b!.fatigue.state).toBe("ok");
    expect(p.tiredCount).toBe(1);
  });

  it("days running count from the earliest of its ads' starts — an ad with none of its own takes its ad set's", () => {
    expect(p.winners[0]!.days).toBe(10); // 2026-11-06 … 2026-11-15
    expect(p.winners[1]!.days).toBe(15); // the ad set started on 2026-11-01
    expect(p.rest[0]!.days).toBeNull(); // no ad runs it
  });

  it("hook, hold and CTR are the ads table's numbers over the same days", () => {
    const a = p.winners[0]!;
    expect(a.hook).toBe(30); // 300 ÷ 1000
    expect(a.hold).toBe(33.33); // 100 ÷ 300
    expect(a.ctr).toBe(2);
  });
});

describe("assembleBoard — Drive links", () => {
  const p = trfBoard();
  it("a real file id makes a preview and a scenario link, a bad one makes nothing", () => {
    const a = p.winners.find((v) => v.key === "345|V215")!;
    expect(a.previewUrl).toBe("https://drive.google.com/file/d/1AbC_def-GHI234/preview");
    expect(a.videoUrl).toBe("https://drive.google.com/file/d/1AbC_def-GHI234/view");
    expect(a.scenarioUrl).toBe("https://drive.google.com/file/d/1ScEnArIo_file9/view");
    const b = p.winners.find((v) => v.key === "346|V216")!;
    expect(b.previewUrl).toBeNull();
    expect(b.scenarioUrl).toBeNull();
  });
});

describe("assembleBoard — requests", () => {
  it("an open request sits on its video and on its product", () => {
    const p = trfBoard({ requests: [request({})] });
    expect(p.winners[0]!.request).toMatchObject({ id: "r1", kind: "new_hooks", status: "asked", statusLabel: "طلب" });
    expect(p.requests).toHaveLength(1);
  });

  it("a request that is done is not on the board any more", () => {
    const p = trfBoard({ requests: [request({ status: "uploaded" }), request({ id: "r2", status: "cancelled" })] });
    expect(p.winners[0]!.request).toBeNull();
    expect(p.requests).toHaveLength(0);
  });

  it("the latest open request of a video wins", () => {
    const p = trfBoard({ requests: [request({ id: "old", createdAt: new Date("2026-11-14T05:00:00Z") }), request({ id: "new", kind: "tired", status: "with_hermes" })] });
    expect(p.winners[0]!.request).toMatchObject({ id: "new", kind: "tired", status: "with_hermes" });
  });
});

describe("assembleBoard — the whole board", () => {
  it("counts what is on it", () => {
    const board = build({ requests: [request({})] });
    expect(board.totals).toEqual({ videos: 4, winners: 2, tired: 1, openRequests: 1 });
    expect(board.demo).toBe(false);
    expect(board.today).toBe(TODAY);
  });

  it("a product with ads but no video in the bank still shows, at 0 of 50", () => {
    const board = build({ bank: [] });
    const p = board.products.find((x) => x.code === "TRF01")!;
    expect(p.bank).toMatchObject({ count: 0, short: 50 });
    expect(p.winners).toHaveLength(0);
  });

  it("nothing about policy or a customer is on a video", () => {
    const json = JSON.stringify(build().products);
    expect(json).not.toMatch(/policy|phone|capiRef/i);
  });
});
