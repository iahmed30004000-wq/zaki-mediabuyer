import { NextResponse } from "next/server";
import { z } from "zod";
import { ENTITIES } from "@/core/customize";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { setValues } from "@/server/customize";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    entity: z.enum(ENTITIES),
    entityId: z.string().trim().min(1).max(120),
    values: z.record(z.unknown()).refine((o) => Object.keys(o).length >= 1 && Object.keys(o).length <= 30, "من 1 لـ 30 حقل"),
  })
  .strict();

/**
 * PUT /api/ui/values — what a person typed into the fields of one card `{ entity, entityId, values: { <fieldId>: value | null } }`.
 * The same capability as editing the card; each value is checked against its field (type, options, no customer data); null clears it.
 */
export async function PUT(req: Request) {
  try {
    const caller = await requireCapability("propose_change");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "طلب غير مفهوم");
    if (caller.demo) return NextResponse.json({ ok: true, demo: true });
    return NextResponse.json({ ok: true, values: await setValues(parsed.data.entity, parsed.data.entityId, parsed.data.values, caller) });
  } catch (e) {
    return errorResponse(e);
  }
}
