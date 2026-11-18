import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_BODY_BYTES, parseStopEvent, stopTarget } from "@/core/oms-event";
import { signBody } from "@/core/step-exec";

/**
 * The OMS's signed «اوقف» event (contracts/oms-mediabuyer.v1.json → oms.stop-event), through the real route handler.
 * What stands behind the door (the search and the change set) is a spy, so «nothing ran» can be proven for every call that is not the OMS's.
 */
const calls = vi.hoisted(() => [] as { query: string; who: string; ref: string }[]);
vi.mock("@/server/stop-by-query", () => ({
  stopByQuery: async (query: string, who: { id: string }, ref: string) => (calls.push({ query, who: who.id, ref }), `✓ وقف: ${query}`),
}));

import { POST } from "@/app/api/inbound/oms/route";

const SECRET = "test-signing-secret-not-real-0123456789";
const BODY = { event: "owner.stop_requested", at: "2026-11-18T10:05:00+03:00", data: { query: "CR00147", source_chat: "owner" } };
const nowS = () => String(Math.floor(Date.now() / 1000));

function call(body: unknown | string, o: { secret?: string | null; ts?: string; sig?: string | null; headers?: Record<string, string> } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const ts = o.ts ?? nowS();
  const headers: Record<string, string> = { "content-type": "application/json", "x-zaki-timestamp": ts, ...o.headers };
  const sig = o.sig === undefined ? signBody(o.secret ?? SECRET, ts, raw) : o.sig;
  if (sig !== null) headers["x-zaki-signature"] = sig;
  return POST(new Request("http://localhost/api/inbound/oms", { method: "POST", headers, body: raw }));
}

beforeEach(() => {
  calls.length = 0;
  process.env.OMS_EVENT_SECRET = SECRET;
});

describe("the event's shape", () => {
  it("accepts the contract's example", () => {
    expect(parseStopEvent(JSON.stringify(BODY))).toEqual({ ok: true, event: { query: "CR00147", sourceChat: "owner" } });
  });
  it("source_chat is optional and means the owner", () => {
    expect(parseStopEvent(JSON.stringify({ ...BODY, data: { query: "CR00147" } }))).toEqual({ ok: true, event: { query: "CR00147", sourceChat: "owner" } });
    expect(parseStopEvent(JSON.stringify({ ...BODY, data: { query: "x", source_chat: "allowed" } }))).toMatchObject({ ok: true, event: { sourceChat: "allowed" } });
  });
  it("refuses an unknown event, an extra field anywhere, an empty or long query, a bad time, a bad chat kind, and not-JSON", () => {
    const bad = [
      { ...BODY, event: "owner.resume_requested" },
      { ...BODY, extra: 1 },
      { ...BODY, data: { ...BODY.data, extra: 1 } },
      { ...BODY, data: { query: "" } },
      { ...BODY, data: { query: "x".repeat(201) } },
      { ...BODY, at: "yesterday" },
      { ...BODY, data: { query: "x", source_chat: "stranger" } },
      { event: BODY.event, at: BODY.at },
      [],
      null,
    ];
    for (const b of bad) expect(parseStopEvent(JSON.stringify(b)), JSON.stringify(b)).toEqual({ ok: false });
    expect(parseStopEvent("{not json")).toEqual({ ok: false });
    expect(parseStopEvent("")).toEqual({ ok: false });
  });
});

describe("what the words mean here — this door only lowers spend", () => {
  it("the thing to stop, or the whole sentence with its verb", () => {
    expect(stopTarget("CR00147")).toEqual({ kind: "pause", query: "CR00147" });
    expect(stopTarget("اوقف CR00147")).toEqual({ kind: "pause", query: "CR00147" });
    expect(stopTarget("  ماء  الكمأة ")).toEqual({ kind: "pause", query: "ماء الكمأة" });
    expect(stopTarget("CR٠٠١٤٧")).toEqual({ kind: "pause", query: "CR00147" });
  });
  it("anything that spends, resumes, creates or approves is the site's", () => {
    expect(stopTarget("زيد الميزانية 20%")).toEqual({ kind: "site_only", what: "زيادة الصرف" });
    expect(stopTarget("شغّل CR00147")).toEqual({ kind: "site_only", what: "التشغيل" });
    expect(stopTarget("وافق cs-101")).toEqual({ kind: "site_only", what: "الموافقة" });
    expect(stopTarget("أنشئ حملة")).toEqual({ kind: "site_only", what: "الإنشاء" });
  });
});

describe("a signed event from the OMS", () => {
  it("is accepted, runs the stop once with the words only, and answers with the reply (≤ 500 characters, no store)", async () => {
    const r = await call(BODY);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ ok: true, reply: "✓ وقف: CR00147" });
    expect(calls).toEqual([{ query: "CR00147", who: "oms:owner", ref: "oms:owner" }]);
  });
  it("an event from an allowed chat is written as «allowed», not as the owner", async () => {
    await call({ ...BODY, data: { query: "CR00147", source_chat: "allowed" } });
    expect(calls[0]).toMatchObject({ who: "oms:allowed", ref: "oms:allowed" });
  });
  it("a sentence that asks to spend is answered with the site and nothing is stopped or changed", async () => {
    const r = await call({ ...BODY, data: { query: "زيد الميزانية 20%" } });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { ok: boolean; reply: string };
    expect(j.ok).toBe(true);
    expect(j.reply).toContain("من الموقع بس");
    expect(calls).toEqual([]);
  });
});

