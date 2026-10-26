/**
 * Tokens for other systems (the content studio). The token is random, shown once, and only its sha256 is stored, so a
 * leaked database opens nothing. Every refusal is `{code, message}` — the studio shows `message` and keys on `code`.
 */
import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import type { Scope } from "@/core/studio-contract";
import { db } from "./db";

const PREFIX = "mbs_";

export function newToken(): string {
  return PREFIX + randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export class ContractError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function contractResponse(e: unknown) {
  if (e instanceof ContractError) return NextResponse.json({ code: e.code, message: e.message }, { status: e.status });
  console.error(e);
  return NextResponse.json({ code: "server_error", message: "صار خطأ عند الميديا باير، جرّب بعدين" }, { status: 500 });
}

/** The caller's token must exist, be live and carry `scope`. */
export async function requireToken(req: Request, scope: Scope) {
  const m = /^Bearer\s+(\S+)$/.exec(req.headers.get("authorization") ?? "");
  if (!m) throw new ContractError(401, "unauthorized", "ما في توكن");
  const token = await db.apiToken.findUnique({ where: { tokenHash: hashToken(m[1]!) } });
  if (!token || token.revokedAt) throw new ContractError(401, "unauthorized", "التوكن مرفوض");
  if (!token.scopes.includes(scope)) throw new ContractError(403, "forbidden", "التوكن ما إله صلاحية لهالعملية");
  // at most one write a minute per token, so a busy sync does not hammer the table
  if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > 60_000) {
    await db.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } });
  }
  return token;
}
