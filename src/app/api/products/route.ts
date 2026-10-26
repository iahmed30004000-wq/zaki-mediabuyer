import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { MARKETS } from "@/core/naming";

const usd = z.number().finite().min(0).max(10_000);
const Body = z.object({
  productCode: z.string().regex(/^[A-Z]{3}\d{2}$/, "رمز المنتج 3 حروف إنجليزية كبيرة ورقمين (TRF01)"),
  name: z.string().trim().min(1).max(80),
  market: z.enum(MARKETS),
  price: usd.refine((v) => v > 0, "السعر لازم يكون أكبر من صفر"),
  unitCost: usd,
  deliveryFee: usd,
  returnFee: usd,
  codFeePct: z.number().min(0).max(0.5),
  confirmCost: usd,
  stockDays: z.number().int().min(0).max(3650).nullable(),
});

/**
 * POST /api/products — a product's numbers for the calculator (spec 6.3). Owner only, audited before and after. Once
 * the OMS is linked, its numbers (cost, fees, stock) win at every sync; until then these are the ones the truth uses.
 */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("owner_only");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "في رقم ناقص أو غلط");
    if (process.env.MOCK_MODE === "1") return NextResponse.json({ ok: true, demo: true });
    const { productCode, ...data } = parsed.data;
    const before = await db.productEconomics.findUnique({ where: { productCode } });
    await db.productEconomics.upsert({ where: { productCode }, create: { productCode, ...data }, update: data });
    const snap = before && { price: Number(before.price), unitCost: Number(before.unitCost), deliveryFee: Number(before.deliveryFee), returnFee: Number(before.returnFee), codFeePct: Number(before.codFeePct), confirmCost: Number(before.confirmCost), stockDays: before.stockDays };
    await audit({ type: "user", id: caller.id }, before ? "product.update" : "product.create", { type: "product", id: productCode }, { before: snap, after: data });
    return NextResponse.json({ ok: true, created: !before });
  } catch (e) {
    return errorResponse(e);
  }
}
