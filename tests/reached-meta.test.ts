import { describe, expect, it } from "vitest";
import { reachedMeta, trialSentence } from "@/core/reached-meta";
import { safetyAlertText } from "@/jobs/alerts";
import { changeViewState } from "@/lib/changes-view";


describe("did it reach Meta? (R-22)", () => {
  it("only a live, executed change set did — never a trial, a failure or something waiting", () => {
    expect(reachedMeta({ writeMode: "live", state: "executed" })).toBe(true);
    expect(reachedMeta({ writeMode: "live" })).toBe(true);
    expect(reachedMeta({ writeMode: "dry_run", state: "executed" })).toBe(false);
    expect(reachedMeta({ writeMode: "live", state: "failed" })).toBe(false);
    expect(reachedMeta({ writeMode: "live", state: "pending_approval" })).toBe(false);
    expect(reachedMeta({ writeMode: null })).toBe(false);
    expect(reachedMeta({})).toBe(false);
  });

  it("an upload: by its dry-run flag", () => {
    expect(reachedMeta({ dryRun: false })).toBe(true);
    expect(reachedMeta({ dryRun: true })).toBe(false);
  });

  it("a trial is said «تجربة: …», a real one as it was written", () => {
    expect(trialSentence(false, "وقّفت الإعلان X")).toBe("تجربة: وقّفت الإعلان X");
    expect(trialSentence(true, "وقّفت الإعلان X")).toBe("وقّفت الإعلان X");
  });

  it("the Telegram safety alert says «تنفّذ» only when it reached Meta", () => {
    expect(safetyAlertText("وقّفت X", true)).toBe("قرار أمان تنفّذ: وقّفت X");
    expect(safetyAlertText("وقّفت X", false)).toContain("تجربة");
    expect(safetyAlertText("وقّفت X", false)).not.toContain("تنفّذ");
  });

  it("the screens\u0027 states are the real ones (U-15): rejected is not «rolled back», approved is not «executed»", () => {
    expect(changeViewState("rejected")).toBe("rejected");
    expect(changeViewState("approved")).toBe("executing");
    expect(changeViewState("executing")).toBe("executing");
    expect(changeViewState("simulated")).toBe("pending_approval");
    expect(changeViewState("executed")).toBe("executed");
    expect(changeViewState("rolled_back")).toBe("rolled_back");
    expect(changeViewState("failed")).toBe("failed");
  });
});
