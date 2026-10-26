import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";

const Body = z.object({
  metaId: z.string().regex(/^[A-Za-z0-9_-]{3,40}$/, "رقم الصفحة من ميتا"),
  name: z.string().trim().min(1).max(80),
  code: z.string().regex(/^[A-Z]{2}$/, "رمز الصفحة حرفين إنجليزي كبار (SP)"),
});

/**
 * POST /api/pages — a Facebook page and its two-letter code, the one in every ad set name (spec 5.1 / 5.4). Pages
 * come from Meta's sync; here they get their code (or are added before the link). A code belongs to one page only.
 */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("connect_meta");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "في خانة ناقصة");
    if (process.env.MOCK_MODE === "1") return NextResponse.json({ ok: true, demo: true });
    const taken = await db.page.findFirst({ where: { code: parsed.data.code, metaId: { not: parsed.data.metaId } } });
    if (taken) throw new HttpError(409, `الرمز ${parsed.data.code} مستعمل لصفحة «${taken.name}»`);
    const before = await db.page.findUnique({ where: { metaId: parsed.data.metaId } });
    await db.page.upsert({ where: { metaId: parsed.data.metaId }, create: parsed.data, update: { name: parsed.data.name, code: parsed.data.code } });
    await audit({ type: "user", id: caller.id }, "page.code", { type: "page", id: parsed.data.metaId }, { before: before ? { name: before.name, code: before.code } : null, after: { name: parsed.data.name, code: parsed.data.code } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
