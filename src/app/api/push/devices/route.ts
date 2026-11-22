import { NextResponse } from "next/server";
import { z } from "zod";
import { isDemo } from "@/core/readiness";
import { errorResponse, HttpError, requireSignedIn } from "@/server/auth";
import { DeviceInput, listDevices, registerDevice, removeDeviceByToken } from "@/server/push-devices";

export const dynamic = "force-dynamic";

/** GET /api/push/devices — the person's own phones (name, platform, last seen). The token is never in the answer. */
export async function GET() {
  try {
    const caller = await requireSignedIn();
    if (isDemo(process.env) || caller.demo) return NextResponse.json({ devices: [] });
    return NextResponse.json({ devices: await listDevices(caller.id) });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * POST /api/push/devices `{ token, kind?, platform?, label? }` — registers this browser for the signed-in person, or refreshes it (the token is unique; `lastSeenAt` moves).
 * It is always the caller's own: there is no way to register a phone for somebody else. The token is stored, never returned and never logged.
 */
export async function POST(req: Request) {
  try {
    const caller = await requireSignedIn();
    const parsed = DeviceInput.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "بيانات الجهاز مش صحيحة");
    if (isDemo(process.env) || caller.demo) throw new HttpError(409, "الموقع على الوضع التجريبي — الإشعارات بدها موقع حقيقي");
    return NextResponse.json({ ok: true, ...(await registerDevice(caller.id, parsed.data)) });
  } catch (e) {
    return errorResponse(e);
  }
}

const ByToken = z.object({ token: z.string().trim().min(8).max(4096) }).strict();

/** DELETE /api/push/devices `{ token }` — this browser stops its own pushes (turned off, or signing out): by its token, the caller's own only. */
export async function DELETE(req: Request) {
  try {
    const caller = await requireSignedIn();
    const parsed = ByToken.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "طلب غير مفهوم");
    if (isDemo(process.env) || caller.demo) return NextResponse.json({ ok: true, removed: 0 });
    return NextResponse.json({ ok: true, removed: await removeDeviceByToken(caller.id, parsed.data.token) });
  } catch (e) {
    return errorResponse(e);
  }
}
