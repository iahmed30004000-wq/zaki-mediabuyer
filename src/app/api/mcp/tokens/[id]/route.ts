import { NextResponse } from "next/server";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { isMcpToken } from "@/core/token-scopes";
import { audit } from "@/server/audit";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/** DELETE /api/mcp/tokens/:id — stops a Claude token at once. The row stays (who made it, when), marked revoked. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const caller = await requireCapability("owner_only");
    const row = await db.apiToken.findUnique({ where: { id: params.id } });
    if (!row || !(isMcpToken(row.scopes) || row.scopes.includes("handoff"))) throw new HttpError(404, "التوكن مش موجود");
    if (!row.revokedAt) await db.apiToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    if (!caller.demo) await audit({ type: "user", id: caller.id }, "mcp.token_revoke", { type: "api_token", id: row.id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
