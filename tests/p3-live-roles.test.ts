/**
 * Two small things of P3: a screen drawn on the server follows the live answer without a reload — it reads itself again only when what it shows changed (`liveSignature`, polled
 * every 5 seconds while a run is going and every 30 otherwise); and who may open the new addresses of «المهام».
 */
import { describe, expect, it } from "vitest";
import { LIVE_POLL_MS, liveSignature, livePollMs, type LiveOut, type LiveRunOut } from "@/core/jobs-live";
import { ROLES, canOpenPath } from "@/core/roles";

const run = (over: Partial<LiveRunOut> = {}): LiveRunOut => ({
  id: "r1", jobKey: "night", jobNumber: 1, jobName: "جولة", status: "running", lamp: "run", scheduledFor: null, startedAt: "2026-11-22T10:00:00.000Z", heartbeatAt: null, sentence: "", steps: [
    { id: "a", n: 1, no: "1.1", label: "أ", lamp: "done", note: null, startedAt: null, endedAt: null, error: null, inferred: false },
    { id: "b", n: 2, no: "1.2", label: "ب", lamp: "run", note: null, startedAt: null, endedAt: null, error: null, inferred: false },
  ], ...over,
});
const live = (runs: LiveRunOut[] = [run()], queue: LiveOut["queue"] = []): LiveOut => ({ at: "2026-11-22T10:00:00.000Z", agents: [], runs, queue });

describe("the live answer keeps a screen in step", () => {
  it("polls every 5 seconds while a run is going (queued · running · waiting), every 30 when nothing is", () => {
    expect(LIVE_POLL_MS).toEqual({ busy: 5_000, idle: 30_000 });
    expect(livePollMs(live([run()]))).toBe(5_000);
    expect(livePollMs(live([]))).toBe(30_000);
    expect(livePollMs(undefined)).toBe(30_000);
  });

  it("no answer yet is no signature (nothing is redrawn for nothing)", () => {
    expect(liveSignature(undefined)).toBeNull();
  });

  it("the same answer is the same signature; a step that moved, a new status, a heartbeat, a run that began or went away each change it", () => {
    const base = liveSignature(live());
    expect(liveSignature(live())).toBe(base);
    const moved = run({ steps: [{ ...run().steps[0]!, lamp: "done" }, { ...run().steps[1]!, lamp: "done" }] });
    expect(liveSignature(live([moved]))).not.toBe(base);
    expect(liveSignature(live([run({ status: "waiting" })]))).not.toBe(base);
    expect(liveSignature(live([run({ heartbeatAt: "2026-11-22T10:05:00.000Z" })]))).not.toBe(base);
    expect(liveSignature(live([run(), run({ id: "r2", jobKey: "stock" })]))).not.toBe(base);
    expect(liveSignature(live([]))).not.toBe(base);
    // the order the server listed them in does not matter
    expect(liveSignature(live([run({ id: "x" }), run({ id: "y" })]))).toBe(liveSignature(live([run({ id: "y" }), run({ id: "x" })])));
  });

  it("a request nobody took is part of it (taken → it changes); a screen about one job or one run ignores the others", () => {
    const withReq = liveSignature(live([run()], [{ id: "h1", jobKey: "stock", assignee: "claude", since: "2026-11-22T09:00:00.000Z", kind: "manual_run" }]));
    expect(withReq).not.toBe(liveSignature(live()));
    const other = live([run(), run({ id: "r2", jobKey: "stock", status: "queued" })]);
    expect(liveSignature(other, { jobKey: "night" })).toBe(liveSignature(live([run()]), { jobKey: "night" }));
    expect(liveSignature(other, { runId: "r2" })).not.toBe(liveSignature(other, { runId: "r1" }));
    // a run that finished is gone from the live list: the page of that run sees its signature become empty — and reads itself once
    expect(liveSignature(live([]), { runId: "r1" })).toBe("");
    expect(liveSignature(live([run()]), { runId: "r1" })).not.toBe("");
  });
});

describe("who may open «المهام»", () => {
  const can = (role: (typeof ROLES)[number], path: string) => canOpenPath(role, path);

  it("the owner, the managers, the team lead and the analyst open the lanes, the day, the list, the results and a job; each by the capability of work", () => {
    for (const role of ["OWNER", "MANAGER", "ADS_MANAGER", "OPS_MANAGER", "TEAM_LEAD", "ANALYST"] as const) for (const p of ["/tasks", "/tasks/day", "/tasks/all", "/tasks/results", "/tasks/results/run%3Ax", "/tasks/night", "/tasks/night/runs/r1"]) expect(can(role, p), `${role} ${p}`).toBe(true);
  });

  it("a member (own tasks only) opens the people's board and nothing else of it; a viewer has no work place at all", () => {
    expect(can("MEMBER", "/tasks/team")).toBe(true);
    for (const p of ["/tasks", "/tasks/day", "/tasks/all", "/tasks/results", "/tasks/night"]) expect(can("MEMBER", p), p).toBe(false);
    for (const p of ["/tasks", "/tasks/team", "/tasks/day"]) expect(can("VIEWER", p), p).toBe(false);
  });
});
