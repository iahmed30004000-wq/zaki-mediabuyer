/**
 * THE REPLIES ADAPTER (spec 9.3) — read only. One door: `GET {REPLIES_BASE_URL}/api/v1/capacity` with a Bearer token
 * (scope `capacity.read` on the replies side). The answer is counts and minutes — never a name, a phone or a message.
 * Anything that looks like customer data in the answer is refused, not stored.
 */
import { z } from "zod";
import type { CapacityReading } from "@/core/replies";

export const RepliesCapacity = z
  .object({
    unanswered: z.number().int().nonnegative(),
    first_response_p50_min: z.number().nonnegative().nullable().optional(),
    by_channel: z.record(z.number().int().nonnegative()).optional(),
    at: z.string().datetime({ offset: true }),
  })
  .strict();

export interface RepliesOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
}

export function repliesFromEnv(fetchImpl?: typeof fetch): RepliesOptions | null {
  const baseUrl = process.env.REPLIES_BASE_URL?.trim();
  const token = process.env.REPLIES_TOKEN?.trim();
  return baseUrl && token ? { baseUrl, token, fetch: fetchImpl } : null;
}

export async function readCapacity(o: RepliesOptions): Promise<CapacityReading> {
  const res = await (o.fetch ?? fetch)(`${o.baseUrl.replace(/\/$/, "")}/api/v1/capacity`, {
    headers: { authorization: `Bearer ${o.token}`, "x-request-id": crypto.randomUUID() },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Replies /capacity answered ${res.status}`);
  const j = RepliesCapacity.parse(await res.json());
  return { unanswered: j.unanswered, firstResponseP50Min: j.first_response_p50_min ?? null, byChannel: j.by_channel ?? {}, at: new Date(j.at) };
}
