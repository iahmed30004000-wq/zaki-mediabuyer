/**
 * WRITES TO META (spec 9.1 «كل كتابة بمفتاح فريد + قراءة بعدها للتحقق»).
 *
 *   dry_run (the default) — nothing is sent; the item records exactly what WOULD be sent. This is how every rule runs
 *                           until the guard has passed its test on a test ad account (spec 14, Phase 2 gate).
 *   live                  — META_WRITE_MODE=live: POST the absolute value, then read the object back and compare.
 * Writes are absolute (a status, a budget), so repeating one is harmless; an item that already has an answer is never
 * sent again (its idempotency key is unique in the database). A create is never retried and is checked field by field
 * against its template (src/core/verify.ts) before anything is switched on. In dry_run a created object gets a unique
 * stand-in id (`dry_<ref>_<8 hex>`), so two dry launches never share one.
 */
import { randomUUID } from "node:crypto";
import type { MetaClient } from "./client";
import type { ChangeItemDraft } from "@/core/changeset";
import { READ_FIELDS, verifyCreated, type Mismatch } from "@/core/verify";
import type { Expectation } from "@/core/templates";

export type WriteMode = "dry_run" | "live";

export function writeMode(env: Record<string, string | undefined> = process.env): WriteMode {
  return env.META_WRITE_MODE === "live" ? "live" : "dry_run";
}

/** What goes to Meta for one item: budgets are in the account's minor units (cents for USD). */
export function payloadOf(item: ChangeItemDraft): Record<string, unknown> {
  if (item.op === "create") return item.after.payload ?? {};
  if (item.op === "pause") return { status: "PAUSED" };
  if (item.op === "resume") return { status: "ACTIVE" };
  return { daily_budget: Math.round((item.after.dailyBudget ?? 0) * 100) };
}

export interface ApplyResult {
  response: unknown;
  verified: boolean;
  readBack: Record<string, unknown> | null;
  /** the id Meta gave a created object */
  createdId?: string;
  mismatches?: Mismatch[];
}

export async function applyItem(item: ChangeItemDraft, mode: WriteMode, client: MetaClient | null): Promise<ApplyResult> {
  const payload = payloadOf(item);
  if (item.op === "create") {
    const ref = item.after.ref ?? "object";
    if (mode === "dry_run" || !client) return { response: { dryRun: true, wouldPost: { endpoint: item.after.endpoint, ...payload } }, verified: true, readBack: null, createdId: `dry_${ref}_${randomUUID().slice(0, 8)}` };
    const response = await client.post<{ id: string }>(item.after.endpoint ?? "", payload, { retry: false });
    const readBack = await client.get<Record<string, unknown>>(response.id, { fields: READ_FIELDS[item.objectType] });
    const expect = (item.after as { expect?: Expectation }).expect ?? { type: item.objectType };
    const mismatches = verifyCreated((item.after as { name?: string }).name ?? ref, readBack, expect);
    return { response, verified: mismatches.length === 0, readBack, createdId: response.id, mismatches };
  }
  if (mode === "dry_run" || !client) return { response: { dryRun: true, wouldPost: { id: item.objectId, ...payload } }, verified: true, readBack: null };
  const response = await client.post(item.objectId, payload);
  const readBack = await client.get<Record<string, unknown>>(item.objectId, { fields: "status,effective_status,daily_budget" });
  const verified = item.op === "set_budget" ? Number(readBack.daily_budget) === payload.daily_budget : readBack.status === payload.status;
  return { response, verified, readBack };
}
