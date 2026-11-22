import { NextResponse } from "next/server";
import { currentCaller, endSession } from "@/server/auth";
import { db } from "@/server/db";

/**
 * Signing out ends the session on the server too (the person's session version moves) and empties what the browser kept (Clear-Site-Data), so nothing of the site stays on the device.
 */
export async function POST() {
  const me = await currentCaller().catch(() => null);
  if (me && !me.demo) await db.user.update({ where: { id: me.id }, data: { sessionVer: { increment: 1 } } }).catch(() => undefined);
  endSession();
  return NextResponse.json({ ok: true }, { headers: { "Clear-Site-Data": '"cache", "storage"' } });
}
