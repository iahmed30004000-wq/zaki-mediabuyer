import { NextResponse } from "next/server";
import { invalid, withHandoffToken } from "@/server/handoff-api";
import { VideoRequestComplete, completeVideoRequest } from "@/server/video-requests";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/video-requests/:id/complete — answer it: `{ note, result: {…}, new_videos: [{ job, v_name, drive_file_id, scenario_file_id }] }`.
 * The request becomes «جاهز»; the new videos land in the bank as «جاهز». The owner uploads them and marks the request «مرفوع».
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withHandoffToken(req, async ({ by, actor }) => {
    const parsed = VideoRequestComplete.safeParse((await req.json().catch(() => ({}))) ?? {});
    if (!parsed.success) return invalid(parsed.error.issues);
    return NextResponse.json({ request: await completeVideoRequest(params.id, parsed.data, by, actor) });
  });
}
