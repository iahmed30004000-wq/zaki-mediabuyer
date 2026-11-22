import { NextResponse } from "next/server";
import { isDemo } from "@/core/readiness";
import { errorResponse, requireSignedIn } from "@/server/auth";
import { loadBell } from "@/server/notifications";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications — the bell (docs/rebuild-v6/02-screens.md §7): the person's last 30 notices, newest first, and how many are not read yet. A notice is the person's own
 * (the owner's for the owner and the manager, else the one of the person's directory entry); nobody reads another's. Nothing is sent from here.
 */
export async function GET() {
  try {
    const caller = await requireSignedIn();
    if (isDemo(process.env) || caller.demo) return NextResponse.json({ unread: 0, items: [] });
    return NextResponse.json(await loadBell(caller));
  } catch (e) {
    return errorResponse(e);
  }
}
