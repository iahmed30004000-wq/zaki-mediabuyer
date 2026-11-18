import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { hashInvite, INVITE_HOURS, newInviteCode } from "@/server/team";
import { ROLES } from "@/core/roles";

export const dynamic = "force-dynamic";

const Body = z.object({ email: z.string().trim().toLowerCase().email("إيميل مش صحيح"), name: z.string().trim().min(1).max(60), role: z.enum(ROLES) });

/** GET /api/team — the members, without anything secret. */
export async function GET() {
  try {
    await requireCapability("owner_only");
    const users = await db.user.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, email: true, name: true, role: true, active: true, lastLoginAt: true, inviteExpiresAt: true } });
    return NextResponse.json({ users });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * POST /api/team — invite a member. The answer carries the one-time code ONCE (the owner passes it to the member);
 * only its hash is kept. The member signs in with it and sets their own password.
 */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("owner_only");
    if (caller.demo) throw new HttpError(403, "بلا تسجيل دخول ما بتنعمل دعوات");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "في خانة ناقصة");
    if (await db.user.findUnique({ where: { email: parsed.data.email } })) throw new HttpError(409, "هالإيميل إله حساب — من القائمة بتقدر تعطيه رمز جديد");
    const code = newInviteCode();
    const user = await db.user.create({ data: { ...parsed.data, passwordHash: "", inviteHash: hashInvite(code), inviteExpiresAt: new Date(Date.now() + INVITE_HOURS * 3_600_000) } });
    await audit({ type: "user", id: caller.id }, "team.invite", { type: "user", id: user.id }, { after: { email: user.email, role: user.role } });
    return NextResponse.json({ id: user.id, code, hours: INVITE_HOURS });
  } catch (e) {
    return errorResponse(e);
  }
}
