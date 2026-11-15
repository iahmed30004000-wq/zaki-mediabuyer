import { NextResponse } from "next/server";
import { errorResponse, requireCapability } from "@/server/auth";
import { listHandoffs } from "@/server/handoffs";
import { listWorkflows } from "@/server/workflows";

export const dynamic = "force-dynamic";

/** GET /api/workflow/live — every workflow with its last run, the run that is moving now, its next run, and what is waiting in the handoff queue. The open page asks every few seconds. */
export async function GET() {
  try {
    await requireCapability("view");
    const [workflows, handoffs] = await Promise.all([listWorkflows(), listHandoffs({ status: ["open", "claimed"] })]);
    return NextResponse.json({ workflows, handoffs, at: new Date().toISOString() });
  } catch (e) {
    return errorResponse(e);
  }
}
