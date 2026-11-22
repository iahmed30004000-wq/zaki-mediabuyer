import { describe, expect, it } from "vitest";
import { SEED_WORKFLOWS, type WfGraph } from "@/core/workflow";
import { SEED_JOB_META, branchNumbers, clockWords, jobCounters, jobStatus, scheduleWords, type JobKind, type JobLike } from "@/core/jobs";

const now = new Date("2026-11-16T10:00:00Z");
const job = (over: Partial<JobLike> = {}): JobLike => ({ enabled: true, kind: "recurring", schedule: "0 9 * * *", scheduleText: null, runsAt: null, endsAt: null, finishedAt: null, ...over });

describe("the status badge — one line of the table each, in order", () => {
  it("switched off beats everything", () => {
    expect(jobStatus(job({ enabled: false, finishedAt: "2026-11-01T00:00:00Z" }), { status: "failed" }, now).key).toBe("paused");
  });
  it("a one-off that ran, and a window that ended, are finished", () => {
    expect(jobStatus(job({ kind: "once", finishedAt: "2026-11-15T20:00:00Z" }), null, now).key).toBe("finished");
    expect(jobStatus(job({ kind: "window", endsAt: "2026-11-16T09:00:00Z" }), null, now).key).toBe("finished");
    expect(jobStatus(job({ kind: "window", endsAt: "2026-11-17T09:00:00Z" }), null, now).key).toBe("window");
  });
  it("a failed last run is red «وقفت»; a waiting one with an open handoff is «واقفة — بدها حدا» (v6: orange, it needs somebody); waiting alone is just on", () => {
    expect(jobStatus(job(), { status: "failed" }, now)).toMatchObject({ key: "failed", label: "وقفت", tone: "danger" });
    expect(jobStatus(job(), { status: "waiting" }, now, true)).toMatchObject({ key: "stuck", label: "واقفة — بدها حدا", tone: "warn" });
    expect(jobStatus(job(), { status: "waiting" }, now, false).key).toBe("on");
  });
  it("then once · window · manual · on («مفعّلة» — the switch; «شغّالة» is a run that is going, see tests/p3-decisions-scope.test.ts)", () => {
    expect(jobStatus(job({ kind: "once" }), null, now)).toMatchObject({ key: "once", label: "مرة وحدة جاية", tone: "warn" });
    expect(jobStatus(job({ kind: "manual" }), null, now)).toMatchObject({ key: "manual", tone: "neutral" });
    expect(jobStatus(job(), { status: "ok" }, now)).toMatchObject({ key: "on", label: "مفعّلة", tone: "ok" });
  });
  it("a failure outranks the kind: a manual job whose last run failed is «فشلت»", () => {
    expect(jobStatus(job({ kind: "manual" }), { status: "failed" }, now).key).toBe("failed");
  });
});

describe("the counters over the map", () => {
  it("count the badges in five groups", () => {
    const badges = [
      jobStatus(job(), null, now),
      jobStatus(job(), null, now),
      jobStatus(job(), { status: "failed" }, now),
      jobStatus(job(), { status: "waiting" }, now, true),
      jobStatus(job({ kind: "once" }), null, now),
      jobStatus(job({ kind: "window" }), null, now),
      jobStatus(job({ kind: "manual" }), null, now),
      jobStatus(job({ enabled: false }), null, now),
      jobStatus(job({ finishedAt: "2026-11-01T00:00:00Z" }), null, now),
    ];
    const c = jobCounters(badges);
    expect(c).toMatchObject({ total: 9, running: 2, problem: 2, upcoming: 2, manual: 1, off: 2 });
    expect(c.running + c.problem + c.upcoming + c.manual + c.off).toBe(c.total);
    expect(jobCounters([])).toMatchObject({ total: 0, running: 0 });
  });
});

