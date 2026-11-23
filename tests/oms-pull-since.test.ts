import { describe, expect, it } from "vitest";
import { omsPullSince } from "@/jobs/oms-health";

/** R-21: the OMS pull reaches back 3 days; after a longer outage it reaches back to the last real pull (never more than 30 days), so the orders in between are not lost. */
const NOW = new Date("2026-11-22T12:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe("how far back the OMS pull reaches", () => {
  it("normally: 3 days (the last pull was an hour ago)", () => expect(omsPullSince(NOW, ago(1)).getTime()).toBe(ago(72).getTime()));
  it("never pulled: 3 days", () => expect(omsPullSince(NOW, null).getTime()).toBe(ago(72).getTime()));
  it("after a 10-day outage: back to an hour before the last real pull", () => expect(omsPullSince(NOW, ago(240)).getTime()).toBe(ago(241).getTime()));
  it("an outage longer than a month is capped at 30 days", () => expect(omsPullSince(NOW, ago(24 * 90)).getTime()).toBe(ago(24 * 30).getTime()));
  it("a last pull 2 days ago still pulls the 3 days (never less than the normal window)", () => expect(omsPullSince(NOW, ago(48)).getTime()).toBe(ago(72).getTime()));
});
