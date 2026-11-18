import { describe, expect, it } from "vitest";
import { busiestSlot, dayLine, workdayBounds, workdayOf, type LineJob, type LineRun } from "@/core/timeline";

// Amman is UTC+3: 06:00 there is 03:00Z
const at = (iso: string) => new Date(iso);

describe("the working day (06:00 → 06:00, Amman)", () => {
  it("starts at 06:00 Amman of its day and lasts 24 hours", () => {
    const b = workdayBounds(at("2026-11-16T10:00:00Z")); // 13:00 Amman
    expect(b.key).toBe("2026-11-16");
    expect(b.from.toISOString()).toBe("2026-11-16T03:00:00.000Z");
    expect(b.to.toISOString()).toBe("2026-11-17T03:00:00.000Z");
  });

  it("the small hours still belong to the day that began the evening before", () => {
    expect(workdayBounds(at("2026-11-16T22:30:00Z")).key).toBe("2026-11-16"); // 01:30 Amman on the 17th
    expect(workdayBounds(at("2026-11-17T02:59:00Z")).key).toBe("2026-11-16"); // 05:59 Amman
    expect(workdayBounds(at("2026-11-17T03:00:00Z")).key).toBe("2026-11-17"); // 06:00 Amman: the next day begins
  });

  it("workdayOf(key) is the same window", () => {
    expect(workdayOf("2026-11-16").from.toISOString()).toBe("2026-11-16T03:00:00.000Z");
  });
});

describe("the line of the day", () => {
  const bounds = workdayOf("2026-11-16");
  // «0 9 * * *» is 09:00 Amman = 06:00Z; «0 1 * * *» is 01:00 Amman on the 17th = 22:00Z on the 16th
  const jobs: LineJob[] = [
    { key: "daily-check", name: "الفحص اليومي", schedule: "0 9 * * *", enabled: true },
    { key: "night-round", name: "جولة الليل", schedule: "0 1 * * *", enabled: true },
    { key: "hourly", name: "كل ساعة", schedule: "0 * * * *", enabled: false },
    { key: "manual-only", name: "يدوي", schedule: null, enabled: true },
  ];
  const run = (id: string, jobKey: string, startedAt: string, status = "ok", trigger = "schedule"): LineRun => ({ id, jobKey, startedAt, status, trigger });

  it("a slot with a good run is done, with a failed run failed, with a run going now running", () => {
    const l = dayLine(jobs, [run("r1", "daily-check", "2026-11-16T06:02:00Z")], bounds, at("2026-11-16T10:00:00Z"));
    expect(l.dots.find((d) => d.jobKey === "daily-check")).toMatchObject({ state: "done", runId: "r1" });
    expect(dayLine(jobs, [run("r1", "daily-check", "2026-11-16T06:02:00Z", "failed")], bounds, at("2026-11-16T10:00:00Z")).dots.find((d) => d.jobKey === "daily-check")?.state).toBe("failed");
    expect(dayLine(jobs, [run("r1", "daily-check", "2026-11-16T06:02:00Z", "running")], bounds, at("2026-11-16T06:05:00Z")).dots.find((d) => d.jobKey === "daily-check")?.state).toBe("running");
  });

  it("a slot that passed with no run is «فات» (after 15 minutes of grace); one that has not come yet is «جاي»", () => {
    const now = at("2026-11-16T10:00:00Z");
    const l = dayLine(jobs, [], bounds, now);
    expect(l.dots.find((d) => d.jobKey === "daily-check")?.state).toBe("missed");
    expect(l.dots.find((d) => d.jobKey === "night-round")?.state).toBe("coming");
    // 5 minutes after the slot: not «فات» yet
    expect(dayLine(jobs, [], bounds, at("2026-11-16T06:05:00Z")).dots.find((d) => d.jobKey === "daily-check")?.state).toBe("coming");
  });

  it("the next dot is the first one still coming", () => {
    const l = dayLine(jobs, [], bounds, at("2026-11-16T10:00:00Z"));
    expect(l.next).toMatchObject({ jobKey: "night-round", state: "coming" });
    expect(l.next?.at).toBe("2026-11-16T22:00:00.000Z");
  });

  it("a run that matches no slot is a manual dot; a switched-off job and a job nobody schedules draw no slots", () => {
    const l = dayLine(jobs, [run("m1", "manual-only", "2026-11-16T08:00:00Z", "ok", "manual")], bounds, at("2026-11-16T10:00:00Z"));
    expect(l.dots.filter((d) => d.state === "manual")).toEqual([expect.objectContaining({ jobKey: "manual-only", runId: "m1", name: "يدوي" })]);
    expect(l.dots.some((d) => d.jobKey === "hourly")).toBe(false);
    expect(l.dots.filter((d) => d.jobKey === "manual-only")).toHaveLength(1);
  });

  it("one run is used for one slot only, and a run far from every slot is not stretched to fit", () => {
    const twice: LineJob[] = [{ key: "j", name: "ج", schedule: "0 9,10 * * *", enabled: true }];
    const l = dayLine(twice, [run("a", "j", "2026-11-16T06:01:00Z")], bounds, at("2026-11-16T12:00:00Z"));
    expect(l.dots.map((d) => d.state)).toEqual(["done", "missed"]);
    const far = dayLine(twice, [run("b", "j", "2026-11-16T09:00:00Z")], bounds, at("2026-11-16T12:00:00Z")); // 12:00 Amman: matches neither 09 nor 10
    expect(far.counts).toMatchObject({ manual: 1, missed: 2 });
  });

  it("counts every state, and the dots come out in time order", () => {
    const l = dayLine(jobs, [run("r1", "daily-check", "2026-11-16T06:00:00Z"), run("m1", "manual-only", "2026-11-16T05:00:00Z", "failed", "manual")], bounds, at("2026-11-16T10:00:00Z"));
    expect(l.counts).toEqual({ done: 1, failed: 1, running: 0, missed: 0, coming: 1, manual: 0 });
    expect(l.dots.map((d) => d.at)).toEqual([...l.dots.map((d) => d.at)].sort());
  });

  it("a schedule the clock cannot read draws nothing instead of throwing", () => {
    expect(dayLine([{ key: "x", name: "x", schedule: "nonsense", enabled: true }], [], bounds, new Date()).dots).toEqual([]);
  });

  it("runs outside the working day are not drawn", () => {
    const l = dayLine(jobs, [run("old", "daily-check", "2026-11-15T06:00:00Z")], bounds, at("2026-11-16T10:00:00Z"));
    expect(l.dots.some((d) => d.runId === "old")).toBe(false);
  });
});

describe("the busiest half hour", () => {
  it("the half hour with the most dots; ties go to the earliest; an empty day has none", () => {
    expect(busiestSlot([])).toBeNull();
    const d = (at: string) => ({ at });
    const dots = [d("2026-11-16T07:01:00Z"), d("2026-11-16T07:20:00Z"), d("2026-11-16T07:29:00Z"), d("2026-11-16T09:00:00Z"), d("2026-11-16T09:10:00Z"), d("2026-11-16T09:20:00Z")];
    expect(busiestSlot(dots)).toEqual({ from: "2026-11-16T07:00:00.000Z", count: 3 });
    expect(busiestSlot([d("2026-11-16T10:31:00Z"), d("2026-11-16T10:40:00Z"), d("2026-11-16T05:00:00Z"), d("2026-11-16T05:10:00Z")])).toEqual({ from: "2026-11-16T05:00:00.000Z", count: 2 });
  });
});
