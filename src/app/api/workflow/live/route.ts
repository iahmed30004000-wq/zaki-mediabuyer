import { NextResponse } from "next/server";
import { errorResponse, requireCapability } from "@/server/auth";
import { listWorkflows } from "@/server/workflows";

export const dynamic = "force-dynamic";

/** GET /api/workflow/live — every workflow with its last run, the run that is moving now, and its next run. The open page asks every few seconds. */
export async function GET() {
  try {
    await requireCapability("view");
    return NextResponse.json({ workflows: await listWorkflows(), at: new Date().toISOString() });
  } catch (e) {
    return errorResponse(e);
  }
}
