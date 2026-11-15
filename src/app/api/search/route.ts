import { NextResponse } from "next/server";
import { searchable } from "@/core/search";
import { errorResponse, requireCapability } from "@/server/auth";
import { searchData } from "@/server/search";

export const dynamic = "force-dynamic";

/** GET /api/search?q=… — names that match (products, workflows, tasks, videos, ads, campaigns), each with the screen that shows it. Names and links only. */
export async function GET(req: Request) {
  try {
    await requireCapability("view");
    const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 80);
    if (!searchable(q)) return NextResponse.json({ hits: [] });
    return NextResponse.json({ hits: await searchData(q) });
  } catch (e) {
    return errorResponse(e);
  }
}
