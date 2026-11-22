import { NextResponse } from "next/server";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { listVersions } from "@/server/workflows";

export const dynamic = "force-dynamic";

/** GET /api/workflow/:key/versions — every saved version of the drawing, newest first, each with its graph (the editor opens one as a draft). */
export async function GET(_req: Request, { params: paramsP }: { params: Promise<{ key: string }> }) {
  const params = await paramsP;
  try {
    await requireCapability("work.view");
    const versions = await listVersions(params.key);
    if (!versions) throw new HttpError(404, "المهمة مش موجود");
    return NextResponse.json({ versions });
  } catch (e) {
    return errorResponse(e);
  }
}
