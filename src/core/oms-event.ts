import { z } from "zod";
import { parseTelegram } from "./telegram-command";

/**
 * The signed «اوقف» event the OMS sends (contracts/oms-mediabuyer.v1.json → oms.stop-event). The OMS owns the Telegram bot; when
 * the owner writes «اوقف CR00147» it forwards the words as `owner.stop_requested`. Pure: the shape, and what the words mean here.
 * The signature itself is `verifySignature` of src/core/step-exec.ts (the same «<timestamp>.<body>» HMAC of the other signed doors).
 */
export const STOP_EVENT = "owner.stop_requested";
/** A stop event is a few words: a body bigger than this is refused before it is parsed. */
export const MAX_BODY_BYTES = 4096;

const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const stopEvent = z
  .object({
    event: z.literal(STOP_EVENT),
    at: z.string().regex(AT),
    data: z.object({ query: z.string().min(1).max(200), source_chat: z.enum(["owner", "allowed"]).optional() }).strict(),
  })
  .strict();

export type StopEvent = { query: string; sourceChat: "owner" | "allowed" };

/** The body as the schema allows it (an unknown event or an extra field is a refusal), else why not. */
export function parseStopEvent(raw: string): { ok: true; event: StopEvent } | { ok: false } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  const p = stopEvent.safeParse(json);
  if (!p.success) return { ok: false };
  return { ok: true, event: { query: p.data.data.query, sourceChat: p.data.data.source_chat ?? "owner" } };
}

/**
 * What the words ask for. The OMS sends the thing to stop («CR00147»), but if the whole sentence arrives («اوقف CR00147») the verb is dropped,
 * and a sentence that asks to raise, resume, create or approve is answered with the site — this door only ever lowers spend.
 */
export function stopTarget(query: string): { kind: "pause"; query: string } | { kind: "site_only"; what: string } {
  const own = parseTelegram(query);
  if (own.kind === "site_only") return own;
  if (own.kind === "pause") return own;
  const asPause = parseTelegram(`اوقف ${query}`);
  return asPause.kind === "pause" ? asPause : { kind: "pause", query: query.trim() };
}
