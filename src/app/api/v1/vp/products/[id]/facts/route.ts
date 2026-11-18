import { NextResponse } from "next/server";
import { contractResponse, requireToken } from "@/server/api-token";
import { productMarketFacts } from "@/server/studio-launch";

export const dynamic = "force-dynamic";

/** GET /api/v1/vp/products/{id}/facts?country= — the same body as product-market; `{id}` is our product code. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireToken(req, "vp:read");
    return NextResponse.json(await productMarketFacts(params.id, new URL(req.url).searchParams.get("country")));
  } catch (e) {
    return contractResponse(e);
  }
}
