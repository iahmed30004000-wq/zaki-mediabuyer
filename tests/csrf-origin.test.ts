/**
 * A request that changes something must come from a page of this site (Origin / Sec-Fetch-Site);
 * the routes that carry their own proof (Bearer token, signed body) are exempt.
 * The address after sign-in stays inside the site.
 */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { ownHosts, safeNext, sameSiteRequest } from "@/core/auth-guards";
import { middleware } from "@/middleware";

const hosts = ["mediabuyer.zakiai.io"];
const post = (path: string, origin: string | null, secFetchSite: string | null = null) => sameSiteRequest({ method: "POST", path, origin, secFetchSite, hosts });

describe("sameSiteRequest", () => {
  it("reads are never blocked", () => {
    expect(sameSiteRequest({ method: "GET", path: "/api/x", origin: "https://evil.example", secFetchSite: "cross-site", hosts })).toBe(true);
    expect(sameSiteRequest({ method: "HEAD", path: "/", origin: "https://evil.example", secFetchSite: null, hosts })).toBe(true);
  });

  it("a write from our own page passes, from anywhere else does not", () => {
    expect(post("/api/changes/1", "https://mediabuyer.zakiai.io")).toBe(true);
    expect(post("/api/changes/1", "https://evil.example")).toBe(false);
  });

  it("another host of the same domain is not this site", () => {
    expect(post("/api/accounts/1/caps", "https://studio.zakiai.io")).toBe(false);
    expect(post("/api/accounts/1/caps", "https://mediabuyer.zakiai.io.evil.example")).toBe(false);
  });

  it("Origin: null and an unparseable Origin are refused", () => {
    expect(post("/api/changes/1", "null")).toBe(false);
    expect(post("/api/changes/1", "garbage")).toBe(false);
  });

  it("with no Origin, Sec-Fetch-Site decides; with neither it is not a browser page", () => {
    expect(post("/api/changes/1", null, "cross-site")).toBe(false);
    expect(post("/api/changes/1", null, "same-site")).toBe(false);
    expect(post("/api/changes/1", null, "same-origin")).toBe(true);
    expect(post("/api/changes/1", null, "none")).toBe(true);
    expect(post("/api/changes/1", null, null)).toBe(true);
  });

  it("token routes are exempt: they carry a Bearer token or a signed body, never the cookie", () => {
    for (const p of ["/mcp", "/api/telegram/webhook", "/api/inbound/oms", "/api/v1/vp/creatives", "/api/v1/handoffs/claim", "/api/v1/video-requests/1/complete", "/oauth/token", "/oauth/register", "/api/vidpattern/queue/1/result"]) {
      expect(post(p, "https://anything.example"), p).toBe(true);
    }
  });

  it("the sign-in, sign-out and OAuth consent posts are checked (they use the cookie)", () => {
    for (const p of ["/api/auth/login", "/api/auth/logout", "/oauth/authorize"]) expect(post(p, "https://evil.example"), p).toBe(false);
  });
});

describe("ownHosts", () => {
  it("collects the Host header, the first forwarded host and the host of APP_URL", () => {
    expect(ownHosts({ host: "localhost:3140", forwardedHost: "Mediabuyer.zakiai.io, proxy.internal", appUrl: "https://mediabuyer.zakiai.io/" }).sort()).toEqual(["localhost:3140", "mediabuyer.zakiai.io"]);
    expect(ownHosts({ host: null, forwardedHost: null, appUrl: undefined })).toEqual([]);
  });
});

describe("the middleware", () => {
  const req = (method: string, path: string, headers: Record<string, string>) => new NextRequest(`http://localhost:3140${path}`, { method, headers: { host: "mediabuyer.zakiai.io", ...headers } });

  it("a cross-site POST gets 403 before anything else", async () => {
    const res = await middleware(req("POST", "/api/changes/c1", { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("a same-site POST goes on to the session check (401: no cookie here)", async () => {
    const res = await middleware(req("POST", "/api/changes/c1", { origin: "https://mediabuyer.zakiai.io" }));
    expect(res.status).toBe(401);
  });

  it("a token route is let through whatever its Origin", async () => {
    const res = await middleware(req("POST", "/mcp", { origin: "https://claude.ai" }));
    expect(res.status).toBe(200);
  });
});

describe("safeNext", () => {
  it("keeps addresses inside the site", () => {
    expect(safeNext("/inbox")).toBe("/inbox");
    expect(safeNext("/ads/campaigns?x=1")).toBe("/ads/campaigns?x=1");
  });
  it("turns everything else into the home page", () => {
    for (const bad of ["//evil.example", "/\\evil.example", "/\\/evil.example", "https://evil.example", "javascript:alert(1)", "/\u0009/evil.example", "/a\u0000b", "evil.example", "", "\\evil", "/%0d%0a"]) {
      const out = safeNext(bad);
      expect(out === "/" || out === "/%0d%0a", bad).toBe(true);
    }
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
  });
});
