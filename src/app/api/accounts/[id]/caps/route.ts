import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";

const Body = z
  .object({ dailyCap: z.number().finite().min(0).max(100_000), monthlyCap: z.number().finite().min(0).max(3_000_000) })
  .refine((b) => b.monthlyCap === 0 || b.monthlyCap >= b.dailyCap, "السقف الشهري أقل من اليومي");

/**
 * POST /api/accounts/:metaId/caps — the account's daily and monthly caps (spec 5.5 / 10.1). No raise passes above the
 * daily cap; at the cap the safety rule pauses the unprotected spend for the rest of the day. Owner only, audited.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const caller = await requireCapability("owner_only");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "الأرقام مش صحيحة");
    if (process.env.MOCK_MODE === "1") return NextResponse.json({ ok: true, demo: true });
    const a = await db.adAccount.findUnique({ where: { metaId: params.id } });
    if (!a) throw new HttpError(404, "الحساب مش موجود");
    await db.adAccount.update({ where: { id: a.id }, data: { dailyCap: parsed.data.dailyCap, monthlyCap: parsed.data.monthlyCap } });
    await audit({ type: "user", id: caller.id }, "account.caps", { type: "account", id: a.metaId }, { before: { dailyCap: a.dailyCap ? Number(a.dailyCap) : null, monthlyCap: a.monthlyCap ? Number(a.monthlyCap) : null }, after: parsed.data });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
