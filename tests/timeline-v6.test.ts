/**
 * «اليوم على الخط» after v6 (W-16 · W-14): a run answers the slot it belongs to, not the one before it; a request nobody took is not drawn «running»;
 * a slot the watchdog wrote down as missed is a missed dot, and when the run came late as well it is the run that shows; a one-off is on the line.
 */
import { describe, expect, it } from "vitest";
import { dayLine, workdayOf, type LineJob, type LineRun } from "@/core/timeline";

const at = (iso: string) => new Date(iso);
const bounds = workdayOf("2026-11-22"); // 06:00 Amman = 03:00Z
const hourly: LineJob = { key: "h", name: "كل ساعة", schedule: "0 * * * *", enabled: true };
const run = (id: string, startedAt: string, status = "ok", over: Partial<LineRun> = {}): LineRun => ({ id, jobKey: "h", startedAt, status, trigger: "schedule", ...over });
const dotAt = (l: ReturnType<typeof dayLine>, iso: string) => l.dots.find((d) => d.at === iso);

describe("which slot a run answers (W-16)", () => {
  it("a run at 11:02 answers 11:00 — and 10:00 is «فات», it is not turned into 11:00's neighbour", () => {
    // 11:02 Amman = 08:02Z; only that run today
    const l = dayLine([hourly], [run("r", "2026-11-22T08:02:00Z")], bounds, at("2026-11-22T09:00:00Z"));
    expect(dotAt(l, "2026-11-22T08:00:00.000Z")).toMatchObject({ state: "done", runId: "r" });
    expect(dotAt(l, "2026-11-22T07:00:00.000Z")).toMatchObject({ state: "missed", runId: null });
  });

  it("a run that says its own scheduledFor answers that slot, however late it started", () => {
    const l = dayLine([hourly], [run("r", "2026-11-22T08:40:00Z", "ok", { scheduledFor: "2026-11-22T07:00:00.000Z" })], bounds, at("2026-11-22T09:00:00Z"));
    expect(dotAt(l, "2026-11-22T07:00:00.000Z")).toMatchObject({ state: "done", runId: "r" });
    expect(dotAt(l, "2026-11-22T08:00:00.000Z")?.state).toBe("missed");
  });

  it("a scheduledFor with seconds (an agent writes the moment it woke) still answers its slot", () => {
    const l = dayLine([hourly], [run("r", "2026-11-22T08:40:00Z", "ok", { scheduledFor: "2026-11-22T07:00:27.412Z" })], bounds, at("2026-11-22T09:00:00Z"));
    expect(dotAt(l, "2026-11-22T07:00:00.000Z")).toMatchObject({ state: "done", runId: "r" });
    expect(l.dots.find((d) => d.runId === "r")?.state).toBe("done");
  });

  it("a run later than the job's graceMin answers nothing: it is a manual dot (W-16: not stretched to the nearest slot)", () => {
    const l = dayLine([{ ...hourly, graceMin: 10 }], [run("r", "2026-11-22T08:12:00Z")], bounds, at("2026-11-22T09:00:00Z"));
    expect(l.dots.find((d) => d.runId === "r")).toMatchObject({ state: "manual" });
    expect(dotAt(l, "2026-11-22T08:00:00.000Z")?.state).toBe("missed");
  });

  it("a manual run answers no slot even when it started right at one", () => {
    const l = dayLine([hourly], [run("r", "2026-11-22T08:00:00Z", "ok", { trigger: "manual" })], bounds, at("2026-11-22T09:00:00Z"));
    expect(dotAt(l, "2026-11-22T08:00:00.000Z")?.state).toBe("missed");
    expect(l.dots.find((d) => d.runId === "r")?.state).toBe("manual");
  });

  it("a slot is «فات» only after the job's own graceMin", () => {
    const j: LineJob = { ...hourly, graceMin: 30 };
    expect(dotAt(dayLine([j], [], bounds, at("2026-11-22T08:20:00Z")), "2026-11-22T08:00:00.000Z")?.state).toBe("coming");
    expect(dotAt(dayLine([j], [], bounds, at("2026-11-22T08:31:00Z")), "2026-11-22T08:00:00.000Z")?.state).toBe("missed");
  });
});

