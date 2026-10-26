import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authRequired, readSession } from "@/lib/session-token";

/**
 * Paths anybody may open: the login door, health, the static brand files, and what installing the app needs
 * (manifest, icons, the service worker, the offline page — none of them carries data). The content studio's paths carry no
 * session: each route there checks its own Bearer token (src/server/api-token.ts).
 */
const OPEN = [/^\/login/, /^\/api\/auth\//, /^\/api\/health/, /^\/api\/telegram\/webhook/, /^\/api\/vidpattern\//, /^\/api\/v1\/vp\//, /^\/brand\//, /^\/fonts\//, /^\/_next\//, /^\/favicon/, /^\/icons\//, /^\/manifest\.webmanifest$/, /^\/sw\.js$/, /^\/offline$/];

/** Signed-out visitors go to the door; an API call without a session gets 401 (spec 13.7: every route checks access). */
export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (!authRequired() || OPEN.some((r) => r.test(path))) return NextResponse.next();
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();
  if (path.startsWith("/api/")) return NextResponse.json({ error: "لازم تسجّل دخول" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = path === "/" ? "" : `?next=${encodeURIComponent(path)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
