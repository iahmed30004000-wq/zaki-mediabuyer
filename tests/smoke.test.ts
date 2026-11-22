import { describe, expect, it } from "vitest";
import { BAD_TEXT, SMOKE_PAGES, cookieHeader, isLocalBase, judgePage, runSmoke } from "../scripts/smoke.mjs";

/** A fake site: `routes` maps an address to a Response factory. */
function fakeSite(routes: Record<string, (init?: RequestInit) => Response>) {
  const seen: { url: string; cookie: string | null }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    seen.push({ url: u.pathname, cookie: new Headers(init?.headers).get("cookie") });
    const r = routes[u.pathname];
    return r ? r(init) : new Response("not found", { status: 404 });
  };
  return { fetchImpl, seen };
}

const html = (body: string, status = 200) => () => new Response(body, { status });
const login = (cookie = "mb_session=abc; Path=/; HttpOnly") => () => {
  const h = new Headers();
  h.append("set-cookie", cookie);
  return new Response('{"ok":true}', { status: 200, headers: h });
};
const health = () => new Response('{"ok":false,"version":"abc1234","worker":{"ok":false}}', { status: 200 });

describe("smoke — judging one answer", () => {
  it("passes a normal page and a redirect that has an address", () => {
    expect(judgePage({ status: 200, body: "<h1>الشغل</h1>" })).toBeNull();
    expect(judgePage({ status: 307, location: "/work/today" })).toBeNull();
  });
  it("fails 5xx, 4xx, a redirect with no address, and the crash texts", () => {
    expect(judgePage({ status: 500 })).toMatch(/500/);
    expect(judgePage({ status: 404 })).toMatch(/404/);
    expect(judgePage({ status: 302 })).toMatch(/no address/);
    for (const t of BAD_TEXT) expect(judgePage({ status: 200, body: `<p>${t}</p>` })).toMatch(/error screen/);
  });
});

describe("smoke — helpers", () => {
  it("builds a Cookie header from Set-Cookie lines (attributes dropped, last value wins)", () => {
    expect(cookieHeader(["mb_session=one; Path=/; HttpOnly; Secure", "other=2; Max-Age=5", "mb_session=two; Path=/"])).toBe("mb_session=two; other=2");
    expect(cookieHeader([])).toBe("");
  });
  it("only local addresses count as local", () => {
    expect(isLocalBase("http://localhost:3140")).toBe(true);
    expect(isLocalBase("http://127.0.0.1:3140/")).toBe(true);
    expect(isLocalBase("https://mediabuyer.example.com")).toBe(false);
    expect(isLocalBase("http://localhost.evil.test")).toBe(false);
    expect(isLocalBase("not a url")).toBe(false);
  });
  it("starts with the home page and the work place", () => {
    expect(SMOKE_PAGES.slice(0, 2)).toEqual(["/", "/work"]);
  });
});

