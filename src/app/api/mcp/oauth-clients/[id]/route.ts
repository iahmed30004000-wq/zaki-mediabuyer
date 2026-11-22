import { NextResponse } from "next/server";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { revokeClient } from "@/server/oauth";

export const dynamic = "force-dynamic";

/** DELETE /api/mcp/oauth-clients/:id — cuts the app off at once: its tokens are refused on the very next call, and it cannot refresh. The rows stay (who, when). Owner only. */
export async function DELETE(_req: Request, { params: paramsP }: { params: Promise<{ id: string }> }) {
  const params = await paramsP;
  try {
    const caller = await requireCapability("owner_only");
    if (caller.demo) throw new HttpError(403, "بلا تسجيل دخول ما بيتغيّر شي");
    if (!(await revokeClient(params.id, caller.id))) throw new HttpError(404, "التطبيق مش موجود");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
