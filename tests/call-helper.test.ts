import { describe, expect, it } from "vitest";
import { OFFLINE_SENTENCE, callJson, safeFetch } from "@/lib/call";

/** U-13 — a button's call never throws when the network drops: it answers with an Arabic sentence. */
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const down: typeof fetch = async () => {
  throw new TypeError("Failed to fetch");
};

describe("safeFetch", () => {
  it("passes a normal answer through untouched", async () => {
    const r = await safeFetch("/x", { method: "POST" }, async () => json(200, { ok: true }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it("a dropped network is a 503 whose body carries the sentence — it does not throw", async () => {
    const r = await safeFetch("/x", { method: "POST" }, down);
    expect(r.status).toBe(503);
    expect(r.headers.get("x-offline")).toBe("1");
    expect(await r.json()).toEqual({ ok: false, error: OFFLINE_SENTENCE });
  });

  it("a request the caller aborted on purpose is left to the caller", async () => {
    const aborted: typeof fetch = async () => {
      throw new DOMException("aborted", "AbortError");
    };
    await expect(safeFetch("/x", {}, aborted)).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("callJson", () => {
  it("reads the JSON and says ok", async () => {
    const r = await callJson<{ n: number }>("/x", { method: "POST", body: { a: 1 } }, async (_u, init) => {
      expect(init?.headers).toMatchObject({ "content-type": "application/json" });
      expect(init?.body).toBe('{"a":1}');
      return json(200, { n: 3 });
    });
    expect(r).toMatchObject({ ok: true, status: 200, data: { n: 3 }, error: null, offline: false });
  });

  it("the site's own sentence is the error", async () => {
    const r = await callJson("/x", {}, async () => json(409, { error: "هالتغيير انتقل لحالة تانية" }));
    expect(r).toMatchObject({ ok: false, status: 409, error: "هالتغيير انتقل لحالة تانية", offline: false });
  });

  it("an error with no sentence still says something", async () => {
    const r = await callJson("/x", {}, async () => new Response("boom", { status: 500 }));
    expect(r.error).toBe("صار خطأ (500)");
  });

  it("offline: the sentence, and offline is true", async () => {
    const r = await callJson("/x", { method: "POST", body: { a: 1 } }, down);
    expect(r).toMatchObject({ ok: false, status: 503, error: OFFLINE_SENTENCE, offline: true, data: { ok: false } });
  });
});
