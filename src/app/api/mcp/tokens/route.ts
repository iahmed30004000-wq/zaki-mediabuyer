import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { MCP_SCOPES, normalizeScopes } from "@/core/token-scopes";
import { hashToken, newToken } from "@/server/api-token";
import { loadDirectory } from "@/server/directory";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { appOrigin } from "@/server/env";

export const dynamic = "force-dynamic";

/** `mcp` = the connector Claude adds (also reads and answers the handoff queue) · `handoff` = a token for the queue only (Claude Desktop polling the REST API). */
/** `scopes` (only for `mcp`) are the finer ones of docs/rebuild/05-permissions.md §5; none = the old full token. `actorKey` ties the token to an agent of the team directory. */
const Body = z.object({ name: z.string().trim().min(1).max(60), kind: z.enum(["mcp", "handoff"]).default("mcp"), scopes: z.array(z.enum(MCP_SCOPES)).max(7).optional(), actorKey: z.string().trim().max(32).optional() });

/** GET /api/mcp/tokens — Claude's tokens (never the secret part) and the addresses to give Claude. Owner only. */
export async function GET() {
  try {
    await requireCapability("owner_only");
    const tokens = await db.apiToken.findMany({ where: { oauthClientId: null, OR: [{ scopes: { has: "mcp" } }, { scopes: { has: "handoff" } }, { scopes: { hasSome: [...MCP_SCOPES] } }] }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, prefix: true, scopes: true, actorKey: true, lastUsedAt: true, revokedAt: true, createdAt: true } });
    return NextResponse.json({ tokens, url: `${appOrigin()}/mcp`, handoffUrl: `${appOrigin()}/api/v1/handoffs` });
  } catch (e) {
    return errorResponse(e);
  }
}

/** POST /api/mcp/tokens — a new token for Claude. The whole token is in THIS answer only; the database keeps its sha256. */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("owner_only");
    if (caller.demo) throw new HttpError(403, "بلا تسجيل دخول ما بينعمل توكن");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "اكتب اسم للتوكن (مثلاً «Claude الرئيسي»)");
    const { name, kind } = parsed.data;
    const scopes = kind === "mcp" ? normalizeScopes(parsed.data.scopes) : ["handoff"];
    let actorKey: string | null = null;
    if (parsed.data.actorKey) {
      const dir = await loadDirectory();
      if (!dir.some((e) => e.key === parsed.data.actorKey && e.kind === "agent")) throw new HttpError(400, "الوكيل مش بدليل الفريق");
      actorKey = parsed.data.actorKey;
    }
    if ((await db.apiToken.count({ where: { revokedAt: null, oauthClientId: null, scopes: { hasSome: kind === "mcp" ? ["mcp", ...MCP_SCOPES] : ["handoff"] } } })) >= 10) throw new HttpError(409, "عندك 10 توكنات شغّالة من هالنوع — وقّف واحد قبل ما تعمل جديد");
    const token = newToken(kind === "mcp" ? "mbm_" : "mbh_");
    const row = await db.apiToken.create({ data: { name, scopes, actorKey, tokenHash: hashToken(token), prefix: token.slice(0, 10), createdById: caller.id } });
    await audit({ type: "user", id: caller.id }, "mcp.token_create", { type: "api_token", id: row.id }, { after: { name: row.name, kind, scopes, actorKey } });
    return NextResponse.json({ id: row.id, token, url: kind === "mcp" ? `${appOrigin()}/mcp` : `${appOrigin()}/api/v1/handoffs` });
  } catch (e) {
    return errorResponse(e);
  }
}
