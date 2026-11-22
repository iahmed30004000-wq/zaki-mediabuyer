/**
 * Which slot a run answers, and the slots of each kind of job (docs/rebuild-v6/01-model.md §5, W-14 · W-16). Amman is UTC+3: 11:00 there is 08:00Z.
 */
import { describe, expect, it } from "vitest";
import { EARLY_MIN, jobSlots, slotFor, slotRef, type SlotJob } from "@/core/slot-for";

const Z = (hh: number, mm = 0, day = 22) => new Date(Date.UTC(2026, 10, day, hh, mm));
const hourly: SlotJob = { kind: "recurring", schedule: "0 * * * *", graceMin: 15 };

describe("slotFor — the slot a run answers", () => {
  it("a run at 11:02 answers the 11:00 slot, so 10:00 is not «فات» because of it (W-16)", () => {
    // 11:02 Amman = 08:02Z
    expect(slotFor(hourly, Z(8, 2))?.toISOString()).toBe("2026-11-22T08:00:00.000Z");
  });

  it("a run a little early answers the slot ahead of it (up to 5 minutes)", () => {
    expect(EARLY_MIN).toBe(5);
    expect(slotFor(hourly, Z(7, 56))?.toISOString()).toBe("2026-11-22T08:00:00.000Z");
    expect(slotFor(hourly, Z(7, 54))).toBeNull() ;
  });

  it("a run later than graceMin after the slot answers none: it is a manual run with no slot", () => {
    expect(slotFor(hourly, Z(8, 15))?.toISOString()).toBe("2026-11-22T08:00:00.000Z");
    expect(slotFor(hourly, Z(8, 16))).toBeNull();
    expect(slotFor({ ...hourly, graceMin: 30 }, Z(8, 16))?.toISOString()).toBe("2026-11-22T08:00:00.000Z");
  });

  it("between two close slots the nearest wins, and a tie goes to the earlier one (the run is late for it)", () => {
    const often: SlotJob = { kind: "recurring", schedule: "*/10 * * * *", graceMin: 15 };
    expect(slotFor(often, Z(8, 7))?.toISOString()).toBe("2026-11-22T08:10:00.000Z");
    expect(slotFor(often, Z(8, 3))?.toISOString()).toBe("2026-11-22T08:00:00.000Z");
    expect(slotFor(often, Z(8, 5))?.toISOString()).toBe("2026-11-22T08:00:00.000Z");
  });

  it("a job nobody schedules, a manual job and a schedule that cannot be read have no slots", () => {
    expect(slotFor({ kind: "manual", schedule: null, graceMin: 15 }, Z(8, 0))).toBeNull();
    expect(slotFor({ kind: "recurring", schedule: null, graceMin: 15 }, Z(8, 0))).toBeNull();
    expect(slotFor({ kind: "recurring", schedule: "nonsense", graceMin: 15 }, Z(8, 0))).toBeNull();
  });

  it("a one-off answers its own moment only", () => {
    const once: SlotJob = { kind: "once", schedule: null, runsAt: Z(9, 30), graceMin: 15 };
    expect(slotFor(once, Z(9, 33))?.toISOString()).toBe("2026-11-22T09:30:00.000Z");
    expect(slotFor(once, Z(9, 50))).toBeNull();
    expect(slotFor(once, Z(9, 20))).toBeNull();
  });
});

describe("jobSlots — what is due, by kind", () => {
  it("a recurring job: the cron times in (from, to] on the Amman clock", () => {
    const s = jobSlots(hourly, Z(7, 0), Z(9, 0));
    expect(s.map((d) => d.toISOString())).toEqual(["2026-11-22T08:00:00.000Z", "2026-11-22T09:00:00.000Z"]);
  });

  it("a one-off: its moment, once, inside the range", () => {
    const once: SlotJob = { kind: "once", schedule: null, runsAt: "2026-11-22T09:30:00.000Z", graceMin: 15 };
    expect(jobSlots(once, Z(9, 0), Z(10, 0))).toEqual([Z(9, 30)]);
    expect(jobSlots(once, Z(9, 30), Z(10, 0))).toEqual([]);
    expect(jobSlots(once, Z(8, 0), Z(9, 29))).toEqual([]);
    expect(jobSlots({ kind: "once", schedule: null, runsAt: null, graceMin: 15 }, Z(8, 0), Z(23, 0))).toEqual([]);
  });

  it("a window: its slots until it ends, none after", () => {
    const win: SlotJob = { kind: "window", schedule: "0 * * * *", endsAt: Z(9, 0), graceMin: 15 };
    expect(jobSlots(win, Z(6, 59), Z(12, 0)).map((d) => d.toISOString())).toEqual(["2026-11-22T07:00:00.000Z", "2026-11-22T08:00:00.000Z", "2026-11-22T09:00:00.000Z"]);
    expect(jobSlots({ ...win, endsAt: Z(8, 30) }, Z(6, 59), Z(12, 0)).map((d) => d.toISOString())).toEqual(["2026-11-22T07:00:00.000Z", "2026-11-22T08:00:00.000Z"]);
  });

  it("a manual job has none; an empty or backwards range has none", () => {
    expect(jobSlots({ kind: "manual", schedule: "0 * * * *", graceMin: 15 }, Z(0), Z(23))).toEqual([]);
    expect(jobSlots(hourly, Z(9), Z(8))).toEqual([]);
  });

  it("the reference of a slot's own row", () => {
    expect(slotRef(Z(8, 0))).toBe("slot-2026-11-22T08:00:00.000Z");
    expect(slotRef("2026-11-22T08:00:00.000Z")).toBe("slot-2026-11-22T08:00:00.000Z");
  });
});
