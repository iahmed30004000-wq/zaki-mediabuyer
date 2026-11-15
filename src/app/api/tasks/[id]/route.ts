import { NextResponse } from "next/server";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { TaskRefused, TaskUpdateInput, updateTask } from "@/server/tasks";

export const dynamic = "force-dynamic";

const Patch = TaskUpdateInput.omit({ id: true });

/** PATCH /api/tasks/:id — move a card (status), give it to someone, set its date or priority, write a note, or archive it. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const caller = await requireCapability("propose_change");
    if (caller.demo) return NextResponse.json({ ok: true, demo: true });
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
