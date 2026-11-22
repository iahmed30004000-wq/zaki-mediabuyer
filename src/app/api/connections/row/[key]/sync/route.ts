import { NextResponse } from "next/server";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { pullOmsNow } from "@/server/oms-pull";

export const dynamic = "force-dynamic";

/** POST /api/connections/row/oms/sync — «اسحب هلق»: one pull of the OMS now (orders, then the truth). Owner only, audited. Only the OMS row has it. */
export async function POST(_req: Request, { params }: { params: { key: string } }) {
  try {
    const caller = await requireCapability("owner_only");
    if (params.key !== "oms") throw new HttpError(404, "السحب الفوري بس للـ OMS");
    return NextResponse.json({ ok: true, ...(await pullOmsNow(caller.id)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
