import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { ContractError, contractResponse, requireToken } from "@/server/api-token";

export const dynamic = "force-dynamic";

/**
 * GET /api/vidpattern/queue?status=pending — the studio's machine pulls what the media buyer asked for (contract
 * §4.2 #6, token vp:read): oldest first, at most 50. A claim whose lease ran out counts as pending again.
 */
export async function GET(req: Request) {
  try {
    await requireToken(req, "vp:read");
    const status = new URL(req.url).searchParams.get("status") ?? "pending";
    if (!["pending", "claimed", "done"].includes(status)) throw new ContractError(400, "invalid_meta", "الحالة لازم تكون pending أو claimed أو done");
    const now = new Date();
    const where = status === "pending" ? { OR: [{ status: "pending" }, { status: "claimed", leaseUntil: { lt: now } }] } : { status };
    const rows = await db.creativeRequest.findMany({ where, orderBy: { createdAt: "asc" }, take: 50 });
    return NextResponse.json({
      items: rows.map((r) => ({ id: r.id, kind: r.kind, product_code: r.productCode, vp_id: r.vpId, cr_code: r.crCode, count: r.count, brief: r.brief, status: r.status === "claimed" && r.leaseUntil && r.leaseUntil < now ? "pending" : r.status, created_at: r.createdAt.toISOString() })),
    });
  } catch (e) {
    return contractResponse(e);
  }
}
