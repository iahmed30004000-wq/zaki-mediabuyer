import { beforeAll, describe, expect, it } from "vitest";
import { omsLink } from "@/server/oms-link";
import { encryptSecrets } from "@/server/crypto";
import { lastOmsSync, omsBackoff, omsStale } from "@/jobs/oms-health";
import { MAX_PAGES, readOrders } from "@/adapters/oms";

/**
 * The owner's rule (26/10): «بدنا حل جذري… ما بدنا نخرب ع حالنا». The media buyer may never be the thing that hurts
 * the OMS: local OMS only until he says so, one sync an hour with a back-off on failures, a bounded walk, and the
 * screens fall back to «تقدير» when the OMS is quiet.
 */

const TOKEN = "zk1_" + "B".repeat(43);
beforeAll(() => {
  process.env.ENCRYPTION_KEY = "test-key-that-is-long-enough-0123456789";
});

describe("local first: production stays untouched until the owner says so", () => {
  const sealed = () => encryptSecrets({ token: TOKEN });

  it("a remote OMS is off without OMS_ALLOW_REMOTE=1 — even over https, even with a sealed key", () => {
    const link = omsLink({ OMS_LIVE: "1", OMS_BASE_URL: "https://crm.zakiai.io", OMS_TOKEN_ENC: sealed() });
    expect(link.mode).toBe("off");
    expect(link.mode === "off" && link.why).toMatch(/المحلي/);
  });

  it("the local OMS on this machine is allowed", () => {
    for (const url of ["http://localhost:3001", "http://127.0.0.1:3001", "http://[::1]:3001"]) {
      expect(omsLink({ OMS_LIVE: "1", OMS_BASE_URL: url, OMS_TOKEN_ENC: sealed() }).mode, url).toBe("live");
    }
  });

  it("a look-alike host is not local", () => {
    for (const url of ["http://localhost.evil.test", "http://127.0.0.1.nip.io", "https://localhost@crm.zakiai.io"]) {
      expect(omsLink({ OMS_LIVE: "1", OMS_BASE_URL: url, OMS_TOKEN_ENC: sealed() }).mode, url).toBe("off");
    }
  });
});

const H = 3_600_000;
const at = (h: number) => new Date(Date.UTC(2026, 9, 26, h, 5, 0));
const ok = (h: number) => ({ status: "ok", startedAt: at(h), finishedAt: at(h), stats: { orders: 3 } });
const failed = (h: number) => ({ status: "failed", startedAt: at(h) });
const paused = (h: number) => ({ status: "ok", startedAt: at(h), stats: { skipped: "backoff", backoff: true } });

describe("after a failure it backs off — never a tight loop", () => {
  it("no failure, no wait", () => {
    expect(omsBackoff([ok(9)], at(10))).toMatchObject({ wait: false, failures: 0 });
  });

  it("one failure: the next hour's slot runs (a few hundred ms of drift does not turn one hour into two)", () => {
    expect(omsBackoff([failed(9)], new Date(at(10).getTime() - 300)).wait).toBe(false);
  });

  it("two failures wait 2 h, three wait 4 h, then never more than 8 h", () => {
    expect(omsBackoff([failed(10), failed(9)], at(11)).wait).toBe(true);
    expect(omsBackoff([failed(10), failed(9)], at(12)).wait).toBe(false);
    expect(omsBackoff([paused(12), paused(11), failed(10), failed(9), failed(8)], at(13)).wait).toBe(true);
    expect(omsBackoff([failed(10), failed(9), failed(8)], at(14)).wait).toBe(false);
    const many = Array.from({ length: 10 }, (_, i) => failed(20 - i));
    const back = omsBackoff(many, at(21));
    expect(back.until!.getTime() - at(20).getTime()).toBe(8 * H);
  });

  it("a real sync resets it", () => {
    expect(omsBackoff([ok(11), failed(10), failed(9)], at(12)).failures).toBe(0);
  });
});

describe("when the OMS is quiet, its figures are «تقدير»", () => {
  it("skips and back-offs are not syncs", () => {
    expect(lastOmsSync([paused(12), failed(11), ok(9)])).toEqual(at(9));
    expect(lastOmsSync([paused(12)])).toBeNull();
  });

  it("over 3 hours since the last real sync, or none at all, is stale", () => {
    expect(omsStale(at(9), new Date(at(9).getTime() + 2 * H))).toBe(false);
    expect(omsStale(at(9), new Date(at(9).getTime() + 3 * H + 1))).toBe(true);
    expect(omsStale(null)).toBe(true);
  });
});

describe("one sync walks a bounded number of pages", () => {
  const ORDER = {
    order_id: "o", product_code: "TRF01", country: "SY", channel: "website", status: "new",
    created_at: "2026-10-26T07:00:00+03:00", order_value: "20.00", currency: "USD",
  };

  it("a cursor that comes back twice stops the walk", async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      return new Response(JSON.stringify({ items: [ORDER], next_cursor: "same" }), { status: 200 });
    }) as typeof fetch;
    await expect(readOrders({ baseUrl: "http://localhost:3001", token: TOKEN, fetch: f }, new Date())).rejects.toThrow(/twice/);
    expect(calls).toBe(2);
  });

  it("and never more than MAX_PAGES", async () => {
    let n = 0;
    const f = (async () => new Response(JSON.stringify({ items: [ORDER], next_cursor: `c${++n}` }), { status: 200 })) as typeof fetch;
    await expect(readOrders({ baseUrl: "http://localhost:3001", token: TOKEN, fetch: f }, new Date())).rejects.toThrow(/pages/);
    expect(n).toBe(MAX_PAGES);
  });
});
