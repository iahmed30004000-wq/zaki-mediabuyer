import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { TaskRefused, mergeTasks } from "@/server/tasks";

export const dynamic = "force-dynamic";

const Body = z.object({ keep: z.string().trim().min(1).max(40), drop: z.array(z.string().trim().min(1).max(40)).min(1).max(20) }).strict();

/** POST /api/tasks/merge — `{ keep, drop: [...] }`: the same job written twice becomes one card; the others are archived, nothing is lost. */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("tasks.manage");
    if (caller.demo) return NextResponse.json({ ok: true, demo: true });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "طلب غير مفهوم");
    try {
      return NextResponse.json({ ok: true, task: await mergeTasks(parsed.data.keep, parsed.data.drop, { type: "user", id: caller.id }) });
    } catch (e) {
      if (e instanceof TaskRefused) throw new HttpError(400, e.message);
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
