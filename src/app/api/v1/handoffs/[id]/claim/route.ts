import { NextResponse } from "next/server";
import { withHandoffToken } from "@/server/handoff-api";
import { claimHandoff } from "@/server/handoffs";

export const dynamic = "force-dynamic";

/** POST /api/v1/handoffs/:id/claim — take it before starting: the workflow shows «running, with you». A second taker gets 409. */
export async function POST(req: Request, { params: paramsP }: { params: Promise<{ id: string }> }) {
  const params = await paramsP;
  return withHandoffToken(req, async ({ by, actor }) => NextResponse.json({ handoff: await claimHandoff(params.id, by, actor) }));
}
