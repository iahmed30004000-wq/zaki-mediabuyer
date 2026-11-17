import { beforeEach, describe, expect, it, vi } from "vitest";

/** The Telegram webhook after «اوقف» moved to src/server/stop-by-query.ts: same door, same answers. */
const s = vi.hoisted(() => ({ stops: [] as unknown[][], sent: [] as string[] }));
vi.mock("@/server/stop-by-query", () => ({ stopByQuery: async (...a: unknown[]) => (s.stops.push(a), "تم") }));
vi.mock("@/adapters/telegram", () => ({ telegramFromEnv: () => ({ token: "t" }), sendTelegram: async (_c: unknown, text: string) => void s.sent.push(text) }));

import { POST } from "@/app/api/telegram/webhook/route";

const post = (text: string, o: { secret?: string; chat?: number } = {}) =>
  POST(new Request("http://localhost/api/telegram/webhook", { method: "POST", headers: { "x-telegram-bot-api-secret-token": o.secret ?? "hook-secret" }, body: JSON.stringify({ message: { chat: { id: o.chat ?? 111 }, text } }) }));

beforeEach(() => {
  s.stops.length = 0;
  s.sent.length = 0;
  Object.assign(process.env, { TELEGRAM_WEBHOOK_SECRET: "hook-secret", TELEGRAM_OWNER_CHAT_ID: "111", TELEGRAM_ALLOWED_CHAT_IDS: "222" });
});

describe("Telegram webhook", () => {
  it("a wrong secret is 401 and nothing runs", async () => {
    expect((await post("اوقف CR00147", { secret: "nope" })).status).toBe(401);
    expect(s.stops).toEqual([]);
  });
  it("a stranger's chat is heard by nobody", async () => {
    expect((await post("اوقف CR00147", { chat: 999 })).status).toBe(200);
    expect(s.stops).toEqual([]);
    expect(s.sent).toEqual([]);
  });
  it("«اوقف» from the owner or an allowed chat runs the shared stop and sends its answer", async () => {
    await post("اوقف CR00147");
    await post("اوقف CR00148", { chat: 222 });
    expect(s.stops).toEqual([["CR00147", { id: "telegram:111" }, "111"], ["CR00148", { id: "telegram:222" }, "222"]]);
    expect(s.sent).toEqual(["تم", "تم"]);
  });
  it("a request to spend is answered with the site and does not stop anything", async () => {
    await post("زيد الميزانية");
    expect(s.stops).toEqual([]);
    expect(s.sent[0]).toContain("من الموقع بس");
  });
});
