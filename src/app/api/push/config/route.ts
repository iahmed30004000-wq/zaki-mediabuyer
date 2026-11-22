import { NextResponse } from "next/server";
import { firebaseMissing, webConfigFromEnv } from "@/adapters/fcm";
import { isDemo } from "@/core/readiness";
import { errorResponse, requireSignedIn } from "@/server/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/push/config — what the browser needs to ask for push notifications: the four public values of the Firebase web app and the public Web Push key (05-notify.md §5).
 * None of them is secret; the service account's file never leaves the server. Only for a signed-in person. While anything is missing the answer says `configured: false` and names
 * what is missing (names, never values), so the page shows «لازم تربط Firebase» instead of a button that cannot work.
 */
export async function GET() {
  try {
    await requireSignedIn();
    if (isDemo(process.env)) return NextResponse.json({ configured: false, demo: true, missing: [], web: null });
    const missing = firebaseMissing();
    const web = missing.length ? null : webConfigFromEnv();
    return NextResponse.json({ configured: !!web, missing, web });
  } catch (e) {
    return errorResponse(e);
  }
}
