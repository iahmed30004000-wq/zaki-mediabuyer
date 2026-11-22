/**
 * /api/health: a visitor sees only { ok, version, worker: { ok } }; «ok» needs the database AND a worker heartbeat newer than 3 minutes;
 * the status code stays 200 while the database answers (the container check and the CI start-up check read it).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKER_STALE_SEC, publicHealth, tickTime, workerState } from "@/core/health";

let tickValue: unknown = null;
let dbUp = true;
let caller: { id: string; role: string; demo: boolean } | null = null;

vi.mock("@/server/db", () => ({
  db: {
    $queryRaw: async () => {
      if (!dbUp) throw new Error("down");
      return [{ "?column?": 1 }];
    },
    setting: { findUnique: async () => (tickValue === null ? null : { value: tickValue }) },
  },
}));
vi.mock("@/server/auth", () => ({ currentCaller: async () => caller }));
const FACTS = { now: "2026-11-22T12:00:00.000Z", metaLinked: false, spendYesterday: false, omsLinked: true, omsLastPullAt: "2026-11-22T03:00:00.000Z", productsWithoutBreakeven: 2, unmappedFolders: 0, productsWithoutName: 0, stockFresh: false };
let facts: typeof FACTS | null = FACTS;
vi.mock("@/lib/source-facts", () => ({
  loadSourceFacts: async () => {
    if (!facts) throw new Error("tables down");
    return facts;
  },
}));
vi.mock("@/server/assistant/config", () => ({ assistantConfigured: async () => false, externalModelsOff: () => false }));

import { GET } from "@/app/api/health/route";

beforeEach(() => {
  tickValue = null;
  dbUp = true;
  caller = null;
});

describe("heartbeat rules (pure)", () => {
  const now = new Date("2026-11-21T12:00:00Z");
  it("fresh = ok, older than 3 minutes = not ok, never = not ok", () => {
    expect(workerState(new Date(now.getTime() - 60_000), now).ok).toBe(true);
    expect(workerState(new Date(now.getTime() - (WORKER_STALE_SEC + 5) * 1000), now).ok).toBe(false);
    expect(workerState(null, now)).toEqual({ ok: false, at: null, ageSec: null });
  });
  it("reads the stored value defensively", () => {
    expect(tickTime({ at: "2026-11-21T12:00:00Z" })?.toISOString()).toBe("2026-11-21T12:00:00.000Z");
    expect(tickTime({ at: 5 })).toBeNull();
    expect(tickTime("nope")).toBeNull();
    expect(tickTime(null)).toBeNull();
  });
  it("the visitor's body has exactly three keys", () => {
    expect(Object.keys(publicHealth({ database: true, version: "abc", worker: { ok: true, at: "x", ageSec: 3 } })).sort()).toEqual(["ok", "version", "worker"]);
  });
});

describe("GET /api/health", () => {
  it("a visitor: no links, no detail, and ok only with a fresh worker", async () => {
    tickValue = { at: new Date().toISOString() };
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, version: expect.any(String), worker: { ok: true } });
    expect(body.links).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/links|mock|encryption|database/);
  });

  it("a stale or missing heartbeat: ok false, but the code stays 200 so the site still starts", async () => {
    tickValue = { at: new Date(Date.now() - 10 * 60_000).toISOString() };
    const stale = await GET();
    expect(stale.status).toBe(200);
    expect((await stale.json()).ok).toBe(false);
    tickValue = null;
    const never = await GET();
    expect(never.status).toBe(200);
    expect((await never.json()).worker).toEqual({ ok: false });
  });

  it("the database down: 503", async () => {
    dbUp = false;
    expect((await GET()).status).toBe(503);
  });

  it("the owner also gets the facts the numbers stand on (v6 · P6); a visitor and a member never do; when they cannot be read the answer still comes, with null", async () => {
    tickValue = { at: new Date().toISOString() };
    caller = { id: "u1", role: "OWNER", demo: false };
    expect((await (await GET()).json()).numbers).toEqual(FACTS);
    facts = null;
    const down = await GET();
    expect(down.status).toBe(200);
    expect((await down.json()).numbers).toBeNull();
    facts = FACTS;
    caller = { id: "u2", role: "MEMBER", demo: false };
    expect((await (await GET()).json()).numbers).toBeUndefined();
    caller = null;
    expect((await (await GET()).json()).numbers).toBeUndefined();
  });

  it("a signed-in owner gets the links; a signed-in member does not", async () => {
    tickValue = { at: new Date().toISOString() };
    caller = { id: "u1", role: "OWNER", demo: false };
    const owner = await (await GET()).json();
    expect(owner.links).toBeDefined();
    expect(owner.worker).toMatchObject({ ok: true });
    caller = { id: "u2", role: "MEMBER", demo: false };
    expect((await (await GET()).json()).links).toBeUndefined();
  });
});
