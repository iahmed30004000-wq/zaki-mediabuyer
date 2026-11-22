/**
 * POST /api/assistant/draft-job (v6 · P4-2): «اكتبها بجملة» through the real handler. Who may ask (the owner and the manager — they make jobs — who may use the assistant), what it says when no key is
 * linked (a plain setup sentence, 503, the model never called — the other two ways of making a job keep working), what it answers (the draft and its sentence, or the model's own question), and
 * how a refusal comes out. Nothing is saved by it; the model half is tests/draft-job-tool.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "OWNER" as string | null,
  configured: true,
  draft: vi.fn(),
  db: null as unknown as ReturnType<typeof import("./helpers/fake-db").makeFakeDb> & { user: unknown },
}));

vi.mock("next/headers", () => ({ cookies: () => ({ get: () => (state.role ? { value: "session" } : undefined) }) }));
vi.mock("@/lib/session-token", async (orig) => ({ ...(await orig<typeof import("@/lib/session-token")>()), authRequired: () => true, readSession: async (v?: string) => (v ? { sub: "u1", ver: 1 } : null) }));
vi.mock("@/server/db", async () => {
  const { makeFakeDb } = await import("./helpers/fake-db");
  const db = makeFakeDb() as ReturnType<typeof makeFakeDb> & { user: unknown };
  db.user = { findUnique: async () => (state.role ? { id: "u1", role: state.role, active: true, sessionVer: 1 } : null) };
  state.db = db;
  return { db };
});
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));
vi.mock("@/server/assistant/config", async (orig) => ({ ...(await orig<typeof import("@/server/assistant/config")>()), assistantConfigured: async () => state.configured }));
vi.mock("@/server/assistant/draft-job", () => ({ draftJobFromSentence: (...a: unknown[]) => state.draft(...a) }));

import { POST } from "@/app/api/assistant/draft-job/route";
import { DRAFT_NEEDS_KEY, OFF_BY_PRIVACY } from "@/server/assistant/config";
import { BUSY } from "@/server/assistant";
import { AssistantError } from "@/server/assistant/loop";
import { PrivacyRefusal } from "@/gateway/privacy";

const post = (body: unknown) => POST(new Request("http://localhost/api/assistant/draft-job", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));
const DRAFT = { name: "فحص المخزون", domain: "ops", assigneeKey: "claude", when: { kind: "daily", time: "09:30" }, steps: [{ verb: "read", text: "اقرا المخزون" }], notifyOn: ["stuck", "missed", "failed"] };

beforeEach(() => {
  state.role = "OWNER";
  state.configured = true;
  state.draft.mockReset();
  delete process.env.PRIVACY_MODE;
  delete process.env.MOCK_MODE;
});

describe("who may ask", () => {
  it("the owner and the manager", async () => {
    state.draft.mockResolvedValue({ draft: DRAFT, sentence: "Claude · كل يوم 09:30 · خطوة وحدة · بخبّرك لما توقف أو تفوت", say: "جهّزتها", model: "m", costUsd: 0.01 });
    for (const role of ["OWNER", "MANAGER"]) {
      state.role = role;
      expect((await post({ sentence: "كل يوم 9:30 اقرا المخزون" })).status, role).toBe(200);
    }
  });

  it("everybody else: 403 — and the model is never reached; nobody signed in: 401", async () => {
    for (const role of ["ADS_MANAGER", "OPS_MANAGER", "ANALYST", "TEAM_LEAD", "MEMBER", "VIEWER"]) {
      state.role = role;
      expect((await post({ sentence: "كل يوم 9:30 اقرا المخزون" })).status, role).toBe(403);
    }
    state.role = null;
    expect((await post({ sentence: "كل يوم 9:30 اقرا المخزون" })).status).toBe(401);
    expect(state.draft).not.toHaveBeenCalled();
  });
});

describe("what it answers", () => {
  it("the draft and its sentence (the screen shows «هيك فهمتها — صح؟») — and the sentence it was given, as the owner wrote it", async () => {
    state.draft.mockResolvedValue({ draft: DRAFT, sentence: "Claude · كل يوم 09:30 · خطوة وحدة · بخبّرك لما توقف أو تفوت", say: "جهّزتها — راجعها", model: "m", costUsd: 0.01 });
    const r = await post({ sentence: "  كل يوم 9:30 اقرا المخزون  " });
    expect(await r.json()).toEqual({ ok: true, draft: DRAFT, sentence: "Claude · كل يوم 09:30 · خطوة وحدة · بخبّرك لما توقف أو تفوت", say: "جهّزتها — راجعها" });
    expect(state.draft.mock.calls[0]![0]).toBe("كل يوم 9:30 اقرا المخزون");
    expect(state.draft.mock.calls[0]![1]).toMatchObject({ role: "OWNER" });
  });

  it("when the model asks instead (something was missing): no draft, and its question", async () => {
    state.draft.mockResolvedValue({ draft: null, sentence: null, say: "مين بدّه ينفّذها؟", model: "m", costUsd: 0.01 });
    expect(await (await post({ sentence: "ذكّرني بشي" })).json()).toEqual({ ok: true, draft: null, sentence: null, say: "مين بدّه ينفّذها؟" });
  });

  it("a body that is not a sentence: 400 and nothing asked", async () => {
    for (const b of [null, "not json", {}, { sentence: "" }, { sentence: "ab" }, { sentence: "x".repeat(1001) }, { sentence: "كل يوم", extra: 1 }]) expect((await post(b)).status, JSON.stringify(b)).toBe(400);
    expect(state.draft).not.toHaveBeenCalled();
  });
});

describe("no assistant connected", () => {
  it("says so plainly — «هاي بدها مفتاح المساعد — اربطه من الإعدادات ← الربط» — with `setup: true`, 503, and the model is never reached", async () => {
    state.configured = false;
    const r = await post({ sentence: "كل يوم 9:30 اقرا المخزون" });
    expect(r.status).toBe(503);
    const body = await r.json();
    expect(body).toEqual({ ok: false, setup: true, error: DRAFT_NEEDS_KEY });
    expect(body.error).toContain("هاي بدها مفتاح المساعد");
    expect(body.error).toContain("الإعدادات ← الربط");
    expect(body.error).toContain("«ركّبها» و«من قالب»");
    expect(body.error).toContain("بلا مفتاح");
    expect(state.draft).not.toHaveBeenCalled();
  });

  it("the internal-only mode keeps the external model off: 403 with its own sentence, not the setup one", async () => {
    process.env.PRIVACY_MODE = "internal_only";
    const r = await post({ sentence: "كل يوم 9:30 اقرا المخزون" });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ ok: false, setup: false, error: OFF_BY_PRIVACY });
    expect(state.draft).not.toHaveBeenCalled();
  });

  it("the demo site has no assistant: answers `demo`, saves nothing", async () => {
    process.env.MOCK_MODE = "1";
    const body = await (await post({ sentence: "كل يوم 9:30 اقرا المخزون" })).json();
    expect(body).toMatchObject({ ok: true, demo: true, draft: null });
    expect(state.draft).not.toHaveBeenCalled();
  });
});

describe("how a refusal comes out", () => {
  it("a customer's number in the sentence: 422, the sentence of the filter, never echoed", async () => {
    state.draft.mockRejectedValue(new PrivacyRefusal(["phone"]));
    const r = await post({ sentence: "ذكّر 0791234567" });
    expect(r.status).toBe(422);
    const body = await r.json();
    expect(body).toMatchObject({ ok: false, code: "privacy" });
    expect(body.error).toContain("رقم هاتف");
    expect(JSON.stringify(body)).not.toContain("0791234567");
  });

  it("a second question while the first is being answered: 429 with its sentence; a key the account refused: its own", async () => {
    state.draft.mockRejectedValueOnce(new AssistantError(429, BUSY, "busy"));
    const busy = await post({ sentence: "كل يوم 9:30 اقرا المخزون" });
    expect(busy.status).toBe(429);
    expect(await busy.json()).toMatchObject({ ok: false, setup: false, error: BUSY, code: "busy" });
    state.draft.mockRejectedValueOnce(new AssistantError(502, "مفتاح Claude مش مقبول", "auth"));
    const auth = await post({ sentence: "كل يوم 9:30 اقرا المخزون" });
    expect(auth.status).toBe(502);
    expect((await auth.json()).error).toContain("مفتاح Claude");
  });
});
