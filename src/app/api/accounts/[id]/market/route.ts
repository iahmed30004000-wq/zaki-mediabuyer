import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { MARKETS } from "@/core/naming";
import { isDemo } from "@/core/readiness";

const Body = z.object({ market: z.enum(MARKETS).nullable() });

/**
 * POST /api/accounts/:metaId/market — the market an ad account is for (v6 · P11). It places a campaign whose name says no market, and the launch offers the
 * account only to products of that market. Meta's sync never writes it. Owner only, audited.
 */
export async function POST(req: Request, { params: paramsP }: { params: Promise<{ id: string }> }) {
  const params = await paramsP;
  try {
    const caller = await requireCapability("owner_only");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "السوق مش معروف");
    if (isDemo(process.env)) return NextResponse.json({ ok: true, demo: true });
    const a = await db.adAccount.findUnique({ where: { metaId: params.id } });
    if (!a) throw new HttpError(404, "الحساب مش موجود");
    await db.adAccount.update({ where: { id: a.id }, data: { market: parsed.data.market } });
    await audit({ type: "user", id: caller.id }, "account.market", { type: "account", id: a.metaId }, { before: { market: a.market }, after: parsed.data });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
