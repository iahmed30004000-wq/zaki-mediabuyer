/**
 * WRITES TO META (spec 9.1 «كل كتابة بمفتاح فريد + قراءة بعدها للتحقق»).
 *
 *   dry_run (the default) — nothing is sent; the item records exactly what WOULD be sent. This is how every rule runs
 *                           until the guard has passed its test on a test ad account (spec 14, Phase 2 gate).
 *   live                  — META_WRITE_MODE=live: POST the absolute value, then read the object back and compare.
 * Writes are absolute (a status, a budget), so repeating one is harmless; an item that already has an answer is never
 * sent again (its idempotency key is unique in the database).
 */
import type { MetaClient } from "./client";
import type { ChangeItemDraft } from "@/core/changeset";

export type WriteMode = "dry_run" | "live";

export function writeMode(env: Record<string, string | undefined> = process.env): WriteMode {
  return env.META_WRITE_MODE === "live" ? "live" : "dry_run";
}

/** What goes to Meta for one item: budgets are in the account's minor units (cents for USD). */
export function payloadOf(item: ChangeItemDraft): Record<string, string | number> {
  if (item.op === "pause") return { status: "PAUSED" };
  if (item.op === "resume") return { status: "ACTIVE" };
  return { daily_budget: Math.round((item.after.dailyBudget ?? 0) * 100) };
}

export interface ApplyResult {
  response: unknown;
  verified: boolean;
  readBack: Record<string, unknown> | null;
}

export async function applyItem(item: ChangeItemDraft, mode: WriteMode, client: MetaClient | null): Promise<ApplyResult> {
  const payload = payloadOf(item);
  if (mode === "dry_run" || !client) return { response: { dryRun: true, wouldPost: { id: item.objectId, ...payload } }, verified: true, readBack: null };
  const response = await client.post(item.objectId, payload);
  const readBack = await client.get<Record<string, unknown>>(item.objectId, { fields: "status,effective_status,daily_budget" });
  const verified = item.op === "set_budget" ? Number(readBack.daily_budget) === payload.daily_budget : readBack.status === payload.status;
  return { response, verified, readBack };
}
