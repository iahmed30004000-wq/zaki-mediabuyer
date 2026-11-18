/**
 * HERMES (v3 · D) — the agent of hooks and scenarios. A request about a video reaches it one of two ways:
 *   the API   POST {HERMES_BASE_URL}/requests   with   Authorization: Bearer {HERMES_TOKEN}   and the payload as JSON
 *             (any 2xx = delivered; the shape is `RequestPayload` in src/core/video-board.ts, documented in docs/DECISIONS.md D29)
 *   a chat    the owner's Telegram bot, to TELEGRAM_HERMES_CHAT_ID: plain lines, links only to Drive and to the app
 * and Hermes can always pull instead: GET /api/v1/video-requests with a «طابور التسليم» token, claim, complete.
 * Nothing here carries a customer's detail. The token is never logged: an error says the status only.
 */
import { requestText, type RequestPayload } from "@/core/video-board";
import { sendTelegram, type TelegramOptions } from "./telegram";

export interface HermesOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
}

export function hermesFromEnv(): HermesOptions | null {
  const baseUrl = process.env.HERMES_BASE_URL?.trim();
  const token = process.env.HERMES_TOKEN?.trim();
  return baseUrl && token ? { baseUrl: baseUrl.replace(/\/+$/, ""), token } : null;
}

/** The chat Hermes listens on: the owner's bot, a chat of its own (never the owner's private one by accident — it is its own key). */
export function hermesChatFromEnv(): TelegramOptions | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_HERMES_CHAT_ID?.trim();
  return token && chatId ? { token, chatId } : null;
}

export async function sendToHermesApi(o: HermesOptions, payload: RequestPayload): Promise<void> {
  const res = await (o.fetch ?? fetch)(`${o.baseUrl}/requests`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${o.token}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Hermes answered ${res.status}`);
}

export async function sendToHermesChat(o: TelegramOptions, payload: RequestPayload): Promise<void> {
  await sendTelegram(o, requestText(payload));
}
