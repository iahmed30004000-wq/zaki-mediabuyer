import { NextResponse } from "next/server";
import { z } from "zod";
import { isDemo } from "@/core/readiness";
import { can } from "@/core/roles";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { OrderRefused, decideOrder, endOrder } from "@/server/orders";

export const dynamic = "force-dynamic";

const Body = z.object({ action: z.enum(["approve", "reject", "end"]) }).strict();

/** POST /api/orders/:id — `approve` / `reject` (a pending order, or Claude's request to end one) and `end` («ارجع»). The owner's, on the site. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const caller = await requireCapability("owner_only");
    if (isDemo(process.env) || caller.demo) return NextResponse.json({ ok: true, demo: true });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "طلب مش مفهوم");
    const actor = { type: "user" as const, id: caller.id };
    try {
      if (parsed.data.action === "end") return NextResponse.json({ ok: true, ...(await endOrder(params.id, { actor, source: "ui", isOwner: can(caller.role, "owner_only") })) });
      return NextResponse.json({ ok: true, order: await decideOrder(params.id, parsed.data.action, actor) });
    } catch (e) {
      if (e instanceof OrderRefused) throw new HttpError(e.status, e.message);
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
