import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authRequired, readSession } from "@/lib/session-token";

/**
 * Paths anybody may open: the login door, health, the static brand files, and what installing the app needs
 * (manifest, icons, the service worker, the offline page — none of them carries data). The connector's OAuth: the discovery documents, client registration and the token
 * endpoint are open (the client has no account; each checks its own proof: the PKCE verifier, the refresh token). /oauth/authorize is NOT open: it needs the owner's session. The content studio's paths carry no
 * session: each route there checks its own Bearer token (src/server/api-token.ts). So does /mcp, the server Claude connects to.
 */
const OPEN = [/^\/login/, /^\/api\/auth\//, /^\/api\/health/, /^\/api\/telegram\/webhook/, /^\/api\/vidpattern\//, /^\/api\/v1\/vp\//, /^\/api\/v1\/handoffs/, /^\/api\/v1\/video-requests/, /^\/mcp$/, /^\/\.well-known\//, /^\/oauth\/(register|token)$/, /^\/brand\//, /^\/fonts\//, /^\/_next\//, /^\/favicon/, /^\/icons\//, /^\/manifest\.webmanifest$/, /^\/sw\.js$/, /^\/offline$/];

/** Signed-out visitors go to the door; an API call without a session gets 401 (spec 13.7: every route checks access). */
export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  // the layout reads the address from this header, to answer «هالصفحة مش من صلاحياتك» for a role that may not open it (src/app/(app)/layout.tsx)
  const pass = () => {
    const h = new Headers(req.headers);
    h.set("x-pathname", path);
    return NextResponse.next({ request: { headers: h } });
  };
  if (!authRequired() || OPEN.some((r) => r.test(path))) return pass();
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (session) return pass();
  if (path.startsWith("/api/")) return NextResponse.json({ error: "لازم تسجّل دخول" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = path === "/" ? "" : `?next=${encodeURIComponent(path + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

/**
 * The upload route of the studio is left out of the matcher: Next buffers a request body that goes through middleware, and a
 * 500 MB video would sit in memory (ENGINEER_ONBOARDING F-10). It is in OPEN anyway — the route checks its own Bearer token.
 */
export const config = { matcher: ["/((?!_next/static|_next/image|api/v1/vp/launch-requests$).*)"] };
