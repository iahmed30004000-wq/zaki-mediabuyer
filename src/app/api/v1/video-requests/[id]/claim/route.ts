import { NextResponse } from "next/server";
import { withHandoffToken } from "@/server/handoff-api";
import { claimVideoRequest } from "@/server/video-requests";

export const dynamic = "force-dynamic";

/** POST /api/v1/video-requests/:id/claim — take it before starting: the request shows «عند هيرمز» with your name. A second taker gets 409. */
export async function POST(req: Request, { params: paramsP }: { params: Promise<{ id: string }> }) {
  const params = await paramsP;
  return withHandoffToken(req, async ({ by, actor }) => NextResponse.json({ request: await claimVideoRequest(params.id, by, actor) }));
}
