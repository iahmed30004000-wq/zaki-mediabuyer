/**
 * Telegram (spec 9.6) — outbound in Phase 1: reports and alerts to the owner's chat. The bot only ever talks to
 * the allowed chat ids. The token is part of Telegram's URL by design, so this module never logs a URL or an error
 * body that could carry it. «اوقف» from Telegram arrives in Phase 2; money is NEVER approved from here.
 */
export interface TelegramOptions {
  token: string;
  chatId: string;
  fetch?: typeof fetch;
}

export function telegramFromEnv(): TelegramOptions | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_OWNER_CHAT_ID?.trim();
  return token && chatId ? { token, chatId } : null;
}

/** Telegram's limit is 4096 characters: long reports go in parts, split on line breaks. */
export function splitMessage(text: string, max = 4000): string[] {
  const parts: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if ((cur + "\n" + line).length > max && cur) {
      parts.push(cur);
      cur = line;
    } else cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) parts.push(cur);
  return parts;
}

export async function sendTelegram(o: TelegramOptions, text: string): Promise<void> {
  for (const part of splitMessage(text)) {
    const res = await (o.fetch ?? fetch)(`https://api.telegram.org/bot${o.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: o.chatId, text: part, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Telegram answered ${res.status}`);
  }
}
