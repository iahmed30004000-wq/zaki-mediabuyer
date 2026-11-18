import { NextResponse } from "next/server";
import { contractResponse, requireToken } from "@/server/api-token";
import { productMarketFacts } from "@/server/studio-launch";

export const dynamic = "force-dynamic";

/** GET /api/vidpattern/product-market?product=<code|alias>&country=<SY|JO> — what we really know about the product (contract §4.2 #5). */
export async function GET(req: Request) {
  try {
    await requireToken(req, "vp:read");
    const q = new URL(req.url).searchParams;
    return NextResponse.json(await productMarketFacts(q.get("product"), q.get("country")));
  } catch (e) {
    return contractResponse(e);
  }
}
