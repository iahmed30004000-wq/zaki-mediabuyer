import { beforeAll, describe, expect, it, vi } from "vitest";

// truth.ts pulls the database client in at import; none of these tests touch it.
vi.mock("@/server/db", () => ({ db: {} }));

import { omsLink, omsLinkStatus } from "@/server/oms-link";
import { encryptSecrets } from "@/server/crypto";
import { setEnvLines } from "@/server/env-file";
import { readOrders, readProducts, toAttributedOrder } from "@/adapters/oms";
import { economicsFromOms } from "@/jobs/truth";

const TOKEN = "zk1_" + "A".repeat(43);

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "test-key-that-is-long-enough-0123456789";
});

describe("the OMS link is off until it is switched on, and the key never shows", () => {
  it("stays off without OMS_LIVE=1, whatever else is set", () => {
    expect(omsLink({ OMS_BASE_URL: "https://crm.zakiai.io", OMS_TOKEN: TOKEN }).mode).toBe("off");
    expect(omsLink({ OMS_LIVE: "0", OMS_BASE_URL: "https://crm.zakiai.io", OMS_TOKEN: TOKEN }).mode).toBe("off");
  });

  it("opens the sealed key with ENCRYPTION_KEY", () => {
    const link = omsLink({ OMS_LIVE: "1", OMS_ALLOW_REMOTE: "1", OMS_BASE_URL: "https://crm.zakiai.io/", OMS_TOKEN_ENC: encryptSecrets({ token: TOKEN }) });
    expect(link).toMatchObject({ mode: "live", encrypted: true, options: { baseUrl: "https://crm.zakiai.io", token: TOKEN } });
  });

  it("a tampered or foreign blob is off, not a crash", () => {
    const blob = encryptSecrets({ token: TOKEN });
    const tampered = blob.slice(0, -4) + (blob.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect(omsLink({ OMS_LIVE: "1", OMS_ALLOW_REMOTE: "1", OMS_BASE_URL: "https://crm.zakiai.io", OMS_TOKEN_ENC: tampered }).mode).toBe("off");
  });

  it("refuses a plain key in production, allows it on a dev machine and says it is not sealed", () => {
    const env = { OMS_LIVE: "1", OMS_ALLOW_REMOTE: "1", OMS_BASE_URL: "https://crm.zakiai.io", OMS_TOKEN: TOKEN };
    expect(omsLink({ ...env, NODE_ENV: "production" }).mode).toBe("off");
    expect(omsLink({ ...env, NODE_ENV: "development" })).toMatchObject({ mode: "live", encrypted: false });
  });

  it("never sends the key over plain http, except to an OMS on this machine", () => {
    const sealed = encryptSecrets({ token: TOKEN });
    expect(omsLink({ OMS_LIVE: "1", OMS_ALLOW_REMOTE: "1", OMS_BASE_URL: "http://crm.zakiai.io", OMS_TOKEN_ENC: sealed }).mode).toBe("off");
    expect(omsLink({ OMS_LIVE: "1", OMS_BASE_URL: "http://localhost:3001", OMS_TOKEN_ENC: sealed }).mode).toBe("live");
  });

  it("the status a screen sees has the host and the state — and not one character of the key", () => {
    const status = omsLinkStatus({ OMS_LIVE: "1", OMS_ALLOW_REMOTE: "1", OMS_BASE_URL: "https://crm.zakiai.io", OMS_TOKEN_ENC: encryptSecrets({ token: TOKEN }) });
    expect(status).toEqual({ live: true, host: "crm.zakiai.io", encrypted: true, why: null });
    expect(JSON.stringify(status)).not.toContain("zk1_");
  });
});

/** What OMS PR #160 actually answers — copied from its handlers, nulls and extra fields included. */
const OMS_ORDER = {
  order_id: "0b6c2a8e-1",
  product_code: "TRF01",
  country: "SY",
  channel: "landing_page",
  ad_id: "120211000000000001",
  adset_id: null,
  campaign_id: "120210000000000009",
  ad_name: null,
  landing_page: "https://crm.zakiai.io/lp/kamaa-eye-water",
  status: "confirmed",
  created_at: "2026-10-26T07:00:00+03:00",
  confirmed_at: "2026-10-26T08:00:00+03:00",
  shipped_at: null,
  delivered_at: null,
  returned_at: null,
  canceled_at: null,
  order_value: "20.00",
  collected: null,
  currency: "USD",
  is_fake: false,
  first_contact_at: "2026-10-26T07:30:00+03:00",
  capi_ref: null,
};

const OMS_PRODUCT = {
  code: "TRF01",
  name: "ماء الكمأة",
  price: "20.00",
  currency: "USD",
  wholesale_price: null,
  discount_cap: null,
  stock_status: "IN_STOCK",
  offers: [],
  complements: [],
  aliases: ["KamaaEye"],
  unit_cost_usd: "3.25",
  price_options: [
    { title: null, quantity: 1, price: "20.00" },
    { title: "2 قطع", quantity: 2, price: "35.00" },
  ],
  stock_days: 12.5,
  delivery_fee: null,
  return_fee: null,
  cod_fee_pct: null,
};

function fakeOms(pages: Record<string, unknown>) {
  const seen: { url: string; auth: string | null }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
    const key = Object.keys(pages).find((k) => url.includes(k));
    return key ? new Response(JSON.stringify(pages[key]), { status: 200 }) : new Response("{}", { status: 403 });
  }) as typeof fetch;
  return { f, seen };
}