describe("smoke — a whole run", () => {
  it("passes when every page answers, and sends the session cookie with each page", async () => {
    const site = fakeSite({ "/api/health": health, "/api/auth/login": login(), "/": html("ok"), "/work": html("ok") });
    const r = await runSmoke({ base: "http://localhost:3140", email: "a@b.test", password: "pw-pw-pw-pw", pages: ["/", "/work"], fetchImpl: site.fetchImpl });
    expect(r.ok).toBe(true);
    expect(site.seen.filter((s) => s.url === "/" || s.url === "/work").every((s) => s.cookie === "mb_session=abc")).toBe(true);
  });

  it("fails on a 5xx page and still checks the rest", async () => {
    const site = fakeSite({ "/api/health": health, "/api/auth/login": login(), "/": html("boom", 500), "/work": html("ok") });
    const r = await runSmoke({ base: "http://localhost:3140", email: "a@b.test", password: "pw-pw-pw-pw", pages: ["/", "/work"], fetchImpl: site.fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.results.find((x) => x.path === "/")?.problem).toMatch(/500/);
    expect(r.results.find((x) => x.path === "/work")?.problem).toBeNull();
  });

  it("fails on a page that renders the crash text with a 200", async () => {
    const site = fakeSite({ "/api/health": health, "/api/auth/login": login(), "/": html("Application error: a server-side exception has occurred") });
    const r = await runSmoke({ base: "http://localhost:3140", email: "a@b.test", password: "pw-pw-pw-pw", pages: ["/"], fetchImpl: site.fetchImpl });
    expect(r.ok).toBe(false);
  });

  it("fails when a page bounces the signed-in owner back to the sign-in door", async () => {
    const site = fakeSite({
      "/api/health": health,
      "/api/auth/login": login(),
      "/": () => new Response(null, { status: 307, headers: { location: "/login?next=%2F" } }),
    });
    const r = await runSmoke({ base: "http://localhost:3140", email: "a@b.test", password: "pw-pw-pw-pw", pages: ["/"], fetchImpl: site.fetchImpl });
    expect(r.results.find((x) => x.path === "/")?.problem).toMatch(/sign-in/);
  });

  it("follows a redirect inside the site and judges where it lands", async () => {
    const site = fakeSite({
      "/api/health": health,
      "/api/auth/login": login(),
      "/work": () => new Response(null, { status: 307, headers: { location: "/work/today" } }),
      "/work/today": html("ok"),
    });
    const r = await runSmoke({ base: "http://localhost:3140", email: "a@b.test", password: "pw-pw-pw-pw", pages: ["/work"], fetchImpl: site.fetchImpl });
    expect(r.ok).toBe(true);
  });

  it("refuses a redirect to another site and a redirect loop", async () => {
    const site = fakeSite({
      "/api/health": health,
      "/api/auth/login": login(),
      "/a": () => new Response(null, { status: 307, headers: { location: "https://elsewhere.test/" } }),
      "/b": () => new Response(null, { status: 307, headers: { location: "/b" } }),
    });
    const r = await runSmoke({ base: "http://localhost:3140", email: "a@b.test", password: "pw-pw-pw-pw", pages: ["/a", "/b"], fetchImpl: site.fetchImpl });
    expect(r.results.find((x) => x.path === "/a")?.problem).toMatch(/another site/);
    expect(r.results.find((x) => x.path === "/b")?.problem).toMatch(/too many/);
  });

  it("stops before the pages when the sign-in fails (wrong password or no cookie)", async () => {
    const bad = fakeSite({ "/api/health": health, "/api/auth/login": () => new Response('{"error":"x"}', { status: 401 }), "/": html("ok") });
    const r1 = await runSmoke({ base: "http://localhost:3140", email: "a@b.test", password: "pw-pw-pw-pw", pages: ["/"], fetchImpl: bad.fetchImpl });
    expect(r1.ok).toBe(false);
    expect(bad.seen.some((s) => s.url === "/")).toBe(false);
    const noCookie = fakeSite({ "/api/health": health, "/api/auth/login": html('{"ok":true}'), "/": html("ok") });
    const r2 = await runSmoke({ base: "http://localhost:3140", email: "a@b.test", password: "pw-pw-pw-pw", pages: ["/"], fetchImpl: noCookie.fetchImpl });
    expect(r2.results.find((x) => x.path === "sign-in")?.problem).toMatch(/cookie/);
  });

  it("fails when the site does not answer at all", async () => {
    const r = await runSmoke({
      base: "http://localhost:3140",
      email: "a@b.test",
      password: "pw-pw-pw-pw",
      pages: ["/"],
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(r.ok).toBe(false);
  });

  it("never logs the password or the cookie", async () => {
    const lines: string[] = [];
    const site = fakeSite({ "/api/health": health, "/api/auth/login": login("mb_session=SECRETCOOKIE; Path=/"), "/": html("ok") });
    await runSmoke({ base: "http://localhost:3140", email: "a@b.test", password: "SECRETPASSWORD", pages: ["/"], fetchImpl: site.fetchImpl, log: (l) => lines.push(l) });
    expect(lines.join("\n")).not.toMatch(/SECRET/);
  });
});