describe("everything that is not the OMS's gets 401 and nothing runs", () => {
  const code = async (r: Response) => ((await r.json()) as { code: string }).code;
  it("no secret set here: every call is refused, even a well-signed one", async () => {
    delete process.env.OMS_EVENT_SECRET;
    const r = await call(BODY);
    expect(r.status).toBe(401);
    expect(await code(r)).toBe("SIGNATURE_INVALID");
    expect(calls).toEqual([]);
  });
  it("an empty secret is not a secret (a signature made with «» is refused)", async () => {
    process.env.OMS_EVENT_SECRET = "";
    expect((await call(BODY, { secret: "" })).status).toBe(401);
    expect(calls).toEqual([]);
  });
  it("a signature made with another secret", async () => {
    expect((await call(BODY, { secret: "another-secret-0123456789abcdefghijkl" })).status).toBe(401);
    expect(calls).toEqual([]);
  });
  it("a body changed after signing (the query swapped)", async () => {
    const ts = nowS();
    const sig = signBody(SECRET, ts, JSON.stringify(BODY));
    const r = await call({ ...BODY, data: { query: "CR99999" } }, { ts, sig });
    expect(r.status).toBe(401);
    expect(calls).toEqual([]);
  });
  it("a signature with no timestamp binding (the timestamp changed after signing)", async () => {
    const sig = signBody(SECRET, nowS(), JSON.stringify(BODY));
    expect((await call(BODY, { ts: String(Number(nowS()) + 1), sig })).status).toBe(401);
    expect(calls).toEqual([]);
  });
  it("a call older than five minutes (replay) and one from the future", async () => {
    expect((await call(BODY, { ts: String(Number(nowS()) - 301) })).status).toBe(401);
    expect((await call(BODY, { ts: String(Number(nowS()) + 301) })).status).toBe(401);
    expect(calls).toEqual([]);
  });
  it("a call a minute old is fine (clocks differ a little)", async () => {
    expect((await call(BODY, { ts: String(Number(nowS()) - 60) })).status).toBe(200);
  });
  it("missing or malformed headers", async () => {
    expect((await call(BODY, { sig: null })).status).toBe(401);
    expect((await call(BODY, { ts: "" })).status).toBe(401);
    expect((await call(BODY, { ts: "not-a-number" })).status).toBe(401);
    expect((await call(BODY, { sig: "sha256=" })).status).toBe(401);
    expect((await call(BODY, { sig: signBody(SECRET, nowS(), JSON.stringify(BODY)).replace("sha256=", "") })).status).toBe(401);
    expect(calls).toEqual([]);
  });
  it("a Bearer token or a session is not a signature", async () => {
    const r = await POST(new Request("http://localhost/api/inbound/oms", { method: "POST", headers: { authorization: "Bearer anything", cookie: "mb_session=anything" }, body: JSON.stringify(BODY) }));
    expect(r.status).toBe(401);
    expect(calls).toEqual([]);
  });
  it("the refusal never says why (no secret, no expected signature)", async () => {
    const text = await (await call(BODY, { sig: "sha256=00" })).text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toMatch(/sha256=[0-9a-f]{20,}/);
  });
});

describe("a signed call that is not a stop event", () => {
  it("an unknown event or an extra field is 400, nothing runs", async () => {
    for (const b of [{ ...BODY, event: "owner.resume_requested" }, { ...BODY, extra: true }, { ...BODY, data: { query: "x", customer_phone: "000" } }, "{oops"]) {
      const r = await call(b);
      expect(r.status).toBe(400);
      expect(((await r.json()) as { code: string }).code).toBe("VALIDATION_FAILED");
    }
    expect(calls).toEqual([]);
  });
  it("a body over the limit is 400 even when it is signed", async () => {
    const r = await call({ ...BODY, data: { query: "x", pad: "y".repeat(MAX_BODY_BYTES) } });
    expect(r.status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe("rate limit — 30 a minute, counted only for signed calls", () => {
  it("unsigned calls do not use the budget; the 31st signed call in a minute is 429 with Retry-After", async () => {
    for (let i = 0; i < 100; i++) expect((await call(BODY, { sig: "sha256=00" })).status).toBe(401);
    let ok = 0;
    let limited: Response | null = null;
    for (let i = 0; i < 40 && !limited; i++) {
      const r = await call(BODY);
      if (r.status === 200) ok++;
      else limited = r;
    }
    // earlier tests in this file used some of the 30
    expect(ok).toBeGreaterThan(0);
    expect(ok).toBeLessThanOrEqual(30);
    expect(limited?.status).toBe(429);
    expect(((await limited!.json()) as { code: string }).code).toBe("RATE_LIMITED");
    expect(Number(limited!.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
