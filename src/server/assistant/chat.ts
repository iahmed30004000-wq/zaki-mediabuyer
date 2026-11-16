/**
 * THE KEPT CONVERSATION (v3 · H): one per signed-in person. The panel saves what it shows after each answer and asks for it when
 * it opens; «محادثة جديدة» clears it. Words that carry a phone number, an e-mail or a key are never stored. The demo caller has none.
 */
import { z } from "zod";
import { trimChat } from "@/core/assistant";
import { privacyHits } from "@/gateway/privacy";
import { db } from "../db";

export const ChatMessage = z
  .object({ me: z.boolean(), text: z.string().max(8000) })
  .passthrough();
export const ChatBody = z.object({ messages: z.array(ChatMessage).max(80) }).strict();
export type ChatMessageT = z.infer<typeof ChatMessage>;

export async function loadChat(userId: string): Promise<ChatMessageT[]> {
  const row = await db.assistantChat.findUnique({ where: { userId } });
  const parsed = z.array(ChatMessage).safeParse(row?.messages);
  return parsed.success ? parsed.data : [];
}

/** Keeps the last messages (trimmed to fit). Returns false when a message carries what must not be stored — nothing is saved then. */
export async function saveChat(userId: string, messages: ChatMessageT[]): Promise<boolean> {
  const kept = trimChat(messages);
  if (privacyHits(kept.map((m) => m.text).join(" \n ")).length) return false;
  if (!kept.length) {
    await db.assistantChat.deleteMany({ where: { userId } });
    return true;
  }
  const data = JSON.parse(JSON.stringify(kept));
  await db.assistantChat.upsert({ where: { userId }, create: { userId, messages: data }, update: { messages: data } });
  return true;
}

export async function clearChat(userId: string): Promise<void> {
  await db.assistantChat.deleteMany({ where: { userId } });
}
