import { describe, expect, it } from "vitest";
import {
  BANK_TARGET,
  FATIGUE,
  assetState,
  bankSummary,
  buildPayload,
  canMoveRequest,
  containsToken,
  driveId,
  drivePreviewUrl,
  fatigueOf,
  isOpenRequest,
  linkAds,
  mergeBank,
  minSpendOf,
  rank,
  requestText,
  requestTitle,
  taskStatusOf,
  videoLabel,
  type AdRef,
  type AssetIn,
  type BankItemIn,
  type DayPoint,
  type RequestNumbers,
} from "@/core/video-board";
import { addDays } from "@/core/dates";

const TODAY = "2026-11-15";

const item = (over: Partial<BankItemIn> = {}): BankItemIn => ({ job: "345", vName: "V215", productCode: "TRF01", driveFileId: null, metaVideoId: null, scenarioFileId: null, status: "bank", notes: null, ...over });
const asset = (over: Partial<AssetIn> = {}): AssetIn => ({ crCode: "CR00147", productCode: "TRF01", driveFileId: null, metaVideoId: null, status: "ready", dupOf: null, notes: null, ...over });

describe("the bank: the owner's list and the registry as one", () => {
  it("the same Drive file in both is ONE video — the owner's numbering plus the CR code", () => {
    const out = mergeBank([item({ driveFileId: "drive-file-1" })], [asset({ driveFileId: "drive-file-1", status: "live" })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: "345|V215", job: "345", vName: "V215", crCode: "CR00147", status: "testing" });
  });

  it("the same Meta video id ties them too", () => {
    const out = mergeBank([item({ metaVideoId: "9001" })], [asset({ metaVideoId: "9001" })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.crCode).toBe("CR00147");
  });

  it("the bank's own status wins once it says more than «بالبنك»", () => {
    const out = mergeBank([item({ driveFileId: "d1", status: "winner" })], [asset({ driveFileId: "d1", status: "ready" })]);
    expect(out[0]!.status).toBe("winner");
  });

  it("a video only the registry knows is its own row, keyed by its CR code", () => {
    const out = mergeBank([item()], [asset({ crCode: "CR00152", driveFileId: "other" })]);
    expect(out.map((v) => v.key).sort()).toEqual(["345|V215", "CR00152"]);
    expect(out.find((v) => v.key === "CR00152")).toMatchObject({ job: null, vName: null, status: "ready" });
  });

  it("a duplicate in the registry drops the video from the bank — never deleted, just not counted", () => {
    const out = mergeBank([], [asset({ dupOf: "CR00100" })]);
    expect(out[0]!.status).toBe("dropped");
    expect(bankSummary(out).count).toBe(0);
  });

  it("the registry's statuses are read in the bank's words", () => {
    expect(assetState("inbox", null)).toBe("bank");
    expect(assetState("review", null)).toBe("bank");
    expect(assetState("live", null)).toBe("testing");
    expect(assetState("paused", null)).toBe("testing");
    expect(assetState("dead", null)).toBe("dropped");
    expect(assetState("excluded", null)).toBe("dropped");
    expect(assetState("something-new", null)).toBe("bank");
  });

  it("an unknown status from a pushed row is «بالبنك», not a crash", () => {
    expect(mergeBank([item({ status: "who-knows" })], [])[0]!.status).toBe("bank");
  });
});

describe("the bank against its target", () => {
  const states = (list: string[]) => list.map((status) => ({ status })) as { status: "bank" }[];
  it("counts everything that is not dropped, against 50", () => {
    const s = bankSummary(states(["bank", "bank", "testing", "winner", "dropped"]));
    expect(s).toMatchObject({ count: 4, target: BANK_TARGET, pct: 8, short: 46 });
    expect(s.byState).toEqual({ bank: 2, testing: 1, winner: 1 });
  });

  it("is full at the target and never above 100%", () => {
    const s = bankSummary(states(Array.from({ length: 57 }, () => "bank")));
    expect(s).toMatchObject({ count: 57, pct: 100, short: 0 });
  });

  it("an empty bank is 0 of 50", () => {
    expect(bankSummary([])).toMatchObject({ count: 0, pct: 0, short: 50 });
  });
});

describe("a name carries a video only as a whole token", () => {
  it("V21 is not inside V215; V215 is inside a name with separators", () => {
    expect(containsToken("SY|TRF01|V215_H2|LP1", "V215")).toBe(true);
    expect(containsToken("SY|TRF01|V215_H2|LP1", "V21")).toBe(false);
    expect(containsToken("xV215", "V215")).toBe(false);
    expect(containsToken("v215 كمأة", "V215")).toBe(true);
  });

  it("a one-letter needle never matches", () => {
    expect(containsToken("V 1", "V")).toBe(false);
  });
});

describe("which ads belong to which video", () => {
  const videos = [
    { key: "345|V215", product: "TRF01", crCode: null, vName: "V215" },
    { key: "346|V21", product: "TRF01", crCode: null, vName: "V21" },
    { key: "CR00147", product: "TRF01", crCode: "CR00147", vName: null },
    { key: "400|V215", product: "TIN01", crCode: null, vName: "V215" },
  ];
  const ad = (id: string, name: string, over: Partial<AdRef> = {}): AdRef => ({ id, name, creativeCode: null, product: "TRF01", ...over });

  it("the CR code of an ad our wizard named is the strongest tie", () => {
    const m = linkAds(videos, [ad("a1", "CR00147_H07_HER_LP1", { creativeCode: "CR00147" })]);
    expect(m.get("CR00147")).toEqual(["a1"]);
  });

  it("a V name in the ad's name ties it — and only the right V", () => {
    const m = linkAds(videos, [ad("a2", "SY|TRF01|V215_H2")]);
    expect(m.get("345|V215")).toEqual(["a2"]);
    expect(m.has("346|V21")).toBe(false);
  });

  it("a video of another product never claims the ad", () => {
    const m = linkAds(videos, [ad("a3", "TIN V215", { product: "TIN01" })]);
    expect(m.get("400|V215")).toEqual(["a3"]);
    expect(m.has("345|V215")).toBe(false);
  });

  it("an ad is counted once: it goes to one video only", () => {
    const m = linkAds(videos, [ad("a4", "V215 V21")]);
    const owners = [...m.entries()].filter(([, ids]) => ids.includes("a4"));
    expect(owners).toHaveLength(1);
    expect(owners[0]![0]).toBe("345|V215");
  });

  it("an ad that names no video stays unclaimed", () => {
    expect(linkAds(videos, [ad("a5", "حملة قديمة بلا رقم")]).size).toBe(0);
  });

  it("an ad whose product is unknown can still be tied by its name", () => {
    const m = linkAds(videos, [ad("a6", "V215", { product: null })]);
    expect([...m.keys()]).toHaveLength(1);
  });
});

describe("the tired signal: cost of a real order +30% against its own 7 days", () => {
  /** base days: today-9 … today-3; recent days: today-2, today-1 */
  const series = (base: { spend: number; orders: number }, recent: { spend: number; orders: number }): DayPoint[] => {
    const out: DayPoint[] = [];
    for (let i = 3; i <= 9; i++) out.push({ day: addDays(TODAY, -i), spend: base.spend / 7, orders: base.orders / 7 });
    for (let i = 1; i <= 2; i++) out.push({ day: addDays(TODAY, -i), spend: recent.spend / 2, orders: recent.orders / 2 });
    return out;
  };

  it("+30% or more is tired, and says how far", () => {
    // base: 70$ / 14 orders = 5$ · recent: 13$ / 2 orders = 6.5$ → +30%
    const f = fatigueOf(series({ spend: 70, orders: 14 }, { spend: 13, orders: 2 }), TODAY);
    expect(f.state).toBe("tired");
    expect(f.rise).toBe(0.3);
    expect(f.text).toContain("+30%");
  });

  it("+29% is not tired yet", () => {
    const f = fatigueOf(series({ spend: 70, orders: 14 }, { spend: 12.9, orders: 2 }), TODAY);
    expect(f.state).toBe("ok");
  });

  it("a cheaper order than its average is «ok» and says so", () => {
    const f = fatigueOf(series({ spend: 70, orders: 14 }, { spend: 8, orders: 2 }), TODAY);
    expect(f.state).toBe("ok");
    expect(f.rise).toBeLessThan(0);
    expect(f.text).toContain("أحسن");
  });

  it("spending more than a whole order's cost with no order at all is tired", () => {
    const f = fatigueOf(series({ spend: 70, orders: 14 }, { spend: 6, orders: 0 }), TODAY);
    expect(f.state).toBe("tired");
    expect(f.rise).toBeNull();
  });

  it("spending less than one order's cost with no order is not a verdict yet", () => {
    const f = fatigueOf(series({ spend: 70, orders: 14 }, { spend: 3, orders: 0 }), TODAY);
    expect(f.state).toBe("ok");
  });

  it("fewer than 3 orders in the base is no average: unknown", () => {
    const f = fatigueOf(series({ spend: 20, orders: FATIGUE.minBaseOrders - 1 }, { spend: 30, orders: 1 }), TODAY);
    expect(f.state).toBe("unknown");
  });

  it("no spend in the last 2 days means it is not running — idle, not tired", () => {
    const f = fatigueOf(series({ spend: 70, orders: 14 }, { spend: 0, orders: 0 }), TODAY);
    expect(f.state).toBe("idle");
  });

  it("today's partial day and days older than the base are never read", () => {
    const pts = series({ spend: 70, orders: 14 }, { spend: 10, orders: 2 });
    pts.push({ day: TODAY, spend: 500, orders: 0 }, { day: addDays(TODAY, -10), spend: 500, orders: 0 });
    expect(fatigueOf(pts, TODAY).state).toBe("ok");
  });
});

describe("who ranks as a winner", () => {
  const row = (key: string, spend: number | null, orders: number, costPerOrder: number | null) => ({ key, spend, orders, costPerOrder });

  it("ranks by the cost of a real order, cheapest first, above the minimum spend", () => {
    const r = rank([row("a", 40, 8, 5), row("b", 30, 10, 3), row("c", 35, 7, 4.5)], 20);
    expect(r.ranked.map((x) => x.key)).toEqual(["b", "c", "a"]);
  });

  it("a cheap order below the minimum spend is luck: it is still being judged, not ranked", () => {
    const r = rank([row("lucky", 4, 2, 2), row("steady", 60, 12, 5)], 20);
    expect(r.ranked.map((x) => x.key)).toEqual(["steady"]);
    expect(r.learning.map((x) => x.key)).toEqual(["lucky"]);
  });

  it("a video that spent but got no order yet is being judged", () => {
    const r = rank([row("none", 50, 0, null)], 20);
    expect(r.ranked).toEqual([]);
    expect(r.learning.map((x) => x.key)).toEqual(["none"]);
  });

  it("a video that did not spend at all is idle", () => {
    const r = rank([row("zero", 0, 0, null), row("dash", null, 0, null)], 20);
    expect(r.idle.map((x) => x.key)).toEqual(["dash", "zero"]);
  });

  it("with no minimum known, anything with an order ranks", () => {
    expect(rank([row("a", 1, 1, 1)], null).ranked).toHaveLength(1);
  });

  it("a tie in cost goes to the one with more orders", () => {
    const r = rank([row("few", 20, 4, 5), row("many", 50, 10, 5)], 10);
    expect(r.ranked.map((x) => x.key)).toEqual(["many", "few"]);
  });

  it("the minimum is what the owner typed, else twice his target cost per order, else none", () => {
    expect(minSpendOf(30, 4)).toEqual({ value: 30, from: "typed" });
    expect(minSpendOf(null, 4.25)).toEqual({ value: 8.5, from: "target" });
    expect(minSpendOf(0, 4)).toEqual({ value: 8, from: "target" });
    expect(minSpendOf(null, null)).toEqual({ value: null, from: null });
  });
});

describe("the preview and scenario links", () => {
  it("only a closed alphabet of an id reaches an address", () => {
    expect(driveId("1AbC_def-GHI234")).toBe("1AbC_def-GHI234");
    expect(driveId('x"><script>')).toBeNull();
    expect(driveId("a/b")).toBeNull();
    expect(driveId("ab")).toBeNull();
    expect(driveId(null)).toBeNull();
    expect(drivePreviewUrl("1AbC_def-GHI234")).toBe("https://drive.google.com/file/d/1AbC_def-GHI234/preview");
  });
});

describe("the four buttons and the request's road", () => {
  it("طلب ← عند هيرمز ← جاهز ← مرفوع, and a cancel from any open step", () => {
    expect(canMoveRequest("asked", "with_hermes")).toBe(true);
    expect(canMoveRequest("with_hermes", "ready")).toBe(true);
    expect(canMoveRequest("ready", "uploaded")).toBe(true);
    expect(canMoveRequest("asked", "cancelled")).toBe(true);
    expect(canMoveRequest("ready", "cancelled")).toBe(true);
  });

  it("a finished request does not move again; a ready one can go back to Hermes", () => {
    expect(canMoveRequest("uploaded", "asked")).toBe(false);
    expect(canMoveRequest("cancelled", "asked")).toBe(false);
    expect(canMoveRequest("ready", "with_hermes")).toBe(true);
    expect(canMoveRequest("asked", "uploaded")).toBe(false);
  });

  it("the open steps are the ones that still wait for someone", () => {
    expect(["asked", "with_hermes", "ready"].every((s) => isOpenRequest(s as "asked"))).toBe(true);
    expect(isOpenRequest("uploaded")).toBe(false);
    expect(isOpenRequest("cancelled")).toBe(false);
  });

  it("the task on المهام follows the step", () => {
    expect(taskStatusOf("asked")).toBe("new");
    expect(taskStatusOf("with_hermes")).toBe("doing");
    expect(taskStatusOf("ready")).toBe("waiting_approval");
    expect(taskStatusOf("uploaded")).toBe("done");
    expect(taskStatusOf("cancelled")).toBe("done");
  });

  const v = { vName: "V215", job: "345", crCode: null };
  it("each button gives a title the team understands, with the video's own numbering", () => {
    expect(videoLabel(v)).toBe("V215 · JOB 345");
    expect(videoLabel({ vName: null, job: null, crCode: "CR00147" })).toBe("CR00147");
    expect(requestTitle("new_hooks", v)).toBe("هوكات جديدة على V215 · JOB 345");
    expect(requestTitle("new_script", v)).toContain("سيناريو جديد");
    expect(requestTitle("to_test", v)).toContain("للتيست");
    expect(requestTitle("tired", v)).toContain("تعب");
  });
});

describe("what travels to Hermes", () => {
  const numbers: RequestNumbers = { days: 9, spend: 84.5, orders: 17, costPerOrder: 4.97, hook: 31.2, hold: 22.4, ctr: 1.9, fatigue: "tired", fatigueRise: 0.41 };
  const payload = buildPayload(
    { id: "req1", kind: "new_hooks", product: "TRF01", job: "345", vName: "V215", crCode: null, driveFileId: "1AbC_def-GHI234", scenarioFileId: "1ScEnArIo_file9", numbers, note: "نفس الجسم", askedAt: "2026-11-15T07:00:00.000Z" },
    "https://mediabuyer.example/",
  );

  it("carries the JOB, the scenario file and the numbers", () => {
    expect(payload).toMatchObject({ job: "345", vName: "V215", product: "TRF01", kindLabel: "بدو هوكات جديدة" });
    expect(payload.scenario.url).toBe("https://drive.google.com/file/d/1ScEnArIo_file9/view");
    expect(payload.video.url).toBe("https://drive.google.com/file/d/1AbC_def-GHI234/view");
    expect(payload.numbers.costPerOrder).toBe(4.97);
    expect(payload.reply.claim).toBe("https://mediabuyer.example/api/v1/video-requests/req1/claim");
    expect(payload.reply.complete).toBe("https://mediabuyer.example/api/v1/video-requests/req1/complete");
  });

  it("a file id that is not an id never becomes a link", () => {
    const p = buildPayload({ id: "r", kind: "tired", product: "TRF01", job: null, vName: null, crCode: "CR00147", driveFileId: "bad id/with space", scenarioFileId: null, numbers, note: null, askedAt: "2026-11-15T07:00:00.000Z" }, "https://x.test");
    expect(p.video.url).toBeNull();
    expect(p.scenario.url).toBeNull();
  });

  it("the chat text has the numbers, the links and no customer's detail", () => {
    const text = requestText(payload);
    expect(text).toContain("بدو هوكات جديدة");
    expect(text).toContain("V215 · JOB 345");
    expect(text).toContain("تكلفة الطلب 5$");
    expect(text).toContain("السيناريو: https://drive.google.com/file/d/1ScEnArIo_file9/view");
    expect(text).toContain("تنبيه: الفيديو تعبان");
    expect(text).toContain("رقم الطلب: req1");
    expect(text).not.toMatch(/\+?\d{9,}/);
  });

  it("says plainly when the scenario's file is not linked yet, and when there are no numbers", () => {
    const text = requestText(buildPayload({ id: "r2", kind: "new_script", product: "TIN01", job: "9", vName: "V9", crCode: null, driveFileId: null, scenarioFileId: null, numbers: { ...numbers, spend: null, fatigue: "unknown" }, note: null, askedAt: "2026-11-15T07:00:00.000Z" }, "https://x.test"));
    expect(text).toContain("السيناريو: ما انربط ملفه لسا");
    expect(text).toContain("ما في أرقام لسا");
    expect(text).not.toContain("تنبيه");
  });
});
