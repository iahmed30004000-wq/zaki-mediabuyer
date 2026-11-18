import { authorizationServerMetadata } from "@/core/oauth";
import { appOrigin } from "@/server/env";
import { jsonOk, preflight } from "@/server/oauth-http";

export const dynamic = "force-dynamic";

/** RFC 8414: where to register, authorize and get a token (public clients, PKCE S256 only). */
export const GET = () => jsonOk(authorizationServerMetadata(appOrigin()), 200, true);
export const OPTIONS = preflight;