describe("the real adapter reads the OMS's real answer", () => {
  it("follows next_cursor to the end, with the key in the header only", async () => {
    const { f, seen } = fakeOms({
      "cursor=c2": { items: [{ ...OMS_ORDER, order_id: "o2" }], next_cursor: null },
      "/orders/attribution?": { items: [OMS_ORDER], next_cursor: "c2" },
    });
    const orders = await readOrders({ baseUrl: "https://crm.zakiai.io", token: TOKEN, fetch: f }, new Date("2026-10-26T00:00:00Z"));
    expect(orders.map((o) => o.order_id)).toEqual(["0b6c2a8e-1", "o2"]);
    expect(seen.every((s) => s.auth === `Bearer ${TOKEN}`)).toBe(true);
    expect(seen.every((s) => !s.url.includes(TOKEN))).toBe(true);
    expect(seen[0]!.url).toContain("https://crm.zakiai.io/api/v1/orders/attribution?updated_since=2026-10-26T00%3A00%3A00.000Z");
  });

  it("reads the catalogue with its nulls, and stores an order with its offset dates", async () => {
    const { f } = fakeOms({ "/products?fields=": { items: [OMS_PRODUCT] } });
    const [p] = await readProducts({ baseUrl: "https://crm.zakiai.io", token: TOKEN, fetch: f });
    expect(p).toMatchObject({ code: "TRF01", unit_cost_usd: "3.25", delivery_fee: null, cod_fee_pct: null, stock_days: 12.5 });
    const row = toAttributedOrder(OMS_ORDER as never, 24);
    expect(row.createdAtOms.toISOString()).toBe("2026-10-26T04:00:00.000Z");
    expect(row).toMatchObject({ method: "ad_id", status: "confirmed", capiRef: null });
  });

  it("a refusal names the path and the status — never the key", async () => {
    const { f } = fakeOms({});
    await expect(readProducts({ baseUrl: "https://crm.zakiai.io", token: TOKEN, fetch: f })).rejects.toThrow(/OMS \/products answered 403/);
    await readProducts({ baseUrl: "https://crm.zakiai.io", token: TOKEN, fetch: f }).catch((e: Error) => expect(e.message).not.toContain("zk1_"));
  });
});

describe("an OMS null never wipes a figure", () => {
  it("only the figures the OMS sent are updated; the row says it is partial", () => {
    const { create, update } = economicsFromOms(OMS_PRODUCT as never);
    expect(update).toEqual({ name: "ماء الكمأة", price: "20.00", unitCost: "3.25", stockDays: 13 });
    expect(update).not.toHaveProperty("deliveryFee");
    expect(update).not.toHaveProperty("returnFee");
    expect(update).not.toHaveProperty("codFeePct");
    expect(create).toMatchObject({ productCode: "TRF01", unitCost: "3.25", deliveryFee: "0", source: "oms_partial" });
  });

  it("a complete product is marked as the OMS's own", () => {
    const { create } = economicsFromOms({ ...OMS_PRODUCT, delivery_fee: "3.00", return_fee: "2.00", cod_fee_pct: "0.0200" } as never);
    expect(create.source).toBe("oms");
  });
});

describe("the .env editor touches only its own lines", () => {
  it("replaces in place, appends what is new, removes what is asked, keeps comments and CRLF", () => {
    const before = "# الأنظمة\r\nOMS_BASE_URL=\r\nOMS_TOKEN=old\r\nOTHER=1\r\n";
    const after = setEnvLines(before, { OMS_BASE_URL: "https://crm.zakiai.io", OMS_TOKEN_ENC: "v2:x" }, ["OMS_TOKEN"]);
    expect(after).toBe("# الأنظمة\r\nOMS_BASE_URL=https://crm.zakiai.io\r\nOTHER=1\r\nOMS_TOKEN_ENC=v2:x\r\n");
  });

  it("works on an empty file", () => {
    expect(setEnvLines("", { A: "1" })).toBe("A=1\n");
  });
});
