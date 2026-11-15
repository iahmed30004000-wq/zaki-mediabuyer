import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { getValues } from "@/server/customize";
import { TaskCreateInput, TaskRefused, createTask, listTasks, quickAddTask } from "@/server/tasks";

export const dynamic = "force-dynamic";

/** GET /api/tasks?board=leak&assignee=muse — the board's cards (finished ones only from the last two weeks). */
export async function GET(req: Request) {
  try {
    await requireCapability("view");
    const q = new URL(req.url).searchParams;
    const tasks = await listTasks({ board: q.get("board") ?? undefined, assignee: q.get("assignee") ?? undefined, limit: 300, doneWithinDays: 14 });
    return NextResponse.json({ tasks, values: await getValues("task", tasks.map((t) => t.id)) });
  } catch (e) {
    return errorResponse(e);
  }
}

const Quick = z.object({ text: z.string().trim().min(1).max(300), board: z.string().trim().min(1).max(40).optional() }).strict();

/** POST /api/tasks — `{ text }` is the one-line quick add («بكرا لميوز: …»); a full task works too. */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("propose_change");
    const body = await req.json().catch(() => null);
    const actor = { type: "user" as const, id: caller.id };
    // with no account to write for (sign-in switched off) nothing is saved
    if (caller.demo) return NextResponse.json({ ok: true, demo: true });
    try {
      const quick = Quick.safeParse(body);
      if (quick.success) return NextResponse.json({ ok: true, task: await quickAddTask(quick.data.text, actor, { board: quick.data.board }) }, { status: 201 });
      const full = TaskCreateInput.safeParse(body);
      if (!full.success) throw new HttpError(400, "طلب غير مفهوم");
      return NextResponse.json({ ok: true, task: await createTask(full.data, actor, "ui") }, { status: 201 });
    } catch (e) {
      if (e instanceof TaskRefused) throw new HttpError(400, e.message);
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
