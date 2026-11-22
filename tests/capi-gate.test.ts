/**
 * R-11 — this site does not send conversion events to Meta unless CAPI_SEND=1: the OMS is the only sender (owner, 17/11).
 * Off (the default): no CapiEvent row is made and none is read, expired or sent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    track: (name: string, ret: unknown) => async () => {
      calls.push(name);
      return ret;
    },
  };
});


vi.mock("@/server/db", () => ({
  db: {
    attributedOrder: {
      findMany: s.track("attributedOrder.findMany", [
        { omsOrderId: "9001", confirmedAt: new Date(), shippedAt: null, deliveredAt: null, returnedAt: null, canceledAt: null, orderValue: 20, collected: null, isFake: false, channel: "website", currency: "USD" },
      ]),
    },
    capiEvent: {
      createMany: s.track("capiEvent.createMany", { count: 1 }),
      findMany: s.track("capiEvent.findMany", []),
      update: s.track("capiEvent.update", {}),
      updateMany: s.track("capiEvent.updateMany", {}),
    },
  },
}));
vi.mock("@/server/settings", () => ({ getSetting: async () => "confirmed" }));

import { capiSendOn } from "@/core/capi";
import { enqueueCapi, sendCapi } from "@/jobs/capi";

beforeEach(() => {
  s.calls.length = 0;
});

describe("the CAPI switch", () => {
  it("is off unless it is exactly 1", () => {
    expect(capiSendOn({})).toBe(false);
    expect(capiSendOn({ CAPI_SEND: "" })).toBe(false);
    expect(capiSendOn({ CAPI_SEND: "0" })).toBe(false);
    expect(capiSendOn({ CAPI_SEND: "true" })).toBe(false);
    expect(capiSendOn({ CAPI_SEND: "1" })).toBe(true);
  });

  it("off: not one CapiEvent row is made, and the orders are not even read", async () => {
    const r = await enqueueCapi(new Date(), {});
    expect(r).toMatchObject({ queued: 0, events: 0, off: true });
    expect(s.calls).toEqual([]);
  });

  it("off: nothing is read, expired or sent", async () => {
    const r = await sendCapi({ meta: null, oms: null, datasetId: "PX", env: {} });
    expect(r).toMatchObject({ sent: 0, off: true });
    expect(s.calls).toEqual([]);
  });

  it("on (the owner switched it on): the queue is made as before", async () => {
    const r = await enqueueCapi(new Date(), { CAPI_SEND: "1" });
    expect(r.off).toBeUndefined();
    expect(s.calls).toContain("capiEvent.createMany");
  });
});
