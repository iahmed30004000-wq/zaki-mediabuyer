/**
 * The sign-in limiter, the dummy hash, and the owner address in production.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { DUMMY_PASSWORD_HASH, loginLimiter } from "@/core/auth-guards";

describe("loginLimiter", () => {
  const T0 = 1_000_000;
  it("counts failures per address + e-mail and blocks after ten", () => {
    const l = loginLimiter();
    for (let i = 0; i < 9; i++) l.fail("1.1.1.1", "a@x.com", T0 + i);
    expect(l.blocked("1.1.1.1", "a@x.com", T0 + 10)).toBe(false);
    l.fail("1.1.1.1", "a@x.com", T0 + 11);
    expect(l.blocked("1.1.1.1", "a@x.com", T0 + 12)).toBe(true);
  });

  it("failures from one address do not count against another address", () => {
    const l = loginLimiter();
    for (let i = 0; i < 50; i++) l.fail("6.6.6.6", "owner@x.com", T0 + i);
    expect(l.blocked("6.6.6.6", "owner@x.com", T0 + 100)).toBe(true);
    expect(l.blocked("2.2.2.2", "owner@x.com", T0 + 100)).toBe(false);
  });

  it("many e-mails from one address are stopped by the per-address limit", () => {
    const l = loginLimiter();
    for (let i = 0; i < 30; i++) l.fail("6.6.6.6", `u${i}@x.com`, T0 + i);
    expect(l.blocked("6.6.6.6", "fresh@x.com", T0 + 40)).toBe(true);
    expect(l.blocked("7.7.7.7", "fresh@x.com", T0 + 40)).toBe(false);
  });

  it("successes are not counted, and a success clears the pair", () => {
    const l = loginLimiter();
    for (let i = 0; i < 20; i++) l.success("1.1.1.1", "a@x.com");
    expect(l.blocked("1.1.1.1", "a@x.com", T0)).toBe(false);
    for (let i = 0; i < 5; i++) l.fail("1.1.1.1", "a@x.com", T0 + i);
    l.success("1.1.1.1", "a@x.com");
    for (let i = 0; i < 5; i++) l.fail("1.1.1.1", "a@x.com", T0 + 10 + i);
    expect(l.blocked("1.1.1.1", "a@x.com", T0 + 20)).toBe(false);
  });

  it("the block ends after the window, and old entries are dropped", () => {
    const l = loginLimiter({ windowMs: 1000 });
    for (let i = 0; i < 10; i++) l.fail("1.1.1.1", "a@x.com", T0);
    expect(l.blocked("1.1.1.1", "a@x.com", T0 + 500)).toBe(true);
    expect(l.blocked("1.1.1.1", "a@x.com", T0 + 1500)).toBe(false);
    for (let i = 0; i < 600; i++) l.fail("3.3.3.3", `x${i}@x.com`, T0 + 2000);
    l.fail("4.4.4.4", "late@x.com", T0 + 10_000); // sweeps what expired
    expect(l.size()).toBeLessThan(10);
  });
});

describe("the dummy hash", () => {
  it("is a real bcrypt hash of 60 characters (so comparing against it costs the same as a real one)", async () => {
    expect(DUMMY_PASSWORD_HASH).toHaveLength(60);
    expect(DUMMY_PASSWORD_HASH).toMatch(/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/);
    expect(await bcrypt.compare("any password", DUMMY_PASSWORD_HASH)).toBe(false);
  });
});

const dbState = vi.hoisted(() => ({ users: 0, created: [] as unknown[] }));
vi.mock("@/server/db", () => ({
  db: {
    user: {
      count: async () => dbState.users,
      create: async ({ data }: { data: unknown }) => (dbState.created.push(data), { id: "u1", role: "OWNER", sessionVer: 1 }),
      findUnique: async () => null,
    },
  },
}));
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));
vi.mock("@/server/team", () => ({ hashInvite: (s: string) => s }));
vi.mock("@/server/auth", () => ({
  HttpError: class extends Error {
    constructor(public status: number, m: string) {
      super(m);
    }
  },
  errorResponse: (e: { status?: number; message: string }) => new Response(JSON.stringify({ error: e.message }), { status: e.status ?? 500 }),
  startSession: async () => undefined,
  verifyPassword: async () => null,
}));

import { POST } from "@/app/api/auth/login/route";

const login = (email: string, ip = "9.9.9.9") => POST(new Request("http://x/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ email, password: "correct-horse-1" }) }));

describe("the first sign-in on an empty system", () => {
  beforeEach(() => {
    dbState.users = 0;
    dbState.created.length = 0;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("in production with OWNER_EMAIL unset, no account is created", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OWNER_EMAIL", "");
    const res = await login("visitor@example.com");
    expect(res.status).toBe(403);
    expect(dbState.created).toHaveLength(0);
  });

  it("in production only the named address becomes the owner", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OWNER_EMAIL", "Owner@Example.com");
    expect((await login("visitor@example.com")).status).toBe(403);
    expect(dbState.created).toHaveLength(0);
    expect((await login("owner@example.com")).status).toBe(200);
    expect(dbState.created).toHaveLength(1);
  });

  it("on a development machine the old behaviour stays (the owner makes their own account)", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OWNER_EMAIL", "");
    expect((await login("me@example.com")).status).toBe(200);
  });
});

describe("the route's limiter", () => {
  beforeEach(() => {
    dbState.users = 3; // a system with accounts: every wrong password is a 401
  });
  it("eleven wrong passwords from one address for one e-mail: the eleventh try is refused with 429, another address still gets the plain 401", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await login("victim@example.com", "5.5.5.5")).status);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
    expect((await login("victim@example.com", "8.8.8.8")).status).toBe(401);
  });
});
