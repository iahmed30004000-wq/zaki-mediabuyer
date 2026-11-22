import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { errorResponse, HttpError, startSession, verifyPassword } from "@/server/auth";
import { hashInvite } from "@/server/team";
import { loginLimiter } from "@/core/auth-guards";

const Body = z.object({ email: z.string().email(), password: z.string().min(8), name: z.string().min(1).optional(), invite: z.string().trim().min(10).max(40).optional() });

/** Failed attempts only, per address + e-mail and per address (src/core/auth-guards.ts); in memory, one process. */
const limiter = loginLimiter();
const addressOf = (req: Request) => (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim() || "unknown";

/**
 * POST /api/auth/login — sign in. On a brand-new system (no account at all) the first sign-in CREATES the owner
 * with the address and password typed: the owner makes his own account on his own machine, nobody else can.
 * A member the owner invited signs in once with the one-time code and chooses their own password.
 */
export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "الإيميل أو كلمة السر مش صحيحين (كلمة السر 8 أحرف على الأقل)");
    const email = parsed.data.email.trim().toLowerCase();
    const ip = addressOf(req);
    if (limiter.blocked(ip, email)) throw new HttpError(429, "محاولات كتير. استنى ربع ساعة.");

    if ((await db.user.count()) === 0) {
      // On a public server the first sign-in must not be a race: when OWNER_EMAIL is set, only that address can
      // become the owner.
      const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
      // in production the owner address must be set (OWNER_EMAIL)
      if (!ownerEmail && process.env.NODE_ENV === "production") throw new HttpError(403, "حساب المالك بيتعمل بعد ما يتحدد إيميل المالك بإعدادات السيرفر (OWNER_EMAIL)");
      if (ownerEmail && email !== ownerEmail) throw new HttpError(403, "حساب المالك بيتعمل بس بإيميل المالك المحدّد بإعدادات السيرفر");
      const owner = await db.user.create({ data: { email, name: parsed.data.name ?? "المالك", role: "OWNER", passwordHash: await bcrypt.hash(parsed.data.password, 12) } });
      await audit({ type: "user", id: owner.id }, "user.first_owner", { type: "user", id: owner.id });
      await startSession(owner);
      return NextResponse.json({ ok: true, firstOwner: true });
    }

    // a member the owner invited: the one-time code once, then the password they choose here
    if (parsed.data.invite) {
      const invited = await db.user.findUnique({ where: { email } });
      const fresh = invited?.inviteHash && invited.inviteExpiresAt && invited.inviteExpiresAt > new Date() && invited.active;
      if (!invited || !fresh || invited.inviteHash !== hashInvite(parsed.data.invite)) {
        limiter.fail(ip, email);
        throw new HttpError(401, "رمز الدعوة غلط أو انتهى — اطلب رمز جديد من المالك");
      }
      const member = await db.user.update({ where: { id: invited.id }, data: { passwordHash: await bcrypt.hash(parsed.data.password, 12), inviteHash: null, inviteExpiresAt: null, lastLoginAt: new Date() } });
      await audit({ type: "user", id: member.id }, "team.accept_invite");
      limiter.success(ip, email);
      await startSession(member);
      return NextResponse.json({ ok: true, welcome: true });
    }

    const user = await verifyPassword(email, parsed.data.password);
    if (!user) {
      limiter.fail(ip, email);
      throw new HttpError(401, "الإيميل أو كلمة السر غلط");
    }
    limiter.success(ip, email);
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await audit({ type: "user", id: user.id }, "user.login");
    await startSession(user);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

/** GET — does the system have any account yet? (the login page asks, to say «اعمل حساب المالك») */
export async function GET() {
  return NextResponse.json({ hasUsers: (await db.user.count()) > 0 });
}
