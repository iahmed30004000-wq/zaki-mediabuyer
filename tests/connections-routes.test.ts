import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The connections routes through their real handlers: a person who is not the owner gets 403 on read AND write, and no service behind them is touched; nobody signed in gets 401.
 * (The database is faked at the user lookup only; the services are spies so «not touched» can be proven.)
 */
const state = vi.hoisted(() => ({ role: "OWNER" as string | null, calls: [] as string[] }));

vi.mock("next/headers", () => ({ cookies: () => ({ get: () => (state.role ? { value: "session" } : undefined) }) }));
vi.mock("@/lib/session-token", async (orig) => ({ ...(await orig<typeof import("@/lib/session-token")>()), authRequired: () => true, readSession: async (v?: string) => (v ? { sub: "u1", ver: 1 } : null) }));
vi.mock("@/server/db", () => ({ db: { user: { findUnique: async () => (state.role ? { id: "u1", role: state.role, active: true, sessionVer: 1 } : null) } } }));
vi.mock("@/server/connections", () => ({
  connectionsView: async () => (state.calls.push("view"), { masterKey: true, rows: [] }),
  saveField: async () => (state.calls.push("save"), { last4: "1234" }),
  clearField: async () => void state.calls.push("clear"),
}));
vi.mock("@/server/connection-tests", () => ({ testRow: async () => (state.calls.push("test"), { ok: true, message: "تمام" }) }));
vi.mock("@/server/oauth-client", () => ({
  beginLink: async () => (state.calls.push("begin"), { url: "https://oms.example/oauth/authorize?x=1" }),
  unlink: async () => void state.calls.push("unlink"),
  completeLink: async () => (state.calls.push("complete"), { key: "oms" }),
}));
vi.mock("@/server/env", () => ({ appOrigin: () => "http://localhost:3140" }));

import { GET as list } from "@/app/api/connections/route";
import { PUT as put, DELETE as del } from "@/app/api/connections/field/[name]/route";
import { POST as test } from "@/app/api/connections/row/[key]/test/route";
import { POST as link, DELETE as unlinkRoute } from "@/app/api/connections/row/[key]/link/route";
import { GET as callback } from "@/app/oauth/callback/route";

const json = (body: unknown) => new Request("http://localhost/x", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const NAME = { params: { name: "META_SYSTEM_USER_TOKEN" } };
const KEY = { params: { key: "oms" } };

const attempts = (): [string, () => Promise<Response>][] => [
  ["GET /api/connections", () => list()],
  ["PUT field", () => put(json({ value: "EAAB-example-1234567890" }), NAME)],
  ["DELETE field", () => del(new Request("http://localhost/x", { method: "DELETE" }), NAME)],
  ["POST test", () => test(new Request("http://localhost/x", { method: "POST" }), KEY)],
  ["POST link", () => link(new Request("http://localhost/x", { method: "POST" }), KEY)],
  ["DELETE link", () => unlinkRoute(new Request("http://localhost/x", { method: "DELETE" }), KEY)],
];

beforeEach(() => {
  state.calls.length = 0;
  state.role = "OWNER";
});

describe("the owner", () => {
  it("reads, writes, deletes, tests and links", async () => {
    for (const [name, run] of attempts()) expect((await run()).status, name).toBe(200);
    expect(state.calls).toEqual(["view", "save", "clear", "test", "begin", "unlink"]);
  });
  it("the answer to a save is «saved» and the last four — the value is not in it", async () => {
    const r = await put(json({ value: "EAAB-example-1234567890" }), NAME);
    const text = await r.text();
    expect(text).not.toContain("EAAB-example");
    expect(JSON.parse(text)).toEqual({ ok: true, last4: "1234" });
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});

describe("everybody else gets 403 on read and on write, and nothing behind the door runs", () => {
  for (const role of ["MANAGER", "ADS_MANAGER", "OPS_MANAGER", "TEAM_LEAD", "MEMBER", "ANALYST", "VIEWER"]) {
    it(role, async () => {
      state.role = role;
      for (const [name, run] of attempts()) expect((await run()).status, `${role} ${name}`).toBe(403);
      expect(state.calls).toEqual([]);
    });
  }
  it("signed out: 401 on all of them", async () => {
    state.role = null;
    for (const [name, run] of attempts()) expect((await run()).status, name).toBe(401);
    expect(state.calls).toEqual([]);
  });
});

describe("/oauth/callback", () => {
  const cb = (q: string) => callback(new Request(`http://localhost:3140/oauth/callback?${q}`));
  it("sends the owner back to the page with a word, never the code", async () => {
    const r = await cb("code=SECRETCODE&state=abc");
    expect(r.status).toBe(303);
    const to = r.headers.get("location")!;
    expect(to).toBe("http://localhost:3140/settings/connections?linked=oms");
    expect(to).not.toContain("SECRETCODE");
  });
  it("a refusal on the other side, or a missing code, completes nothing", async () => {
    expect((await cb("error=access_denied&state=abc")).headers.get("location")).toContain("link_error=denied");
    expect((await cb("state=abc")).headers.get("location")).toContain("link_error=missing");
    expect(state.calls).toEqual([]);
  });
  it("a non-owner completes nothing; signed out is sent to the login", async () => {
    state.role = "MANAGER";
    expect((await cb("code=c&state=s")).headers.get("location")).toContain("link_error=");
    state.role = null;
    expect((await cb("code=c&state=s")).headers.get("location")).toContain("/login");
    expect(state.calls).toEqual([]);
  });
});
