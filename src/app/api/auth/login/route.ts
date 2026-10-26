import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { errorResponse, HttpError, startSession, verifyPassword } from "@/server/auth";

const Body = z.object({ email: z.string().email(), password: z.string().min(8), name: z.string().min(1).optional() });

/** Ten tries per address per 15 minutes (memory; one process). */
const tries = new Map<string, { n: number; at: number }>();
function limited(key: string): boolean {
  const now = Date.now();
  const t = tries.get(key);
  if (!t || now - t.at > 15 * 60_000) {
    tries.set(key, { n: 1, at: now });
    return false;
  }
  t.n++;
  return t.n > 10;
}

/**
 * POST /api/auth/login — sign in. On a brand-new system (no account at all) the first sign-in CREATES the owner
 * with the address and password typed: the owner makes his own account on his own machine, nobody else can.
 */
export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "الإيميل أو كلمة السر مش صحيحين (كلمة السر 8 أحرف على الأقل)");
    const email = parsed.data.email.trim().toLowerCase();
    if (limited(email)) throw new HttpError(429, "محاولات كتير. استنى ربع ساعة.");

    if ((await db.user.count()) === 0) {
      const owner = await db.user.create({ data: { email, name: parsed.data.name ?? "المالك", role: "OWNER", passwordHash: await bcrypt.hash(parsed.data.password, 12) } });
      await audit({ type: "user", id: owner.id }, "user.first_owner", { type: "user", id: owner.id });
      await startSession(owner);
      return NextResponse.json({ ok: true, firstOwner: true });
    }

    const user = await verifyPassword(email, parsed.data.password);
    if (!user) throw new HttpError(401, "الإيميل أو كلمة السر غلط");
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
