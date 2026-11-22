import { describe, expect, it } from "vitest";
import { CHAT_BYTES, CHAT_KEEP, trimChat } from "@/core/assistant";

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
