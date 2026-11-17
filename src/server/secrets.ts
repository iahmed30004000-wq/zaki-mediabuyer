/**
 * SECRETS ENTERED FROM THE SITE, at rest (D62): AES-256-GCM, the key from ONE environment variable — `SECRETS_MASTER_KEY`, the only secret left in Coolify for them.
 * The name of the value is bound into the ciphertext (additional authenticated data), so a stored blob cannot be moved under another name. A wrong or missing key
 * never throws into a screen: it answers null / a sentence, and nothing is guessed. Nothing here logs.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "s1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** 32 bytes as base64 (`openssl rand -base64 32`) or 64 hex characters. Anything else is not a key. */
export function parseMasterKey(raw: string | undefined): Buffer | null {
  const v = raw?.trim();
  if (!v) return null;
  if (/^[0-9a-fA-F]{64}$/.test(v)) return Buffer.from(v, "hex");
  try {
    const b = Buffer.from(v, "base64");
    return b.length === 32 && b.toString("base64").replace(/=+$/, "") === v.replace(/=+$/, "") ? b : null;
  } catch {
    return null;
  }
}

const masterKey = () => parseMasterKey(process.env.SECRETS_MASTER_KEY);
export const masterKeyConfigured = (): boolean => masterKey() !== null;

/** The sentence for the owner when a secret cannot be stored. */
export const MASTER_KEY_MISSING = "حط SECRETS_MASTER_KEY بـ Coolify مرة وحدة (32 بايت، مثلاً: openssl rand -base64 32) — بعدها بتحفظ المفاتيح من هون";

export function sealSecret(name: string, plain: string, key: Buffer | null = masterKey()): string {
  if (!key) throw new Error("SECRETS_MASTER_KEY is not set");
  const iv = randomBytes(IV_BYTES);
  const c = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  c.setAAD(Buffer.from(name, "utf8"));
  const data = Buffer.concat([c.update(Buffer.from(plain, "utf8")), c.final()]);
  return `${PREFIX}${iv.toString("base64url")}.${data.toString("base64url")}.${c.getAuthTag().toString("base64url")}`;
}

/** null when the blob is malformed, tampered with, bound to another name, or the key is missing or different. */
export function openSecret(name: string, blob: string | null | undefined, key: Buffer | null = masterKey()): string | null {
  if (!blob || !blob.startsWith(PREFIX) || !key) return null;
  const parts = blob.slice(PREFIX.length).split(".");
  if (parts.length !== 3) return null;
  try {
    const iv = Buffer.from(parts[0]!, "base64url");
    const data = Buffer.from(parts[1]!, "base64url");
    const tag = Buffer.from(parts[2]!, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
    const d = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    d.setAAD(Buffer.from(name, "utf8"));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
