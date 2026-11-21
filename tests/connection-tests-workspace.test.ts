import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/audit", () => ({ audit: async () => undefined }));

import { testRow } from "@/server/connection-tests";

const answer = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

describe("«اختبر الربط» — Workspace counts the door's boards", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.WORKSPACE_BASE_URL = "https://workspace.example";
    process.env.WORKSPACE_API_TOKEN = "wsk_test_only";
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("reads the door's `{ data: [...] }` envelope (the one the sync reads)", async () => {
    const r = await testRow("workspace", "u1", answer({ data: [{ id: "b1" }, { id: "b2" }, { id: "b3" }] }));
    expect(r).toEqual({ ok: true, message: "تمام — Workspace ردّ: 3 لوح. قراءة بس" });
  });

  it("still counts a bare array or `{ boards }`", async () => {
    expect((await testRow("workspace", "u1", answer([{ id: "b1" }]))).message).toContain("1 لوح");
    expect((await testRow("workspace", "u1", answer({ boards: [{ id: "b1" }, { id: "b2" }] }))).message).toContain("2 لوح");
  });
});
