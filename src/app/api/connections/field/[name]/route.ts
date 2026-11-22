import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { clearField, saveField } from "@/server/connections";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const Body = z.object({ value: z.string().max(25_000) });

/** PUT /api/connections/field/:name {value} — save one value (a secret is sealed). The answer says «saved» and the last 4 characters of a key, never the value. Owner only. */
export async function PUT(req: Request, { params: paramsP }: { params: Promise<{ name: string }> }) {
  const params = await paramsP;
  try {
    const caller = await requireCapability("owner_only");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "ما وصلت قيمة");
    const r = await saveField(params.name, parsed.data.value, caller.id);
    return NextResponse.json({ ok: true, last4: r.last4 }, { headers: NO_STORE });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/connections/field/:name — «امسح»: the site's value goes and the environment's (if any) comes back. Owner only. */
export async function DELETE(_req: Request, { params: paramsP }: { params: Promise<{ name: string }> }) {
  const params = await paramsP;
  try {
    const caller = await requireCapability("owner_only");
    await clearField(params.name, caller.id);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (e) {
    return errorResponse(e);
  }
}
