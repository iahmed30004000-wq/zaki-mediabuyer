import { NextResponse } from "next/server";
import { errorResponse, requireCapability } from "@/server/auth";
import { listConnected } from "@/server/oauth";

export const dynamic = "force-dynamic";

/** GET /api/mcp/oauth-clients — the apps the owner let in through the connector (never a token, never a hash). Owner only. */
export async function GET() {
  try {
    await requireCapability("owner_only");
    return NextResponse.json({ clients: await listConnected() });
  } catch (e) {
    return errorResponse(e);
  }
}
