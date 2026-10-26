import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { levelChange, type AutonomyLevel } from "@/core/autonomy";
import { accountRestricted } from "@/jobs/account-safety";

const Body = z.object({ level: z.number().int() });

/**
 * POST /api/accounts/:metaId/level — the owner chooses how much the system does on its own for one ad account
 * (spec 10.1, T5.2). Up to 2 only after two weeks of decisions on that account; 3 is off; down is always allowed.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "طلب غير مفهوم");
    const caller = await requireCapability("owner_only");
    if (process.env.MOCK_MODE === "1") return NextResponse.json({ ok: true, demo: true });
    const account = await db.adAccount.findUnique({ where: { metaId: params.id } });
    if (!account) throw new HttpError(404, "الحساب مش موجود");
    // two weeks of decisions = the first change the system proposed on this account is at least 14 days old
    const first = await db.changeSet.findFirst({ where: { accountMetaId: account.metaId }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
    const daysOfDecisions = first ? Math.floor((Date.now() - first.createdAt.getTime()) / 86_400_000) : 0;
    const check = levelChange(account.autonomyLevel as AutonomyLevel, parsed.data.level, { daysOfDecisions, restricted: await accountRestricted(account.metaId) });
    if (!check.ok) throw new HttpError(409, check.why);
    await db.adAccount.update({ where: { id: account.id }, data: { autonomyLevel: parsed.data.level } });
    await audit({ type: "user", id: caller.id }, "account.level", { type: "account", id: account.metaId }, { before: { level: account.autonomyLevel }, after: { level: parsed.data.level } });
    return NextResponse.json({ ok: true, level: parsed.data.level });
  } catch (e) {
    return errorResponse(e);
  }
}