describe("what the site writes (queued · missed · lost)", () => {
  it("a request nobody took is not «شغّال»: its slot is still coming", () => {
    const l = dayLine([hourly], [run("q", "2026-11-22T08:00:00Z", "queued", { scheduledFor: "2026-11-22T08:00:00.000Z" })], bounds, at("2026-11-22T08:05:00Z"));
    expect(dotAt(l, "2026-11-22T08:00:00.000Z")).toMatchObject({ state: "coming", runId: "q" });
  });

  it("a slot the watchdog wrote as missed is a missed dot with its run; «انقطعت» is a failure", () => {
    const missed = run("m", "2026-11-22T07:00:00Z", "missed", { scheduledFor: "2026-11-22T07:00:00.000Z" });
    const lost = run("l", "2026-11-22T08:00:00Z", "lost", { scheduledFor: "2026-11-22T08:00:00.000Z" });
    const l = dayLine([hourly], [missed, lost], bounds, at("2026-11-22T09:00:00Z"));
    expect(dotAt(l, "2026-11-22T07:00:00.000Z")).toMatchObject({ state: "missed", runId: "m" });
    expect(dotAt(l, "2026-11-22T08:00:00.000Z")).toMatchObject({ state: "failed", runId: "l" });
  });

  it("when a «missed» row and the run that came late are both for one slot, the run that really ran is the dot, and there is no second dot", () => {
    const missed = run("m", "2026-11-22T07:00:00Z", "missed", { scheduledFor: "2026-11-22T07:00:00.000Z" });
    const late = run("late", "2026-11-22T07:40:00Z", "ok", { scheduledFor: "2026-11-22T07:00:00.000Z" });
    const l = dayLine([hourly], [missed, late], bounds, at("2026-11-22T09:00:00Z"));
    expect(l.dots.filter((d) => d.at === "2026-11-22T07:00:00.000Z")).toEqual([expect.objectContaining({ state: "done", runId: "late" })]);
    expect(l.dots.some((d) => d.runId === "m")).toBe(false);
  });

  it("a missed row whose job has no slot that day (it was switched off) still shows, as missed", () => {
    const l = dayLine([{ ...hourly, enabled: false }], [run("m", "2026-11-22T07:00:00Z", "missed", { scheduledFor: "2026-11-22T07:00:00.000Z" })], bounds, at("2026-11-22T09:00:00Z"));
    expect(l.dots).toEqual([expect.objectContaining({ state: "missed", runId: "m" })]);
  });
});

describe("a one-off and a window are on the line (W-14)", () => {
  it("a one-off is a dot at its moment: coming, then done or missed", () => {
    const once: LineJob = { key: "o", name: "مرة", schedule: null, enabled: true, kind: "once", runsAt: "2026-11-22T10:30:00.000Z" };
    expect(dayLine([once], [], bounds, at("2026-11-22T09:00:00Z")).dots).toEqual([expect.objectContaining({ at: "2026-11-22T10:30:00.000Z", state: "coming" })]);
    expect(dayLine([once], [], bounds, at("2026-11-22T11:00:00Z")).dots[0]!.state).toBe("missed");
    const ran = dayLine([once], [{ id: "r", jobKey: "o", startedAt: "2026-11-22T10:31:00Z", status: "ok", trigger: "schedule" }], bounds, at("2026-11-22T11:00:00Z"));
    expect(ran.dots[0]).toMatchObject({ state: "done", runId: "r" });
  });

  it("a window draws its slots up to its end and none after", () => {
    const win: LineJob = { key: "w", name: "فترة", schedule: "0 * * * *", enabled: true, kind: "window", endsAt: "2026-11-22T06:30:00.000Z" };
    const l = dayLine([win], [], bounds, at("2026-11-22T20:00:00Z"));
    const times = l.dots.map((d) => d.at);
    expect(times[0]).toBe("2026-11-22T03:00:00.000Z"); // the working day starts at 06:00 Amman
    expect(times[times.length - 1]).toBe("2026-11-22T06:00:00.000Z");
  });

  it("a manual job draws no slots, scheduled or not", () => {
    expect(dayLine([{ key: "m", name: "ي", schedule: "0 * * * *", enabled: true, kind: "manual" }], [], bounds, at("2026-11-22T20:00:00Z")).dots).toEqual([]);
  });
});
