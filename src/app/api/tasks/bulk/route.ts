import { NextResponse } from "next/server";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { TaskBulkInput, bulkUpdateTasks } from "@/server/tasks";

export const dynamic = "force-dynamic";

/** POST /api/tasks/bulk — the same change (status · person · priority · board · archive) on up to a hundred cards. */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("tasks.manage");
    if (caller.demo) return NextResponse.json({ ok: true, demo: true });
    const parsed = TaskBulkInput.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "طلب غير مفهوم: " + parsed.error.issues.slice(0, 2).map((i) => i.message).join(" · "));
    return NextResponse.json({ ok: true, ...(await bulkUpdateTasks(parsed.data, { type: "user", id: caller.id })) });
  } catch (e) {
    return errorResponse(e);
  }
}
