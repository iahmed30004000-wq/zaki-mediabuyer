/**
 * What a person chose to see in «الإعلانات» (v3 · C): which columns, in which order. Saved per person — the phone and the
 * desktop show the same table. Stored in the settings table under `ads.columns:<user id>`; whatever is read back goes
 * through `sanitizeColumns`, so an old or hand-edited value can never break the page.
 */
import type { Prisma } from "@prisma/client";
import { DEFAULT_COLUMNS, sanitizeColumns, type ColumnKey } from "@/core/ads-table";
import { db } from "./db";

const keyOf = (userId: string) => `ads.columns:${userId}`;

export async function loadColumns(userId: string | null): Promise<ColumnKey[]> {
  if (!userId) return [...DEFAULT_COLUMNS];
  const row = await db.setting.findUnique({ where: { key: keyOf(userId) } });
  return sanitizeColumns(row?.value);
}

export async function saveColumns(userId: string, columns: unknown): Promise<ColumnKey[]> {
  const value = sanitizeColumns(columns);
  const json = value as unknown as Prisma.InputJsonValue;
  await db.setting.upsert({
    where: { key: keyOf(userId) },
    create: { key: keyOf(userId), value: json, updatedBy: userId },
    update: { value: json, updatedBy: userId, version: { increment: 1 } },
  });
  return value;
}
