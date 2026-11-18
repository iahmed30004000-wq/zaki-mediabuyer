import { NextResponse } from "next/server";
import { errorResponse, requireCapability } from "@/server/auth";
import { listApprovals } from "@/server/approvals";
import { currentMode } from "@/server/mode";
import { isDemo } from "@/core/readiness";

export const dynamic = "force-dynamic";

/**
 * GET /api/approvals/pending — what waits for the owner now, and whether he is awake. The open app asks every minute
 * (never faster: the phone's battery) and rings an urgent one on screen; the native app is pushed instead (FCM).
 */
export async function GET() {
  try {
    await requireCapability("inbox.view");
    if (isDemo(process.env)) return NextResponse.json({ approvals: [], mode: "awake", demo: true });
    const [approvals, mode] = await Promise.all([listApprovals({ status: ["pending"] }), currentMode()]);
    return NextResponse.json({ approvals, mode: mode.mode });
  } catch (e) {
    return errorResponse(e);
  }
}
