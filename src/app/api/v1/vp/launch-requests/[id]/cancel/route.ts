import { NextResponse } from "next/server";
import { contractResponse, requireToken } from "@/server/api-token";
import { cancelRequest } from "@/server/studio-launch";

export const dynamic = "force-dynamic";

/** POST /api/v1/vp/launch-requests/{id}/cancel — only before the owner approves (contract §4.2 #4). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireToken(req, "vp:launch");
    return NextResponse.json(await cancelRequest(params.id));
  } catch (e) {
    return contractResponse(e);
  }
}
