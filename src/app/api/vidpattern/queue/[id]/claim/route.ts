import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { ContractError, contractResponse, requireToken } from "@/server/api-token";

const LEASE_HOURS = 2;

/** POST /api/vidpattern/queue/:id/claim — the studio takes one request for 2 hours (token vp:launch). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireToken(req, "vp:launch");
    const now = new Date();
    // one atomic update: only a pending request, or one whose lease ran out, can be taken
    const taken = await db.creativeRequest.updateMany({
      where: { id: params.id, OR: [{ status: "pending" }, { status: "claimed", leaseUntil: { lt: now } }] },
      data: { status: "claimed", claimedAt: now, leaseUntil: new Date(now.getTime() + LEASE_HOURS * 3_600_000) },
    });
    if (!taken.count) {
      const exists = await db.creativeRequest.findUnique({ where: { id: params.id }, select: { status: true } });
      throw exists ? new ContractError(409, "already_claimed", "الطلب مأخود أو خلص") : new ContractError(404, "not_found", "الطلب مش موجود");
    }
    const r = await db.creativeRequest.findUniqueOrThrow({ where: { id: params.id } });
    return NextResponse.json({ id: r.id, status: r.status, lease_until: r.leaseUntil?.toISOString() });
  } catch (e) {
    return contractResponse(e);
  }
}
