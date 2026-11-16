import { NextResponse } from "next/server";
import { checkActor } from "@/core/directory";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { loadDirectory } from "@/server/directory";

export const dynamic = "force-dynamic";

/** GET /api/team/actors — the team directory (people and agents). The owner's. A Telegram number is never in the answer: only whether one is set. */
export async function GET() {
  try {
    await requireCapability("owner_only");
    return NextResponse.json({ actors: await loadDirectory({ includeInactive: true }) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** POST /api/team/actors { key, name, kind, team? } — adds a person or an agent. Their name is written here, never in the code. */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("owner_only");
    if (caller.demo) throw new HttpError(403, "بلا تسجيل دخول ما بينضاف حدا");
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const c = checkActor(body ?? {}, { creating: true });
    if (!c.ok) throw new HttpError(400, c.error);
    if (await db.actor.findUnique({ where: { key: c.value.key } })) throw new HttpError(409, "هالمفتاح مستعمل");
    const row = await db.actor.create({ data: c.value });
    await audit({ type: "user", id: caller.id }, "team.actor_create", { type: "actor", id: row.key }, { after: { key: row.key, kind: row.kind, team: row.team } });
    return NextResponse.json({ ok: true, key: row.key }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
