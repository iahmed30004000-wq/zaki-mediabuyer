import { NextResponse } from "next/server";
import { inboxCount } from "@/core/inbox";
import { errorResponse, requireCapability } from "@/server/auth";
import { loadInbox } from "@/server/inbox";

export const dynamic = "force-dynamic";

/** GET /api/inbox — the open decisions (sorted) and their count: what the red number and a refresh read. The actions stay on /api/changes, /api/approvals and /api/handoffs. */
export async function GET(req: Request) {
  try {
    const caller = await requireCapability("inbox.view");
    const domain = new URL(req.url).searchParams.get("domain");
    const items = await loadInbox(caller, domain === "ads" || domain === "ops" || domain === "work" ? { domain } : {});
    return NextResponse.json({ count: inboxCount(items), items });
  } catch (e) {
    return errorResponse(e);
  }
}
