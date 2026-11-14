import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { hashToken, newToken } from "@/server/api-token";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { appOrigin } from "@/server/env";

export const dynamic = "force-dynamic";

const Body = z.object({ name: z.string().trim().min(1).max(60) });

/** GET /api/mcp/tokens — Claude's tokens (never the secret part) and the address to give Claude. Owner only. */
export async function GET() {
  try {
    await requireCapability("owner_only");
    const tokens = await db.apiToken.findMany({ where: { scopes: { has: "mcp" } }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, prefix: true, lastUsedAt: true, revokedAt: true, createdAt: true } });
    return NextResponse.json({ tokens, url: `${appOrigin()}/mcp` });
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
    if ((await db.apiToken.count({ where: { scopes: { has: "mcp" }, revokedAt: null } })) >= 10) throw new HttpError(409, "عندك 10 توكنات شغّالة — وقّف واحد قبل ما تعمل جديد");
    const token = newToken("mbm_");
    const row = await db.apiToken.create({ data: { name: parsed.data.name, scopes: ["mcp"], tokenHash: hashToken(token), prefix: token.slice(0, 10), createdById: caller.id } });
    await audit({ type: "user", id: caller.id }, "mcp.token_create", { type: "api_token", id: row.id }, { after: { name: row.name } });
    return NextResponse.json({ id: row.id, token, url: `${appOrigin()}/mcp` });
  } catch (e) {
    return errorResponse(e);
  }
}
