import { NextResponse } from "next/server";
import { errorResponse, requireCapability } from "@/server/auth";
import { connectionsView } from "@/server/connections";

export const dynamic = "force-dynamic";

/** GET /api/connections — the rows of «الإعدادات ← الربط» and what each holds: only «محفوظ ✓ · آخر 4», never a value. Owner only. */
export async function GET() {
  try {
    await requireCapability("owner_only");
    return NextResponse.json(await connectionsView(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
