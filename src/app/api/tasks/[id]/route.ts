import { NextResponse } from "next/server";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { db } from "@/server/db";
import { taskKeysFor } from "@/server/directory";
import { TaskRefused, TaskUpdateInput, updateTask } from "@/server/tasks";

export const dynamic = "force-dynamic";

const Patch = TaskUpdateInput.omit({ id: true });

/** PATCH /api/tasks/:id — move a card (status), give it to someone, set its date or priority, write a note, or archive it. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const caller = await requireCapability("tasks.own");
    if (caller.demo) return NextResponse.json({ ok: true, demo: true });
    // a person who may only look after their own tasks (or their team's) cannot touch anybody else's
    const keys = await taskKeysFor(caller);
    if (keys) {
      const t = await db.task.findUnique({ where: { id: params.id }, select: { assignee: true } });
      if (!t || !t.assignee || !keys.includes(t.assignee)) throw new HttpError(403, "هاي مهمة مش مهمتك");
    }
    const parsed = Patch.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "طلب غير مفهوم");
    try {
      const task = await updateTask({ id: params.id, ...parsed.data }, { type: "user", id: caller.id });
      if (!task) throw new HttpError(404, "المهمة مش موجودة");
      return NextResponse.json({ ok: true, task });
    } catch (e) {
      if (e instanceof TaskRefused) throw new HttpError(400, e.message);
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
