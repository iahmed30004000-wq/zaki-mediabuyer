import { describe, expect, it } from "vitest";
import { judgeCapacity, CAPACITY_DEFAULTS, type CapacityReading } from "@/core/replies";
import { readCapacity } from "@/adapters/replies";
import { detect, type AlertFacts } from "@/core/alerts";

const now = new Date("2026-11-04T12:00:00Z");
const fine: CapacityReading = { unanswered: 12, firstResponseP50Min: 6, byChannel: { whatsapp: 9, messenger: 3 }, at: new Date("2026-11-04T11:50:00Z") };

describe("replies capacity (spec 9.3 · 9.8 · T2.4)", () => {
  it("a calm inbox lets message campaigns scale", () => expect(judgeCapacity(fine, 0, CAPACITY_DEFAULTS, now)).toEqual({ ok: true, cause: null, sentence: null }));
  it("the replies system not answering is the worst case: held", () => expect(judgeCapacity(null, null, CAPACITY_DEFAULTS, now)).toMatchObject({ ok: false, cause: "down" }));
  it("a reading older than the limit is held even if the numbers were good", () => {
    expect(judgeCapacity({ ...fine, at: new Date("2026-11-04T08:00:00Z") }, 0, CAPACITY_DEFAULTS, now)).toMatchObject({ ok: false, cause: "stale" });
    expect(judgeCapacity(fine, 5, CAPACITY_DEFAULTS, now)).toMatchObject({ ok: false, cause: "stale" });
  });
  it("too many unanswered, or a slow first answer, holds it — with the numbers in the sentence", () => {
    const behind = judgeCapacity({ ...fine, unanswered: 80 }, 0, CAPACITY_DEFAULTS, now);
    expect(behind).toMatchObject({ ok: false, cause: "behind" });
    expect(behind.sentence).toContain("80");
    expect(judgeCapacity({ ...fine, firstResponseP50Min: 45 }, 0, CAPACITY_DEFAULTS, now)).toMatchObject({ ok: false, cause: "slow" });
  });
  it("a missing median does not hold by itself", () => expect(judgeCapacity({ ...fine, firstResponseP50Min: null }, 0, CAPACITY_DEFAULTS, now).ok).toBe(true));
  it("the limits are the owner's: a stricter one holds a reading the default allows", () => expect(judgeCapacity(fine, 0, { ...CAPACITY_DEFAULTS, maxUnanswered: 10 }, now).ok).toBe(false));
});

describe("replies adapter", () => {
  const answer = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const opts = (f: typeof fetch) => ({ baseUrl: "https://replies.example/", token: "t", fetch: f });
  it("reads the contract shape", async () => {
    const r = await readCapacity(opts(answer({ unanswered: 37, first_response_p50_min: 6, by_channel: { whatsapp: 30, messenger: 7 }, at: "2026-11-04T11:50:00Z" })));
    expect(r).toMatchObject({ unanswered: 37, firstResponseP50Min: 6, byChannel: { whatsapp: 30, messenger: 7 } });
    expect(r.at.toISOString()).toBe("2026-11-04T11:50:00.000Z");
  });
  it("sends the bearer token to /api/v1/capacity and nothing else", async () => {
    let seen: { url: string; auth: string | null } | null = null;
    const f = (async (url: string, init: RequestInit) => {
      seen = { url, auth: new Headers(init.headers).get("authorization") };
      return new Response(JSON.stringify({ unanswered: 0, at: "2026-11-04T11:50:00Z" }));
    }) as unknown as typeof fetch;
    await readCapacity(opts(f));
    expect(seen).toEqual({ url: "https://replies.example/api/v1/capacity", auth: "Bearer t" });
  });
  it("refuses an answer with fields it does not know (a customer's name would be one)", async () => {
    await expect(readCapacity(opts(answer({ unanswered: 1, at: "2026-11-04T11:50:00Z", customer_name: "x" })))).rejects.toThrow();
  });
  it("a failing system is an error, not a silent zero", async () => {
    await expect(readCapacity(opts(answer({}, 503)))).rejects.toThrow(/503/);
  });
});

describe("the alert", () => {
  const calm: AlertFacts = { hour: 15, adsets: [], pixelPurchasesToday: 0, webOrdersToday: 0, cpmToday: null, impressionsToday: 0, cpm7: [], metaLinked: false, omsLinked: false, metaAgeHours: null, omsAgeHours: null, attributedPct: null, capiRejectedLastHour: 0, tokenDaysLeft: null };
  it("says it only when the replies system gave a problem", () => {
    expect(detect(calm)).toEqual([]);
    expect(detect({ ...calm, repliesProblem: "80 رسالة بلا رد" }).map((s) => s.key)).toEqual(["replies"]);
  });
});
