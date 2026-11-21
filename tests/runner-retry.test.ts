/**
 * N-07: a failed or interrupted slot is not burned any more. The database is replaced by a small in-memory table that
 * behaves like JobRun (unique on job+slot, compare-and-set updates).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { JOB_RETRIES, STALE_RUNNING_MS, slotAction } from "@/core/job-slot";

type Row = { id: string; job: string; slot: string; status: string; startedAt: Date; finishedAt: Date | null; error: string | null; stats: unknown; attempt: number };
const rows: Row[] = [];
let seq = 0;

const matches = (r: Row, w: Record<string, unknown>) => Object.entries(w).every(([k, v]) => (v && typeof v === "object" && "lt" in (v as object) ? (r as unknown as Record<string, Date>)[k]! < (v as { lt: Date }).lt : (r as unknown as Record<string, unknown>)[k] === v));

vi.mock("@/server/db", () => ({
  db: {
    jobRun: {
      create: async ({ data }: { data: { job: string; slot: string; status: string } }) => {
        if (rows.some((r) => r.job === data.job && r.slot === data.slot)) throw new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" });
        const row: Row = { id: `r${++seq}`, ...data, startedAt: new Date(), finishedAt: null, error: null, stats: null, attempt: 1 };
        rows.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { job_slot: { job: string; slot: string } } }) => rows.find((r) => r.job === where.job_slot.job && r.slot === where.job_slot.slot) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => Object.assign(rows.find((r) => r.id === where.id)!, data),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> & { attempt?: number } }) => {
        const hit = rows.filter((r) => matches(r, where));
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      },
    },
  },
}));

import { runOnce, stopStarting, sweepInterrupted } from "@/jobs/runner";

beforeEach(() => {
  rows.length = 0;
});

describe("slotAction (pure)", () => {
  const at = (minAgo: number) => new Date(Date.now() - minAgo * 60_000);
  const now = new Date();
  it("a finished slot and a fresh running one are left alone", () => {
    expect(slotAction({ status: "ok", attempt: 1, startedAt: at(500) }, now, 2)).toEqual({ interrupt: false, retry: false });
    expect(slotAction({ status: "running", attempt: 1, startedAt: at(5) }, now, 2)).toEqual({ interrupt: false, retry: false });
  });
  it("a running row older than 30 minutes is interrupted, and retried only when retries allow", () => {
    expect(slotAction({ status: "running", attempt: 1, startedAt: at(31) }, now, 2)).toEqual({ interrupt: true, retry: true });
    expect(slotAction({ status: "running", attempt: 1, startedAt: at(31) }, now, 0)).toEqual({ interrupt: true, retry: false });
    expect(STALE_RUNNING_MS).toBe(30 * 60_000);
  });
  it("a failed slot gets retries + 1 attempts in all", () => {
    expect(slotAction({ status: "failed", attempt: 1, startedAt: at(2) }, now, 2).retry).toBe(true);
    expect(slotAction({ status: "failed", attempt: 2, startedAt: at(2) }, now, 2).retry).toBe(true);
    expect(slotAction({ status: "failed", attempt: 3, startedAt: at(2) }, now, 2).retry).toBe(false);
  });
  it("the jobs that cost a day are the ones with retries", () => {
    expect(JOB_RETRIES).toEqual({ "db.backup": 2, "report.morning": 2, "plan.week": 2, "report.weekly": 2 });
  });
});

describe("runOnce", () => {
  it("a job without retries: a failed slot is not run again (as before)", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue({});
    expect(await runOnce("x", "s1", fn)).toMatchObject({ ok: false, error: "boom" });
    expect(await runOnce("x", "s1", fn)).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("with retries: the failure is tried again by the next round, then succeeds and stops", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("blip")).mockResolvedValue({ n: 1 });
    expect(await runOnce("db.backup", "2026-11-21", fn, { retries: 2 })).toMatchObject({ ok: false });
    expect(await runOnce("db.backup", "2026-11-21", fn, { retries: 2 })).toMatchObject({ ok: true });
    expect(rows[0]).toMatchObject({ status: "ok", attempt: 2, error: null });
    expect(await runOnce("db.backup", "2026-11-21", fn, { retries: 2 })).toBeNull();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("gives up after retries + 1 attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("down"));
    for (let i = 0; i < 6; i++) await runOnce("db.backup", "d", fn, { retries: 2 });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(rows[0]).toMatchObject({ status: "failed", attempt: 3 });
  });

  it("a row left running by a dead process is closed as interrupted and taken over", async () => {
    rows.push({ id: "old", job: "report.morning", slot: "2026-11-21", status: "running", startedAt: new Date(Date.now() - 45 * 60_000), finishedAt: null, error: null, stats: null, attempt: 1 });
    const fn = vi.fn().mockResolvedValue({ sent: true });
    expect(await runOnce("report.morning", "2026-11-21", fn, { retries: 2 })).toMatchObject({ ok: true });
    expect(rows[0]).toMatchObject({ status: "ok", attempt: 2 });
  });

  it("a fresh running row is not touched (another worker is on it)", async () => {
    rows.push({ id: "live", job: "x", slot: "s", status: "running", startedAt: new Date(), finishedAt: null, error: null, stats: null, attempt: 1 });
    const fn = vi.fn();
    expect(await runOnce("x", "s", fn, { retries: 2 })).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("two workers racing for the same retry: only one runs it", async () => {
    rows.push({ id: "f", job: "db.backup", slot: "d", status: "failed", startedAt: new Date(), finishedAt: new Date(), error: "x", stats: null, attempt: 1 });
    const fn = vi.fn().mockResolvedValue({});
    const [a, b] = await Promise.all([runOnce("db.backup", "d", fn, { retries: 2 }), runOnce("db.backup", "d", fn, { retries: 2 })]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("sweepInterrupted", () => {
  it("closes only the running rows older than 30 minutes", async () => {
    rows.push(
      { id: "a", job: "j", slot: "1", status: "running", startedAt: new Date(Date.now() - 40 * 60_000), finishedAt: null, error: null, stats: null, attempt: 1 },
      { id: "b", job: "j", slot: "2", status: "running", startedAt: new Date(), finishedAt: null, error: null, stats: null, attempt: 1 },
    );
    expect(await sweepInterrupted()).toBe(1);
    expect(rows.map((r) => r.status)).toEqual(["failed", "running"]);
    expect(rows[0]!.error).toBe("interrupted");
  });
});

describe("SIGTERM", () => {
  it("after stopStarting no new job starts", async () => {
    stopStarting();
    const fn = vi.fn();
    expect(await runOnce("late", "s", fn)).toBeNull();
    expect(fn).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });
});
