import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { bodyOf, capiHealth, eventsOf, hashPhone, sendable } from "@/core/capi";

const now = new Date("2026-10-26T09:00:00Z");
const h = (n: number) => new Date(now.getTime() - n * 3_600_000);
const order = { omsOrderId: "77812", confirmedAt: h(30), shippedAt: h(20), deliveredAt: null, returnedAt: null, canceledAt: null, orderValue: 20, collected: null, isFake: false };

describe("conversion events (spec 9.1 / T4.3)", () => {
  it("one event per order and status, with a unique id; Purchase on confirm by default", () => {
    const e = eventsOf(order);
    expect(e.map((x) => [x.eventId, x.eventName])).toEqual([["oms-77812-confirmed", "Purchase"], ["oms-77812-shipped", "OrderShipped"]]);
    expect(e[0]!.value).toBe(20);
  });
  it("Purchase moves to delivery when the owner chooses it", () => {
    const e = eventsOf({ ...order, deliveredAt: h(2), collected: 20 }, "delivered");
    expect(e.find((x) => x.status === "delivered")!.eventName).toBe("Purchase");
    expect(e.find((x) => x.status === "confirmed")!.eventName).toBe("OrderConfirmed");
  });
  it("a fake order sends nothing", () => expect(eventsOf({ ...order, isFake: true })).toEqual([]));
  it("older than 7 days or in the future is never sent", () => {
    expect(sendable(h(24 * 8), now)).toBe("expired");
    expect(sendable(h(24 * 7 - 0.5), now)).toBe("expired");
    expect(sendable(h(-1), now)).toBe("future");
    expect(sendable(h(3), now)).toBe("ok");
  });
  it("website: hashed phone (digits only), fbc/fbp, hashed external id, value and currency", () => {
    const [e] = eventsOf(order);
    const b = bodyOf(e!, { omsOrderId: "77812", channel: "website", currency: "USD", lpUrl: "https://crm.zakiai.io/lp/x" }, { phone_e164: "+963 999 000 111", fbc: "fb.1.x", fbp: "fb.1.y", external_ref: "C-9" })!;
    expect(b).toMatchObject({ event_name: "Purchase", event_id: "oms-77812-confirmed", action_source: "website", event_source_url: "https://crm.zakiai.io/lp/x", custom_data: { currency: "USD", value: 20, order_id: "77812" } });
    expect(b.user_data.ph).toEqual([createHash("sha256").update("963999000111").digest("hex")]);
    expect(JSON.stringify(b)).not.toContain("999 000");
    expect(hashPhone("00963999000111")).toBe(hashPhone("+963999000111"));
  });
  it("whatsapp and messenger use business_messaging with their own ids; missing ids = nothing to send", () => {
    const [e] = eventsOf(order);
    expect(bodyOf(e!, { omsOrderId: "1", channel: "whatsapp", currency: "USD" }, { ctwa_clid: "c1", waba_id: "w1" })).toMatchObject({ action_source: "business_messaging", messaging_channel: "whatsapp", user_data: { whatsapp_business_account_id: "w1", ctwa_clid: "c1" } });
    expect(bodyOf(e!, { omsOrderId: "1", channel: "messenger", currency: "USD" }, { page_id: "p", psid: "u" })).toMatchObject({ messaging_channel: "messenger", user_data: { page_id: "p", page_scoped_user_id: "u" } });
    expect(bodyOf(e!, { omsOrderId: "1", channel: "whatsapp", currency: "USD" }, {})).toBeNull();
    expect(bodyOf(e!, { omsOrderId: "1", channel: "website", currency: "USD" }, {})).toBeNull();
  });
  it("health: accepted share, expired counted apart", () => {
    expect(capiHealth({ sent: 95, rejected: 5, expired: 3 })).toEqual({ acceptedPct: 95, expired: 3, rejected: 5, pending: 0 });
    expect(capiHealth({}).acceptedPct).toBeNull();
  });
});
