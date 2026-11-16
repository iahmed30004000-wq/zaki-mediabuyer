import { NextResponse } from "next/server";
import { can } from "@/core/roles";
import { isDemo } from "@/core/readiness";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { OrderInput, OrderRefused, createOrder, listOrders } from "@/server/orders";

export const dynamic = "force-dynamic";

/** GET /api/orders?active=1&domain=ads&job=<key>&product=<code>&archive=1 — the standing orders (the active ones by default plus the pending). */
export async function GET(req: Request) {
  try {
    await requireCapability("view");
    const q = new URL(req.url).searchParams;
    const domain = q.get("domain");
    const orders = await listOrders({ active: q.get("active") === "1", archive: q.get("archive") === "1", ...(domain === "ads" || domain === "ops" ? { domain } : {}), ...(q.get("product") ? { product: q.get("product")! } : {}) });
    return NextResponse.json({ orders });
  } catch (e) {
    return errorResponse(e);
  }
}

/** POST /api/orders — a new standing order from the site. A tightening one is in force at once; a loosening one is the owner's alone (anyone else's waits for him). */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("propose_change");
    if (isDemo(process.env) || caller.demo) return NextResponse.json({ ok: true, demo: true });
    const parsed = OrderInput.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "الأمر مش مفهوم: " + parsed.error.issues.slice(0, 2).map((i) => i.message).join(" · "));
    try {
      const order = await createOrder(parsed.data, { actor: { type: "user", id: caller.id }, source: "ui", isOwner: can(caller.role, "owner_only") });
      return NextResponse.json({ ok: true, order });
    } catch (e) {
      if (e instanceof OrderRefused) throw new HttpError(e.status, e.message);
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
