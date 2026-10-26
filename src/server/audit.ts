import type { Prisma } from "@prisma/client";
import { db } from "./db";

export type Actor = { type: "user"; id: string } | { type: "rule"; id: string } | { type: "agent"; id: string } | { type: "system"; id?: string };

/** Keys that never reach the audit log, at any depth (a token, a hash, a customer reference). */
const SECRET_KEYS = /token|secret|password|hash|capiRef|phone|fbc|fbp|ctwa|psid/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEYS.test(k) ? "[redacted]" : redact(v)]));
  }
  return value;
}

/** Who did what to what (spec 18 S18). Append-only; secrets are redacted before they are written. */
export async function audit(actor: Actor, action: string, target?: { type: string; id: string }, change?: { before?: unknown; after?: unknown }) {
  await db.auditLog.create({
    data: {
      actorType: actor.type,
      actorId: actor.id ?? null,
      action,
      targetType: target?.type ?? null,
      targetId: target?.id ?? null,
      before: change?.before === undefined ? undefined : (redact(change.before) as Prisma.InputJsonValue),
      after: change?.after === undefined ? undefined : (redact(change.after) as Prisma.InputJsonValue),
    },
  });
}
