import { NextResponse } from "next/server";
import { z } from "zod";
import { TEAMS } from "@/core/directory";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { audit } from "@/server/audit";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    team: z.enum(TEAMS.map((t) => t.key) as [string, ...string[]]).nullable().optional(),
    /** the chat id Telegram gives; null clears it. Digits only, so no phone number or name can sit here by mistake */
    telegram: z.string().trim().regex(/^-?\d{5,20}$/, "رقم المحادثة أرقام بس").nullable().optional(),
    /** the account this person signs in with (null unlinks) */
    userId: z.string().trim().min(1).max(40).nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();

/** PATCH /api/team/actors/:key — rename, move to a team, set the Telegram chat, link an account, or archive (nothing is ever deleted). The owner's. */
export async function PATCH(req: Request, { params }: { params: { key: string } }) {
  try {
    const caller = await requireCapability("owner_only");
    if (caller.demo) throw new HttpError(403, "بلا تسجيل دخول ما بيتغيّر شي");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "طلب غير مفهوم");
    const row = await db.actor.findUnique({ where: { key: params.key } });
    if (!row) throw new HttpError(404, "مش موجود بالدليل");
    const d = parsed.data;
    if (d.name && /\S+@\S+|\d{6,}/.test(d.name)) throw new HttpError(400, "الاسم بس — بلا رقم أو إيميل");
    if (d.userId) {
      if (row.kind === "agent") throw new HttpError(400, "الوكيل ما إله حساب دخول");
      if (!(await db.user.findUnique({ where: { id: d.userId } }))) throw new HttpError(404, "الحساب مش موجود");
      const taken = await db.actor.findUnique({ where: { userId: d.userId } });
      if (taken && taken.key !== row.key) throw new HttpError(409, "هالحساب مربوط بحدا تاني");
    }
    await db.actor.update({ where: { key: row.key }, data: { ...(d.name !== undefined ? { name: d.name } : {}), ...(d.team !== undefined ? { team: d.team } : {}), ...(d.telegram !== undefined ? { telegram: d.telegram } : {}), ...(d.userId !== undefined ? { userId: d.userId } : {}), ...(d.active !== undefined ? { active: d.active } : {}) } });
    // the chat number is not written to the log: only that it changed
    await audit({ type: "user", id: caller.id }, "team.actor_update", { type: "actor", id: row.key }, { after: { name: d.name, team: d.team, telegram: d.telegram === undefined ? undefined : d.telegram === null ? "cleared" : "set", linked: d.userId === undefined ? undefined : !!d.userId, active: d.active } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
