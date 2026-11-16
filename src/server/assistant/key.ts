/**
 * Where the Claude key comes from: Coolify's ANTHROPIC_API_KEY (or CLAUDE_API_KEY) first — it always wins — else the key the owner
 * linked from the site, stored encrypted in ModelConnection. The value is handed only to the model client; never to a screen or a log.
 */
import { decryptSecrets } from "../crypto";
import { db } from "../db";
import { anthropicKey } from "../env";

export type KeySource = "env" | "site";
export interface ResolvedKey {
  key: string;
  source: KeySource;
}

let memo: { at: number; value: ResolvedKey | null } | null = null;
const TTL_MS = 30_000;

/** Forget what was read (after the owner links or unlinks a key, and in tests). */
export function forgetKeyCache(): void {
  memo = null;
}

/** The key to use now, or null. A database that cannot be read counts as «no site key» — the environment still answers. */
export async function resolveKey(): Promise<ResolvedKey | null> {
  const env = anthropicKey();
  if (env) return { key: env, source: "env" };
  if (memo && Date.now() - memo.at < TTL_MS) return memo.value;
  let value: ResolvedKey | null = null;
  try {
    const row = await db.modelConnection.findUnique({ where: { provider: "anthropic" }, select: { keyEnc: true, status: true } });
    if (row && row.status === "active" && row.keyEnc) {
      const plain = decryptSecrets<{ key?: string }>(row.keyEnc);
      if (plain?.key) value = { key: plain.key, source: "site" };
    }
  } catch {
    value = null;
  }
  memo = { at: Date.now(), value };
  return value;
}
