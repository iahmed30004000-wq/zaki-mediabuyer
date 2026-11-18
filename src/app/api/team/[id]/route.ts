import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { hashInvite, INVITE_HOURS, newInviteCode, teamChange } from "@/server/team";
import { ROLES } from "@/core/roles";

const Body = z.object({ role: z.enum(ROLES).optional(), active: z.boolean().optional(), reinvite: z.boolean().optional() });

/**
 * PATCH /api/team/:id — change a member's role, switch them off (every session of theirs ends at once), or give them
 * a new one-time code (a forgotten password: the old one stops working). The last owner can never be removed.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const caller = await requireCapability("owner_only");
    if (caller.demo) throw new HttpError(403, "بلا تسجيل دخول ما بيتغيّر الفريق");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "طلب غير مفهوم");
    const user = await db.user.findUnique({ where: { id: params.id } });
    if (!user) throw new HttpError(404, "العضو مش موجود");
    const owners = await db.user.count({ where: { role: "OWNER", active: true } });
    const check = teamChange({ actorId: caller.id, targetId: user.id, targetRole: user.role, owners, to: { role: parsed.data.role, active: parsed.data.active } });
    if (!check.ok) throw new HttpError(409, check.why);

    let code: string | null = null;
    const data: Parameters<typeof db.user.update>[0]["data"] = {};
    if (parsed.data.role) data.role = parsed.data.role;
    if (parsed.data.active !== undefined) data.active = parsed.data.active;
    if (parsed.data.reinvite) {
      if (caller.id === user.id) throw new HttpError(409, "رمز لحالك؟ اطلع وارجع ادخل بكلمة سرك");
      code = newInviteCode();
      Object.assign(data, { passwordHash: "", inviteHash: hashInvite(code), inviteExpiresAt: new Date(Date.now() + INVITE_HOURS * 3_600_000) });
    }
    // any change to who they are ends their open sessions
    data.sessionVer = { increment: 1 };
    await db.user.update({ where: { id: user.id }, data });
    await audit({ type: "user", id: caller.id }, parsed.data.reinvite ? "team.reinvite" : "team.update", { type: "user", id: user.id }, { before: { role: user.role, active: user.active }, after: { role: parsed.data.role ?? user.role, active: parsed.data.active ?? user.active } });
    return NextResponse.json({ ok: true, ...(code ? { code, hours: INVITE_HOURS } : {}) });
  } catch (e) {
    return errorResponse(e);
  }
}