describe("branch numbers", () => {
  const graph: WfGraph = {
    nodes: [
      { id: "start", type: "trigger", label: "بداية" },
      { id: "a", type: "step", label: "أ" },
      { id: "b", type: "condition", label: "ب" },
      { id: "c", type: "notify", label: "ج" },
    ],
    edges: [{ from: "start", to: "a" }, { from: "a", to: "b" }, { from: "b", to: "c" }],
  };
  it("number the steps in the order they run, from 1, skipping the trigger", () => {
    expect([...branchNumbers({ number: 7, graph })]).toEqual([["a", "7.1"], ["b", "7.2"], ["c", "7.3"]]);
  });
  it("a job with no number yet has none", () => {
    expect(branchNumbers({ number: null, graph }).size).toBe(0);
  });
  it("follows the run order, not the drawn order", () => {
    const g2: WfGraph = { nodes: [{ id: "start", type: "trigger", label: "x" }, { id: "late", type: "step", label: "l" }, { id: "early", type: "step", label: "e" }], edges: [{ from: "start", to: "early" }, { from: "early", to: "late" }] };
    expect(branchNumbers({ number: 2, graph: g2 }).get("early")).toBe("2.1");
    expect(branchNumbers({ number: 2, graph: g2 }).get("late")).toBe("2.2");
  });
});

describe("the schedule in words", () => {
  const w = (schedule: string | null, over: Partial<{ scheduleText: string | null; kind: JobKind; runsAt: string | null }> = {}) => scheduleWords({ schedule, scheduleText: null, kind: "recurring", ...over }, now);
  it("the typed words win", () => {
    expect(w("0 9 * * *", { scheduleText: "الليلة 12:30" })).toBe("الليلة 12:30");
  });
  it("every day, with the part of the day", () => {
    expect(w("35 0 * * *")).toBe("كل يوم 12:35 بالليل");
    expect(w("20 11 * * *")).toBe("كل يوم 11:20 الصبح");
    expect(w("0 15 * * *")).toBe("كل يوم 3:00 العصر");
  });
  it("every hour from–to, with the count", () => {
    expect(w("0 10-22 * * *")).toBe("كل ساعة من 10 الصبح لـ10 بالليل (13 جولة)");
    expect(w("0 10-22/2 * * *")).toMatch(/^كل ساعتين من 10 الصبح لـ10 بالليل \(7 جولة\)$/);
  });
  it("a day of the week", () => {
    expect(w("20 11 * * 4")).toBe("كل الخميس 11:20 الصبح");
  });
  it("a few times a day", () => {
    expect(w("7 11,13,15 * * *")).toBe("3 مرات: 11:07 · 1:07 · 3:07");
  });
  it("a pattern it cannot say: the cron itself and the next run; no schedule: on request", () => {
    expect(w("*/7 * * * 1-5")).toMatch(/^\*\/7 \* \* \* 1-5 — الجاي: /);
    expect(w(null)).toBe("عند الطلب");
    expect(w("nonsense")).toBe("nonsense");
  });
  it("a one-off says when", () => {
    expect(w(null, { kind: "once", runsAt: "2026-11-17T21:30:00Z" })).toMatch(/^مرة وحدة: /);
  });
  it("the clock says the day part the way the owner does", () => {
    expect(clockWords(0, 5)).toBe("12:05 بالليل");
    expect(clockWords(12, 0)).toBe("12:00 الظهر");
    expect(clockWords(19, 30)).toBe("7:30 المسا");
  });
});

describe("the seeded jobs on the map", () => {
  it("every seeded workflow has a number, a domain and a kind, and the numbers are 1..16 once each", () => {
    for (const s of SEED_WORKFLOWS) expect(SEED_JOB_META[s.key], s.key).toBeDefined();
    expect(Object.keys(SEED_JOB_META)).toHaveLength(SEED_WORKFLOWS.length);
    expect(Object.values(SEED_JOB_META).map((m) => m.number).sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });
  it("the table of 07-phases: night round is 1, the team round is 10 (ops), basha parcels is 16 (manual)", () => {
    expect(SEED_JOB_META["night-round"]).toEqual({ number: 1, domain: "ads", kind: "recurring" });
    expect(SEED_JOB_META["team-round"]).toMatchObject({ number: 10, domain: "ops" });
    expect(SEED_JOB_META["basha-parcels"]).toEqual({ number: 16, domain: "ops", kind: "manual" });
  });
});
