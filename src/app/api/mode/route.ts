import { NextResponse } from "next/server";
import { z } from "zod";
import { NightPermissionSchema } from "@/core/mode";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { currentMode, setMode, setNightPermissions, setWakeKinds } from "@/server/mode";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    mode: z.enum(["awake", "asleep"]).optional(),
    schedule: z.object({ enabled: z.boolean().optional(), awake: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), asleep: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional() }).strict().optional(),
    nightPermissions: z.array(NightPermissionSchema).max(30).optional(),
    wakeKinds: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  })
  .strict();

/** GET /api/mode — صاحي / نايم (the clock may overrule the switch), the night permissions, the kinds that wake him. */
export async function GET() {
  try {
    await requireCapability("view");
    return NextResponse.json(await currentMode());
  } catch (e) {
    return errorResponse(e);
  }
}

/** PUT /api/mode — the owner's switch, his schedule, and what may happen while he sleeps. */
export async function PUT(req: Request) {
  try {
    const caller = await requireCapability("owner_only");
    if (process.env.MOCK_MODE === "1" || caller.demo) return NextResponse.json({ ok: true, demo: true });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "طلب غير مفهوم");
    const b = parsed.data;
    if (b.nightPermissions) await setNightPermissions(b.nightPermissions, caller.id);
    if (b.wakeKinds) await setWakeKinds(b.wakeKinds, caller.id);
    const view = b.mode || b.schedule ? await setMode({ mode: b.mode, schedule: b.schedule }, caller.id) : await currentMode();
    return NextResponse.json({ ok: true, ...view });
  } catch (e) {
    return errorResponse(e);
  }
}
