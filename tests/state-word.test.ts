import { describe, expect, it } from "vitest";
import { STATE_WORDS, WORD_STATES, runWordState, wordOf } from "@/core/state-word";
import { runLamp, type Lamp } from "@/core/run-state";

describe("one word for each state (03-look §9)", () => {
  it("the words of the table, each with its lamp", () => {
    expect(STATE_WORDS.done).toMatchObject({ lamp: "done", word: "خلصت" });
    expect(STATE_WORDS.run).toMatchObject({ lamp: "run", word: "شغّالة" });
    expect(STATE_WORDS.approval).toMatchObject({ lamp: "wait", word: "بدها موافقتك" });
    expect(STATE_WORDS.stuck).toMatchObject({ lamp: "wait", word: "واقفة — بدها حدا" });
    expect(STATE_WORDS.fail).toMatchObject({ lamp: "fail", word: "وقفت" });
    expect(STATE_WORDS.missed).toMatchObject({ lamp: "missed", word: "فاتت" });
    expect(STATE_WORDS.lost).toMatchObject({ lamp: "fail", word: "انقطعت" });
    expect(STATE_WORDS.skipped.word).toBe("انتخطت");
    expect(STATE_WORDS.job_on.word).toBe("مفعّلة");
    expect(STATE_WORDS.job_off.word).toBe("مطفية");
  });

  it("every state has a word, and no two states share one (the same word never means two things)", () => {
    const words = WORD_STATES.map((s) => STATE_WORDS[s].word);
    expect(new Set(words).size).toBe(words.length);
    for (const s of WORD_STATES) expect(STATE_WORDS[s].word.length).toBeGreaterThan(1);
  });

  it("the two spellings that differ by one letter are gone", () => {
    for (const s of WORD_STATES) expect(STATE_WORDS[s].word).not.toMatch(/موقوفة|متوقفة/);
  });

  it("colour is state: green done, blue running, orange needs you, red stopped, grey for the rest", () => {
    expect(STATE_WORDS.done.tone).toBe("ok");
    expect(STATE_WORDS.run.tone).toBe("info");
    expect(STATE_WORDS.approval.tone).toBe("warn");
    expect(STATE_WORDS.fail.tone).toBe("danger");
    for (const s of ["missed", "skipped", "next", "job_off"] as const) expect(STATE_WORDS[s].tone).toBe("muted");
  });

  it("«بانتظار» names who it waits for", () => {
    expect(wordOf("queued", "Claude الرئيسي").word).toBe("بانتظار Claude الرئيسي");
    expect(wordOf("queued", "  ").word).toBe("بانتظار حدا ياخدها");
    expect(wordOf("queued").word).toBe("بانتظار حدا ياخدها");
    expect(wordOf("done", "Claude").word).toBe("خلصت");
  });

  it("a run's status becomes its word; a run that waits is on the owner or on a step", () => {
    expect(runWordState("queued")).toBe("queued");
    expect(runWordState("running")).toBe("run");
    expect(runWordState("waiting", "approval")).toBe("approval");
    expect(runWordState("waiting")).toBe("approval");
    expect(runWordState("waiting", "step")).toBe("stuck");
    expect(runWordState("ok")).toBe("done");
    expect(runWordState("failed")).toBe("fail");
    expect(runWordState("missed")).toBe("missed");
    expect(runWordState("lost")).toBe("lost");
    expect(runWordState("skipped")).toBe("skipped");
    expect(runWordState("something-new")).toBe("next");
  });

  it("the lamp of a word is the lamp of the run it describes (one vocabulary, not two)", () => {
    const statuses = ["queued", "running", "waiting", "ok", "failed", "missed", "lost"] as const;
    for (const status of statuses) {
      const lamp: Lamp = STATE_WORDS[runWordState(status)].lamp;
      expect(lamp, status).toBe(runLamp({ status }));
    }
  });
});
