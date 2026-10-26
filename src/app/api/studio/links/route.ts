import { NextResponse } from "next/server";
import { z } from "zod";
import { isVpId } from "@/core/studio-contract";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { audit } from "@/server/audit";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

const Body = z.object({
  crCode: z.string().trim().regex(/^CR\d{5}$/),
  vpId: z.string().trim().refine(isVpId),
  productCode: z.string().trim().regex(/^[A-Z]{3}\d{2}$/).optional(),
});

/** GET /api/studio/links — which video (CR#####) came from which studio script (VP-…). */
export async function GET() {
  try {
    await requireCapability("view");
    const links = await db.creativeAsset.findMany({ where: { sourceRef: { not: null } }, orderBy: { crCode: "desc" }, select: { crCode: true, sourceRef: true, productCode: true, source: true, createdAt: true } });
    return NextResponse.json({ links });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * POST /api/studio/links — ties a video to its script by hand, until the intake (T3.1) does it by itself.
 * A link is never silently moved: a CR or a VP already tied to something else is refused.
 */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("propose_change");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "الرقم لازم يكون متل CR00147، والسكربت متل VP-TRF01-0012-v2");
    const { crCode, vpId, productCode } = parsed.data;
    const [byCr, byVp] = await Promise.all([db.creativeAsset.findUnique({ where: { crCode } }), db.creativeAsset.findUnique({ where: { sourceRef: vpId } })]);
    if (byVp && byVp.crCode !== crCode) throw new HttpError(409, `السكربت ${vpId} مربوط أصلاً بـ ${byVp.crCode}`);
    if (byCr?.sourceRef && byCr.sourceRef !== vpId) throw new HttpError(409, `${crCode} مربوط أصلاً بـ ${byCr.sourceRef}`);
    const row = byCr
      ? await db.creativeAsset.update({ where: { crCode }, data: { sourceRef: vpId, productCode: byCr.productCode ?? productCode ?? null } })
      : await db.creativeAsset.create({ data: { crCode, sourceRef: vpId, productCode: productCode ?? null, source: "studio" } });
    if (!caller.demo) await audit({ type: "user", id: caller.id }, "studio.link", { type: "creative", id: row.crCode }, { before: byCr ? { sourceRef: byCr.sourceRef } : undefined, after: { sourceRef: vpId } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
