import { NextResponse } from "next/server";
import { errorResponse, requireCapability } from "@/server/auth";
import { beginLink, unlink } from "@/server/oauth-client";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

/** POST /api/connections/row/:key/link — «اربط ← اسمح»: where to send the owner (the other system's consent screen). Owner only. */
export async function POST(_req: Request, { params }: { params: { key: string } }) {
  try {
    const caller = await requireCapability("owner_only");
    return NextResponse.json(await beginLink(params.key, caller.id), { headers: NO_STORE });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/connections/row/:key/link — «افصل»: forget the token. Owner only. */
export async function DELETE(_req: Request, { params }: { params: { key: string } }) {
  try {
    const caller = await requireCapability("owner_only");
    await unlink(params.key, caller.id);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (e) {
    return errorResponse(e);
  }
}
