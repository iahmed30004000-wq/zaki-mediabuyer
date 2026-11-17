/**
 * THE OAUTH RULES for the claude.ai custom connector (OAuth 2.1 · dynamic client registration RFC 7591 · PKCE S256). Pure: what a redirect address may be, how a
 * scope list is read, what a verifier and a challenge look like, and the shape of an error. The database and the HTTP are in src/server/oauth.ts.
 */
import { MCP_SCOPES, type McpScope } from "./token-scopes";

/** What a connector token may hold: exactly the scopes of an MCP token — never a scope that approves spend. */
export const OAUTH_SCOPES: readonly McpScope[] = MCP_SCOPES;

/** The agent every connector token is tied to (the team directory's `claude`). */
export const CONNECTOR_ACTOR = "claude";

export const ACCESS_TTL_S = 3600; // an access token lives an hour; the refresh token brings the next
export const REFRESH_TTL_DAYS = 60;
export const CODE_TTL_S = 600; // an authorization code lives ten minutes and works once

/** `scope` is a space-separated list. Unknown names are dropped; nothing asked = everything an MCP token may hold. */
export function parseScopes(raw: unknown): McpScope[] {
  const asked = typeof raw === "string" ? raw.split(/[\s,]+/).filter(Boolean) : [];
  const known = [...new Set(asked.filter((s): s is McpScope => (OAUTH_SCOPES as readonly string[]).includes(s)))];
  return known.length ? known : [...OAUTH_SCOPES];
}

/** Hosts a client may redirect back to: Claude's own, the local machine, and whatever the owner adds in `OAUTH_REDIRECT_HOSTS` (comma separated). */
const BUILT_IN_HOST = /(^|\.)(claude\.ai|claude\.com|anthropic\.com)$/;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function redirectUriProblem(uri: unknown, extraHosts: readonly string[] = []): string | null {
  if (typeof uri !== "string" || uri.length > 400) return "redirect_uri غير صالح";
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return "redirect_uri غير صالح";
  }
  if (u.hash) return "redirect_uri ما بيصير فيه #";
  if (u.username || u.password) return "redirect_uri ما بيصير فيه اسم مستخدم";
  if (u.protocol === "http:" && LOOPBACK.has(u.hostname)) return null; // a client on the owner's own machine (any port)
  if (u.protocol !== "https:") return "redirect_uri لازم https";
  const host = u.hostname.toLowerCase();
  if (BUILT_IN_HOST.test(host) || extraHosts.some((h) => h && (host === h || host.endsWith(`.${h}`)))) return null;
  return `الموقع ${host} مش مسموح كوجهة رجوع`;
}

export const hostsOf = (env: string | undefined): string[] => (env ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

/** RFC 7636: a verifier is 43–128 unreserved characters; an S256 challenge is the base64url of a sha256 (43 characters). */
export const isVerifier = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9\-._~]{43,128}$/.test(v);
export const isChallenge = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9\-_]{43}$/.test(v);

export type OAuthErrorCode = "invalid_request" | "invalid_client" | "invalid_grant" | "unauthorized_client" | "unsupported_grant_type" | "invalid_scope" | "invalid_redirect_uri" | "invalid_client_metadata" | "access_denied" | "server_error";

export interface OAuthError {
  error: OAuthErrorCode;
  error_description: string;
}
export const oauthError = (error: OAuthErrorCode, error_description: string): OAuthError => ({ error, error_description });

/** What a client says about itself, cut to something safe to print on the consent page and in the owner's list. */
export function clientName(raw: unknown): string {
  const s = typeof raw === "string" ? raw.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) : "";
  return s || "تطبيق بلا اسم";
}

/** The discovery documents (RFC 9728 and RFC 8414) for an origin. */
export function protectedResourceMetadata(origin: string) {
  return { resource: `${origin}/mcp`, authorization_servers: [origin], bearer_methods_supported: ["header"], scopes_supported: [...OAUTH_SCOPES], resource_name: "الميديا باير" };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...OAUTH_SCOPES],
  };
}

/** The `WWW-Authenticate` of a refused /mcp call: it points the client at the resource metadata, which is how it finds the authorization server. */
export const wwwAuthenticate = (origin: string): string => `Bearer realm="zaki-mediabuyer", resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
