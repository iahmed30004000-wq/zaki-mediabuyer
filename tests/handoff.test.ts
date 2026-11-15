import { describe, expect, it } from "vitest";
import { ASSIGNEES, HANDOFF_KINDS, KIND_AR, assigneeLabel, canMove, firstStep, isClaude, newRunRef, runStatusAfter, waitingMinutes, waitingText } from "@/core/handoff";
import { SEED_WORKFLOWS } from "@/core/workflow";

describe("the handoff queue (v3 · F)", () => {
  it("every kind has its words", () => {
    for (const k of HANDOFF_KINDS) expect(KIND_AR[k], k).toBeTruthy();
  });

  it("who it can be given to from the site; any other key is shown as it is", () => {
    expect(ASSIGNEES.map((a) => a.key)).toEqual(["claude", "claude_desktop", "hermes", "muse"]);
    expect(assigneeLabel("claude_desktop")).toBe("Claude Desktop");
    expect(assigneeLabel("abdullah")).toBe("abdullah");
  });

  it("every kind of Claude reads the same queue", () => {
    expect(isClaude("claude")).toBe(true);
    expect(isClaude("claude_desktop")).toBe(true);
    expect(isClaude("claude_task")).toBe(true);
    expect(isClaude("hermes")).toBe(false);
  });

  it("a handoff is taken, answered or cancelled once; giving it away reopens it; an answered one stays answered", () => {
    expect(canMove("open", "claimed")).toBe(true);
    expect(canMove("open", "done")).toBe(true);
    expect(canMove("claimed", "open")).toBe(true);
    expect(canMove("claimed", "done")).toBe(true);
    expect(canMove("open", "open")).toBe(false);
    expect(canMove("done", "open")).toBe(false);
    expect(canMove("done", "cancelled")).toBe(false);
    expect(canMove("cancelled", "claimed")).toBe(false);
  });

  it("the run the owner asked for ends with the answer; a stuck step only unblocks its run — unless the answer says how it ended", () => {
    expect(runStatusAfter("manual_run")).toBe("ok");
    expect(runStatusAfter("node_failed")).toBe("running");
    expect(runStatusAfter("missing_connection")).toBe("running");
    expect(runStatusAfter("node_failed", "ok")).toBe("ok");
    expect(runStatusAfter("manual_run", "failed")).toBe("failed");
  });

  it("a manual run waits on the first step after the trigger", () => {
    for (const s of SEED_WORKFLOWS) {
      const step = firstStep(s.graph);
      expect(step, s.key).toBeTruthy();
      expect(step!.type, s.key).not.toBe("trigger");
    }
  });

  it("the run ref says what it is and when, and stays readable and safe", () => {
    const now = new Date("2026-11-15T09:05:03Z");
    expect(newRunRef("manual_run", now, "Ab-12zz")).toBe("manual-20261115-090503-ab12");
    expect(newRunRef("node_failed", now, "")).toBe("handoff-20261115-090503-x");
    expect(newRunRef("timeout", now, "q")).toMatch(/^handoff-\d{8}-\d{6}-q$/);
  });

  it("how long it has waited, in the owner's words", () => {
    const t0 = Date.parse("2026-11-15T09:00:00Z");
    const at = (min: number) => waitingMinutes("2026-11-15T09:00:00Z", t0 + min * 60_000);
    expect(at(0)).toBe(0);
    expect(at(-5)).toBe(0);
    expect(waitingText(0)).toBe("هلأ");
    expect(waitingText(5)).toBe("من 5 دقيقة");
    expect(waitingText(60)).toBe("من ساعة");
    expect(waitingText(120)).toBe("من ساعتين");
    expect(waitingText(5 * 60)).toBe("من 5 ساعات");
    expect(waitingText(24 * 60)).toBe("من يوم");
    expect(waitingText(3 * 24 * 60)).toBe("من 3 أيام");
  });
});
