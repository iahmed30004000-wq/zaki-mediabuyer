import { NextResponse } from "next/server";
import { z } from "zod";
import { isDemo } from "@/core/readiness";
import { HttpError, errorResponse, requireCapability } from "@/server/auth";
import { tidyJobs } from "@/server/job-map";

export const dynamic = "force-dynamic";

const Key = z.string().trim().min(1).max(80);
const Body = z
  .object({
    merges: z.array(z.object({ keep: Key, drop: Key }).strict()).max(50).default([]),
    archive: z.array(Key).max(100).default([]),
    renumber: z.boolean().default(true),
  })
  .strict()
  .refine((b) => b.merges.length > 0 || b.archive.length > 0, "اختار على الأقل مهمة تدمجها أو تأرشفها");

/**
 * POST /api/jobs/tidy — «نظّف المكرّر» (docs/rebuild-v6/01-model.md §12): `{ merges: [{ keep, drop }], archive: [key], renumber }`. The pairs the owner chose are merged into the job that keeps
 * their history, the jobs that never ran are put away (nothing is deleted), and the map is renumbered 1…N. It touches nothing on Meta and spends nothing.
 */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("work.control");
    if (isDemo(process.env) || caller.demo) return NextResponse.json({ ok: true, demo: true });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "طلب غير مفهوم");
    return NextResponse.json({ ok: true, ...(await tidyJobs(parsed.data, { type: "user", id: caller.id })) });
  } catch (e) {
    return errorResponse(e);
  }
}
