import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { contractResponse, requireToken, ContractError } from "@/server/api-token";
import { statusOf } from "@/server/studio-launch";

export const dynamic = "force-dynamic";

/** GET /api/v1/vp/launch-requests/{id} — the derived status (contract §4.2 #3). */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireToken(req, "vp:read");
    const r = await db.launchRequest.findUnique({ where: { id: params.id } });
    if (!r) throw new ContractError(404, "not_found", "الطلب مش موجود");
    return NextResponse.json(await statusOf(r));
  } catch (e) {
    return contractResponse(e);
  }
}
