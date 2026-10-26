import { NextResponse } from "next/server";
import { z } from "zod";
import { approve, reject, rollback } from "@/server/changes";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { db } from "@/server/db";

const Body = z.object({ action: z.enum(["approve", "reject", "rollback"]) });

/** POST /api/changes/:id {action} — the three buttons of a change card. Approvals happen here, never on Telegram. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "طلب غير مفهوم");
    const caller = await requireCapability("view");
    if (!(await db.changeSet.findUnique({ where: { id: params.id } }))) throw new HttpError(404, "التغيير مش موجود");
    const done = parsed.data.action === "approve" ? await approve(params.id, caller) : parsed.data.action === "reject" ? await reject(params.id, caller) : await rollback(params.id, caller);
    return NextResponse.json({ ok: true, state: done.state, id: done.id });
  } catch (e) {
    return errorResponse(e);
  }
}
