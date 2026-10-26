import { NextResponse } from "next/server";
import { z } from "zod";
import { propose } from "@/server/changes";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { db } from "@/server/db";

const Body = z.object({ objectType: z.enum(["campaign", "adset", "ad"]), objectId: z.string().min(3) });

/** POST /api/objects/pause — «اوقف» on an item card: a safety change, executed at once, logged, undoable. */
export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "طلب غير مفهوم");
    const caller = await requireCapability("pause_or_reduce");
    // demo numbers are not real campaigns: say so, change nothing
    if (process.env.MOCK_MODE === "1") return NextResponse.json({ ok: true, demo: true });
    const { objectType, objectId } = parsed.data;
    const row =
      objectType === "ad"
        ? await db.ad.findUnique({ where: { metaId: objectId }, include: { adSet: { include: { campaign: { include: { account: true } } } } } })
        : objectType === "adset"
          ? await db.adSet.findUnique({ where: { metaId: objectId }, include: { campaign: { include: { account: true } } } })
          : await db.campaign.findUnique({ where: { metaId: objectId }, include: { account: true } });
    if (!row) throw new HttpError(404, "العنصر مش موجود");
    const account = "adSet" in row ? row.adSet.campaign.account : "campaign" in row ? row.campaign.account : row.account;
    const cs = await propose(
      { source: "user", sourceRef: caller.id, reasonCode: "S11", sentence: `وقف يدوي: ${row.name}`, kind: "safety_pause", accountMetaId: account.metaId, items: [{ op: "pause", objectType, objectId, before: { status: row.status }, after: { status: "PAUSED" } }] },
      { type: "user", id: caller.id },
    );
    return NextResponse.json({ ok: true, id: cs.id, state: cs.state });
  } catch (e) {
    return errorResponse(e);
  }
}
