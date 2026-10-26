import { NextResponse } from "next/server";
import { z } from "zod";
import { SCOPES } from "@/core/studio-contract";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { hashToken, newToken } from "@/server/api-token";
import { audit } from "@/server/audit";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

const Body = z.object({ name: z.string().trim().min(1).max(60), scope: z.enum(SCOPES) });

/** GET /api/studio/tokens — the studio's tokens, without any secret part. */
export async function GET() {
  try {
    await requireCapability("owner_only");
    const tokens = await db.apiToken.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, name: true, scopes: true, prefix: true, lastUsedAt: true, revokedAt: true, createdAt: true } });
    return NextResponse.json({ tokens });
  } catch (e) {
    return errorResponse(e);
  }
}

/** POST /api/studio/tokens — a new token for the studio. The whole token is in this answer ONLY; we keep its hash. */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("owner_only");
    if (caller.demo) throw new HttpError(403, "بلا تسجيل دخول ما بينعمل توكن");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "اكتب اسم للتوكن واختار صلاحيته");
    const token = newToken();
    const row = await db.apiToken.create({ data: { name: parsed.data.name, scopes: [parsed.data.scope], tokenHash: hashToken(token), prefix: token.slice(0, 10), createdById: caller.id } });
    await audit({ type: "user", id: caller.id }, "studio.token_create", { type: "api_token", id: row.id }, { after: { name: row.name, scopes: row.scopes } });
    return NextResponse.json({ id: row.id, token });
  } catch (e) {
    return errorResponse(e);
  }
}
