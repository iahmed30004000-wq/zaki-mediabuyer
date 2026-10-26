import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { writeVariants } from "@/agents/writer";
import { AgentUnavailable } from "@/gateway";
import { PRODUCTS } from "@/lib/mock/data";

const Body = z.object({ productCode: z.string().regex(/^[A-Z]{3}\d{2}$/), angle: z.string().max(60).optional() });

/** POST /api/agents/writer — M07: ad copy variants for the launch wizard, each already through the policy dictionary. */
export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "اختار منتج");
    await requireCapability("propose_change");
    if (process.env.MOCK_MODE === "1") {
      const p = PRODUCTS.find((x) => x.code === parsed.data.productCode);
      return NextResponse.json({
        demo: true,
        dropped: 1,
        variants: [
          { hook: "سرّ من زمان بالبيت السوري", body: `${p?.name ?? "المنتج"} — مكوّن تراثي معروف، بيوصلك لباب البيت والدفع عند الاستلام.`, headline: "اطلب هلأ", cta: "اطلب الآن", angle: "التراث", flag: "green", note: null },
          { hook: "روتين بسيط كل يوم", body: `جرّب ${p?.name ?? "المنتج"} ضمن روتينك اليومي. توصيل سريع والدفع لما يوصلك.`, headline: "الدفع عند الاستلام", cta: "اطلب الآن", angle: "السهولة", flag: "green", note: null },
        ],
      });
    }
    const product = await db.productEconomics.findUnique({ where: { productCode: parsed.data.productCode } });
    if (!product) throw new HttpError(404, "المنتج مش موجود");
    try {
      return NextResponse.json(await writeVariants({ productName: product.name, market: product.market, angle: parsed.data.angle }));
    } catch (e) {
      if (e instanceof AgentUnavailable) throw new HttpError(503, "ما في موديل موصول لكاتب الإعلانات — اكتب النص بإيدك، والقاموس بيفحصه");
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
