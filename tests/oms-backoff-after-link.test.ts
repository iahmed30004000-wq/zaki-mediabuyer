import { describe, expect, it } from "vitest";
import { linkSlot, omsBackoff } from "@/jobs/oms-health";

/**
 * R-26 — saving the OMS address or token must not leave the site «punishing itself» for the failures that came before it: a «not linked» failure every hour
 * before the paste is not the new token's fault. A failure from AFTER the paste still counts.
 */
const at = (h: number, m = 5) => new Date(Date.UTC(2026, 10, 22, h, m, 0));
const failed = (h: number, m = 5) => ({ status: "failed", startedAt: at(h, m) });
const ok = (h: number) => ({ status: "ok", startedAt: at(h), finishedAt: at(h), stats: { orders: 3 } });

describe("the OMS back-off after a new link", () => {
  const runs = [failed(1), failed(2), failed(3), failed(4), failed(5)];

  it("without the link time, five failures put the OMS in an 8-hour wait", () => {
    expect(omsBackoff(runs, at(6, 10))).toMatchObject({ wait: true, failures: 5 });
  });

  it("with the link saved after them, there is nothing to wait for — the pull goes at once", () => {
    expect(omsBackoff(runs, at(6, 10), at(5, 40))).toMatchObject({ wait: false, failures: 0 });
  });

  it("a failure AFTER the link counts, and only that one", () => {
    const after = [...runs, failed(7)];
    expect(omsBackoff(after, at(7, 20), at(6, 30))).toMatchObject({ wait: true, failures: 1 });
    // one hour later the wait is over
    expect(omsBackoff(after, at(8, 20), at(6, 30))).toMatchObject({ wait: false, failures: 1 });
  });

  it("a real sync after the link ends the run as before", () => {
    expect(omsBackoff([failed(1), ok(7)], at(8), at(6))).toMatchObject({ wait: false, failures: 0 });
  });

  it("the pull that follows a link has a slot of its own (the hour's slot may already be used by a «not linked» skip)", () => {
    const linked = at(5, 40);
    expect(linkSlot(linked)).toBe(`link-${linked.getTime()}`);
    expect(linkSlot(null)).toBeNull();
    // a new save makes a new slot
    expect(linkSlot(at(5, 41))).not.toBe(linkSlot(linked));
  });
});
