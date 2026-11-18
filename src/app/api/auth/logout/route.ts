import { NextResponse } from "next/server";
import { endSession } from "@/server/auth";

/** Signing out also empties the pages the phone kept for offline (Clear-Site-Data), so nothing stays on the device. */
export async function POST() {
  endSession();
  return NextResponse.json({ ok: true }, { headers: { "Clear-Site-Data": '"cache"' } });
}
