import { NextResponse } from "next/server";
import { parseWindow } from "@/core/studio-contract";
import { ContractError, contractResponse, requireToken } from "@/server/api-token";
import { studioPerformance } from "@/jobs/studio-performance";

export const dynamic = "force-dynamic";

/** GET /api/vidpattern/ad-performance?since&until — what the content studio's crm.py pulls (token vp:read). */
export async function GET(req: Request) {
  try {
    await requireToken(req, "vp:read");
    const q = new URL(req.url).searchParams;
    const w = parseWindow(q.get("since"), q.get("until"));
    if (typeof w === "string") throw new ContractError(400, "invalid_meta", w);
    return NextResponse.json({ rows: await studioPerformance(w.from, w.to) });
  } catch (e) {
    return contractResponse(e);
  }
}
