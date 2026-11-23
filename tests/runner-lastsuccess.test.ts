/**
 * R-06: a pull that SKIPPED (waiting out a backoff, not linked) is saved as «ok» but pulled nothing. «When did it last succeed» must not count it, or the data looks fresh
 * while the OMS is down — and the night round would decide on it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({ rows: [] as { finishedAt: Date; stats: unknown }[] }));
vi.mock("@/server/db", () => ({ db: { jobRun: { findMany: async () => s.rows } } }));

import { lastSuccess } from "@/jobs/runner";

const at = (h: number) => new Date(`2026-11-22T${String(h).padStart(2, "0")}:00:00Z`);
beforeEach(() => (s.rows = []));

describe("lastSuccess", () => {
  it("the newest run that really pulled, not the newer ones that skipped", async () => {
    s.rows = [{ finishedAt: at(9), stats: { skipped: "backoff", backoff: true } }, { finishedAt: at(8), stats: { skipped: "OMS not linked" } }, { finishedAt: at(7), stats: { orders: 40 } }];
    expect(await lastSuccess("oms.sync")).toEqual(at(7));
  });
  it("a run with empty or missing stats counts", async () => {
    s.rows = [{ finishedAt: at(9), stats: {} }];
    expect(await lastSuccess("oms.sync")).toEqual(at(9));
    s.rows = [{ finishedAt: at(6), stats: null }];
    expect(await lastSuccess("oms.sync")).toEqual(at(6));
  });
  it("only skips: it never succeeded", async () => {
    s.rows = [{ finishedAt: at(9), stats: { skipped: "x" } }];
    expect(await lastSuccess("oms.sync")).toBeNull();
    s.rows = [];
    expect(await lastSuccess("oms.sync")).toBeNull();
  });
});
