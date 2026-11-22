import { describe, expect, it } from "vitest";
import { stopResult, stopSentence } from "@/core/stop-result";

const item = (id: string, over: Record<string, unknown> | null = { verified: true }) => ({ objectId: id, verifyResult: over });

describe("the full stop says ONE of four sentences (R-04)", () => {
  it("«انوقف N حملة»: every campaign was paused on Meta", () => {
    const r = stopResult({ objects: 3, changeSetId: "cs1", csState: "executed", writeMode: "live", csError: null, items: [item("a"), item("b"), item("c")] });
    expect(r).toMatchObject({ state: "stopped", done: 3, failed: 0, reachedMeta: true });
    expect(stopSentence(r)).toBe("انوقف 3 حملة");
  });

  it("«ما في حملات شغّالة»: nothing to stop", () => {
    const r = stopResult({ objects: 0, changeSetId: null, csState: "none", writeMode: "dry_run", csError: null, items: [] });
    expect(r.state).toBe("none");
    expect(stopSentence(r)).toBe("ما في حملات شغّالة");
  });

  it("«تجربة: ما انبعت لميتا»: it ran as a trial — never «انوقف»", () => {
    const r = stopResult({ objects: 2, changeSetId: "cs1", csState: "executed", writeMode: "dry_run", csError: null, items: [item("a"), item("b")] });
    expect(r).toMatchObject({ state: "trial", reachedMeta: false });
    expect(stopSentence(r)).toBe("تجربة: ما انبعت لميتا");
    expect(stopSentence(r)).not.toContain("انوقف");
  });

  it("«انوقف N وفشل M: …»: some failed, and the reason is said", () => {
    const r = stopResult({ objects: 3, changeSetId: "cs1", csState: "failed", writeMode: "live", csError: "verify_mismatch: x", items: [item("a"), item("b", { verified: false, error: "الحملة محذوفة على ميتا" }), item("c")] });
    expect(r).toMatchObject({ state: "partial", done: 2, failed: 1, reachedMeta: true });
    expect(stopSentence(r)).toBe("انوقف 2 وفشل 1: الحملة محذوفة على ميتا");
  });

  it("nothing was tried (the live write was refused before it began): all failed, with the change set\u0027s reason", () => {
    const r = stopResult({ objects: 2, changeSetId: "cs1", csState: "failed", writeMode: "dry_run", csError: "الكتابة على ميتا مقفولة", items: [item("a", null), item("b", null)] });
    expect(r).toMatchObject({ state: "partial", done: 0, failed: 2, reachedMeta: false });
    expect(stopSentence(r)).toBe("انوقف 0 وفشل 2: الكتابة على ميتا مقفولة");
  });

  it("a stop that waits for a person is not called done", () => {
    const r = stopResult({ objects: 2, changeSetId: "cs1", csState: "pending_approval", writeMode: "live", csError: "loop_guard", items: [item("a", null)] });
    expect(r.state).toBe("waiting");
    expect(stopSentence(r)).not.toContain("انوقف");
  });
});
