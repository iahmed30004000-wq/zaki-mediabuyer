import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CONNECTOR_ACTOR, OAUTH_SCOPES, authorizationServerMetadata, clientName, hostsOf, isChallenge, isVerifier, parseScopes, protectedResourceMetadata, redirectUriProblem, wwwAuthenticate } from "@/core/oauth";
import { MCP_SCOPES, toolAllowed } from "@/core/token-scopes";

describe("the connector's scopes", () => {
  it("a connector token may hold exactly the MCP scopes — and none of them approves spend", () => {
    expect([...OAUTH_SCOPES]).toEqual([...MCP_SCOPES]);
    expect(CONNECTOR_ACTOR).toBe("claude");
    expect(MCP_SCOPES.some((s) => /spend|approve|meta/.test(s))).toBe(false);
  });
  it("nothing asked = all of them; unknown names are dropped; a narrower ask is respected", () => {
    expect(parseScopes(undefined)).toEqual([...MCP_SCOPES]);
    expect(parseScopes("")).toEqual([...MCP_SCOPES]);
    expect(parseScopes("evil owner_only")).toEqual([...MCP_SCOPES]);
    expect(parseScopes("mcp:read mcp:push mcp:push evil")).toEqual(["mcp:read", "mcp:push"]);
    // and a token with only mcp:read cannot call a push tool
    expect(toolAllowed(parseScopes("mcp:read"), "push_metrics")).toBe(false);
    expect(toolAllowed(parseScopes("mcp:read"), "get_rules")).toBe(true);
  });
});

describe("where a client may come back to", () => {
  it("Claude's own addresses and the local machine; nothing else without the owner's list", () => {
    expect(redirectUriProblem("https://claude.ai/api/mcp/auth_callback")).toBeNull();
    expect(redirectUriProblem("https://claude.com/api/mcp/auth_callback")).toBeNull();
    expect(redirectUriProblem("http://localhost:6274/oauth/callback")).toBeNull();
    expect(redirectUriProblem("http://127.0.0.1:33418/cb")).toBeNull();
    expect(redirectUriProblem("https://evil.example/cb")).not.toBeNull();
    expect(redirectUriProblem("https://claude.ai.evil.example/cb")).not.toBeNull();
    expect(redirectUriProblem("https://evilclaude.ai/cb")).not.toBeNull();
    expect(redirectUriProblem("http://claude.ai/cb")).not.toBeNull(); // plain http only on the local machine
    expect(redirectUriProblem("javascript:alert(1)")).not.toBeNull();
    expect(redirectUriProblem("https://claude.ai/cb#frag")).not.toBeNull();
    expect(redirectUriProblem("https://user:pw@claude.ai/cb")).not.toBeNull();
    expect(redirectUriProblem(42)).not.toBeNull();
  });
  it("the owner can add a host (and its subdomains) by environment", () => {
    expect(hostsOf(" Example.org, ,tools.test ")).toEqual(["example.org", "tools.test"]);
    expect(redirectUriProblem("https://app.example.org/cb", ["example.org"])).toBeNull();
    expect(redirectUriProblem("https://notexample.org/cb", ["example.org"])).not.toBeNull();
  });
});

describe("PKCE shapes (RFC 7636)", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"; // the RFC's own example
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  it("the RFC example verifier and its S256 challenge are accepted; short or odd ones are not", () => {
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(isVerifier(verifier)).toBe(true);
    expect(isChallenge(challenge)).toBe(true);
    expect(isVerifier("short")).toBe(false);
    expect(isVerifier("x".repeat(129))).toBe(false);
    expect(isVerifier("a b".padEnd(50, "c"))).toBe(false);
    expect(isChallenge(challenge + "=")).toBe(false);
    expect(isChallenge(undefined)).toBe(false);
  });
});

describe("what a client may write about itself, and the discovery documents", () => {
  it("a name is cut and cleaned, and a missing one gets a plain word", () => {
    expect(clientName("  Claude\n<script>  ")).toBe("Claude script");
    expect(clientName("x".repeat(200)).length).toBe(60);
    expect(clientName(undefined)).toBe("تطبيق بلا اسم");
  });
  it("the metadata points at this site: public clients, S256 only, no secret", () => {
    const o = "https://mediabuyer.example";
    expect(protectedResourceMetadata(o)).toMatchObject({ resource: `${o}/mcp`, authorization_servers: [o] });
    expect(authorizationServerMetadata(o)).toMatchObject({
      issuer: o,
      authorization_endpoint: `${o}/oauth/authorize`,
      token_endpoint: `${o}/oauth/token`,
      registration_endpoint: `${o}/oauth/register`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      grant_types_supported: ["authorization_code", "refresh_token"],
    });
    expect(wwwAuthenticate(o)).toBe(`Bearer realm="zaki-mediabuyer", resource_metadata="${o}/.well-known/oauth-protected-resource"`);
  });
});
