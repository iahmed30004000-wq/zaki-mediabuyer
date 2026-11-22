import { NextResponse } from "next/server";
import { errorResponse, requireCapability } from "@/server/auth";
import { testRow } from "@/server/connection-tests";

export const dynamic = "force-dynamic";

/** POST /api/connections/row/:key/test — «اختبر الربط»: one real read-only call; the answer is ✓ or the exact reason in Arabic. Owner only, audited. */
export async function POST(_req: Request, { params: paramsP }: { params: Promise<{ key: string }> }) {
  const params = await paramsP;
  try {
    const caller = await requireCapability("owner_only");
    return NextResponse.json(await testRow(params.key, caller.id), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
