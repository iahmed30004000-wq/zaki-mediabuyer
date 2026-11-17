import { protectedResourceMetadata } from "@/core/oauth";
import { appOrigin } from "@/server/env";
import { jsonOk, preflight } from "@/server/oauth-http";

export const dynamic = "force-dynamic";

/** RFC 9728: what /mcp is and which server authorizes it. claude.ai reads this after the 401 of /mcp (also at the path-suffixed address). */
export const GET = () => jsonOk(protectedResourceMetadata(appOrigin()), 200, true);
export const OPTIONS = preflight;
