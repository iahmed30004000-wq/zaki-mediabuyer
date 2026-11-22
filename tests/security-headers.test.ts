/**
 * The headers on every answer, the image optimizer switched off, and a sign-out that ends the session.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
type Header = { key: string; value: string };
type Config = { headers: () => Promise<{ source: string; headers: Header[] }[]>; images: unknown };

/** next.config.mjs has no types (allowJs is off), so it is loaded by address, as tests/nav.test.ts does. */
const load = async () => (await import(new URL("../next.config.mjs", import.meta.url).href)) as { default: Config; SECURITY_HEADERS: Header[] };

describe("next.config", () => {
  it("sends the headers on every path", async () => {
    const { default: config, SECURITY_HEADERS } = await load();
    const rules = await config.headers();
    expect(rules).toHaveLength(1);
    expect(rules[0]!.source).toBe("/:path*");
    const h = Object.fromEntries(rules[0]!.headers.map((x) => [x.key, x.value]));
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=\d{7,}/);
    expect(h["Referrer-Policy"]).toBeTruthy();
    expect(SECURITY_HEADERS.length).toBe(5);
  });

  it("the image optimizer is off (the code never uses next/image)", async () => {
    expect((await load()).default.images).toEqual({ unoptimized: true });
  });
});

const s = vi.hoisted(() => ({ caller: null as { id: string; demo: boolean } | null, updates: [] as unknown[], ended: 0 }));
vi.mock("@/server/auth", () => ({ currentCaller: async () => s.caller, endSession: () => void s.ended++ }));
vi.mock("@/server/db", () => ({ db: { user: { update: async (q: unknown) => void s.updates.push(q) } } }));

import { POST as logout } from "@/app/api/auth/logout/route";

beforeEach(() => {
  s.caller = null;
  s.updates.length = 0;
  s.ended = 0;
});

describe("sign-out", () => {
  it("moves the session version and clears what the browser kept", async () => {
    s.caller = { id: "u1", demo: false };
    const res = await logout();
    expect(s.updates).toEqual([{ where: { id: "u1" }, data: { sessionVer: { increment: 1 } } }]);
    expect(s.ended).toBe(1);
    expect(res.headers.get("clear-site-data")).toBe('"cache", "storage"');
  });

  it("with nobody signed in it still answers and clears", async () => {
    const res = await logout();
    expect(res.status).toBe(200);
    expect(s.updates).toEqual([]);
    expect(res.headers.get("clear-site-data")).toContain("storage");
  });

  it("the local demo owner has no row to move", async () => {
    s.caller = { id: "demo-owner", demo: true };
    await logout();
    expect(s.updates).toEqual([]);
  });
});
