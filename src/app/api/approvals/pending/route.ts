import { NextResponse } from "next/server";
import { approvalsFor } from "@/core/inbox";
import { errorResponse, requireCapability } from "@/server/auth";
import { listApprovals } from "@/server/approvals";
import { currentMode } from "@/server/mode";
import { isDemo } from "@/core/readiness";

export const dynamic = "force-dynamic";

/**
 * GET /api/approvals/pending — what waits for the owner now, and whether he is awake. The open app asks every minute
 * (never faster: the phone's battery) and rings an urgent one on screen; the native app is pushed instead (FCM). Only the requests of the areas the caller's role looks at
 * (the same filter as its inbox) are listed and rung: a request of another area never leaves the server for this caller.
 */
export async function GET() {
  try {
    const me = await requireCapability("inbox.view");
    if (isDemo(process.env)) return NextResponse.json({ approvals: [], mode: "awake", demo: true });
    const [all, mode] = await Promise.all([listApprovals({ status: ["pending"] }), currentMode()]);
    return NextResponse.json({ approvals: approvalsFor(all, me.role), mode: mode.mode });
  } catch (e) {
    return errorResponse(e);
  }
}
