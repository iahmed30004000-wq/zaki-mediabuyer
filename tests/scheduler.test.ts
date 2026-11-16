import { describe, expect, it } from "vitest";
import { LOOKBACK_MIN, dueRuns, fires, schedulerOn, type Schedulable } from "@/core/scheduler";
import { CHAT_BYTES, CHAT_KEEP, trimChat } from "@/core/assistant";

const w = (key: string, schedule: string | null, over: Partial<Schedulable> = {}): Schedulable => ({ key, schedule, enabled: true, archivedAt: null, permission: "green", ...over });
// 10:43 Amman = 07:43 UTC
const AT = (hh: number, mm: number, ss = 0) => new Date(Date.UTC(2026, 10, 16, hh, mm, ss));

describe("the site's own clock", () => {
  it("is off unless SITE_SCHEDULER is exactly 1", () => {
    expect(schedulerOn({ SITE_SCHEDULER: "1" })).toBe(true);
    for (const v of [undefined, "", "0", "true", "yes"]) expect(schedulerOn({ SITE_SCHEDULER: v })).toBe(false);
  });

  it("fires only a workflow that is on, not put away, not black, with a schedule that reads", () => {
    expect(fires(w("a", "43 10 * * *"))).toBe(true);
    expect(fires(w("a", null))).toBe(false);
    expect(fires(w("a", "هلق"))).toBe(false);
    expect(fires(w("a", "43 10 * * *", { enabled: false }))).toBe(false);
    expect(fires(w("a", "43 10 * * *", { archivedAt: new Date() }))).toBe(false);
    expect(fires(w("a", "43 10 * * *", { permission: "black" }))).toBe(false);
  });

  it("a workflow is due in the minute its time comes, and for a few minutes after (a late tick is not a lost run)", () => {
    const list = [w("daily", "43 10 * * *")];
    expect(dueRuns(list, AT(7, 43, 20))).toEqual([{ key: "daily", at: AT(7, 43), slot: "2026-11-16T07:43" }]);
    expect(dueRuns(list, AT(7, 47, 59)).map((d) => d.slot)).toEqual(["2026-11-16T07:43"]);
    expect(dueRuns(list, AT(7, 42, 59))).toEqual([]);
    expect(dueRuns(list, AT(7, 43 + LOOKBACK_MIN, 30))).toEqual([]);
  });

  it("only the latest due time of a workflow counts: an hour of downtime is not replayed as six runs", () => {
    const list = [w("often", "*/5 * * * *")];
    const due = dueRuns(list, AT(8, 0, 10));
    expect(due).toHaveLength(1);
    expect(due[0]!.slot).toBe("2026-11-16T08:00");
    expect(dueRuns(list, AT(8, 3, 0))[0]!.slot).toBe("2026-11-16T08:00");
  });

  it("the same minute is the same slot (that is what makes firing it twice impossible), and the clock is Amman's", () => {
    const list = [w("daily", "43 10 * * *")];
    expect(dueRuns(list, AT(7, 43, 1))[0]!.slot).toBe(dueRuns(list, AT(7, 45, 50))[0]!.slot);
    // 10:43 UTC is 13:43 in Amman: not due
    expect(dueRuns(list, AT(10, 43, 5))).toEqual([]);
  });

  it("several workflows each get their own", () => {
    const due = dueRuns([w("a", "43 10 * * *"), w("b", "44 10 * * *"), w("off", "43 10 * * *", { enabled: false }), w("none", null)], AT(7, 45));
    expect(due.map((d) => d.key)).toEqual(["a", "b"]);
  });
});

describe("the kept conversation", () => {
  const msg = (i: number, extra: Record<string, unknown> = {}) => ({ me: i % 2 === 0, text: `رسالة ${i}`, ...extra });

  it("keeps the last messages", () => {
    const many = Array.from({ length: CHAT_KEEP + 12 }, (_, i) => msg(i));
    const kept = trimChat(many);
    expect(kept).toHaveLength(CHAT_KEEP);
    expect(kept[0]!.text).toBe("رسالة 12");
    expect(trimChat([])).toEqual([]);
  });

  it("when it is too big the cards and numbers of the older messages go first — their words stay", () => {
    const fat = { facts: [{ label: "x".repeat(60_000) }], artifacts: [{ kind: "prompt_draft", text: "y".repeat(60_000) }], sources: [{ id: "s" }] };
    const kept = trimChat([msg(0, fat), msg(1, fat), msg(2, fat), msg(3, fat), msg(4)]);
    expect(JSON.stringify(kept).length).toBeLessThanOrEqual(CHAT_BYTES);
    expect(kept.map((m) => m.text)).toEqual(["رسالة 0", "رسالة 1", "رسالة 2", "رسالة 3", "رسالة 4"].slice(-kept.length));
    expect((kept[0] as Record<string, unknown>).facts).toBeUndefined();
  });

  it("if the words alone are too big, the oldest messages go", () => {
    const big = (i: number) => ({ me: true, text: `${i}${"ب".repeat(5000)}` });
    const kept = trimChat(Array.from({ length: 30 }, (_, i) => big(i)).concat(Array.from({ length: 0 }, () => big(0))));
    expect(JSON.stringify(kept).length).toBeLessThanOrEqual(CHAT_BYTES);
    expect(kept.at(-1)!.text.startsWith("29")).toBe(true);
  });
});
