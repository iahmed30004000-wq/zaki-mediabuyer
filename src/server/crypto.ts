/**
 * Secrets at rest (Meta tokens, the CAPI references): AES-256-GCM with a key derived from ENCRYPTION_KEY.
 * Adapted from Zaki Workspace's helper, without its legacy v1 path: this system starts on v2, and it REFUSES to
 * store a secret when no key is configured (spec 3.7 — a token is never written in the clear).
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

const PREFIX = "v2:";
const MIN_KEY_LENGTH = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function key(): Buffer {
  const raw = process.env["ENCRYPTION_KEY"];
  if (!raw || raw.trim() === "") throw new Error("ENCRYPTION_KEY is not set: secrets cannot be stored");
  if (raw.length < MIN_KEY_LENGTH) throw new Error(`ENCRYPTION_KEY must be at least ${MIN_KEY_LENGTH} characters`);
  return Buffer.from(hkdfSync("sha256", raw, "zaki-mediabuyer", "secrets-at-rest:v2", 32));
}

export function encryptionKeyConfigured(): boolean {
  const raw = process.env["ENCRYPTION_KEY"];
  return Boolean(raw && raw.trim().length >= MIN_KEY_LENGTH);
}

export function encryptSecrets(plain: unknown): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv, { authTagLength: TAG_BYTES });
  const data = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(plain), "utf8")), cipher.final()]);
  return `${PREFIX}${iv.toString("base64url")}.${data.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

/** null when the blob is malformed, tampered with or unreadable with the current key. */
export function decryptSecrets<T>(blob: string | null | undefined): T | null {
  if (!blob || !blob.startsWith(PREFIX)) return null;
  const parts = blob.slice(PREFIX.length).split(".");
  if (parts.length !== 3) return null;
  try {
    const iv = Buffer.from(parts[0]!, "base64url");
    const data = Buffer.from(parts[1]!, "base64url");
    const tag = Buffer.from(parts[2]!, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function hmacHex(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
