import { describe, expect, it } from "vitest";
import { GraphSchema, type WfGraph } from "@/core/workflow";
import { isPrivateIp, overdueNodes, planWorkflow, replyNote, resolveTarget, retryDelays, signBody, siteConfigFrom, siteRun, stepBody, stepMessage, timeoutMs, verifySignature } from "@/core/step-exec";

const cfg = siteConfigFrom({
  N8N_BASE_URL: "https://n8n.example.com/",
  N8N_WEBHOOK_SECRET: "test-secret-value",
  N8N_ALLOWED_PATHS: "daily-ops, Stock-Alert",
  STEP_HTTP_ALLOW: "api.example.com,*.partner.example",
  TELEGRAM_BOT_TOKEN: "x",
  TELEGRAM_OWNER_CHAT_ID: "1",
});

describe("the owner's lists", () => {
  it("reads the environment; an http n8n address or one with a password is not a base", () => {
    expect(cfg).toMatchObject({ n8nBase: "https://n8n.example.com", n8nPaths: ["daily-ops", "stock-alert"], httpHosts: ["api.example.com", "*.partner.example"], telegram: true });
    expect(siteConfigFrom({ N8N_BASE_URL: "http://n8n.example.com" }).n8nBase).toBeNull();
    expect(siteConfigFrom({ N8N_BASE_URL: "https://u:p@n8n.example.com" }).n8nBase).toBeNull();
    expect(siteConfigFrom({})).toMatchObject({ n8nBase: null, n8nSecret: null, n8nPaths: [], httpHosts: [], telegram: false });
  });
});

describe("addresses", () => {
  it("knows what is not the public internet", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "ff02::1", "not-an-ip"]) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "100.63.0.1", "2606:4700::1111", "::ffff:8.8.8.8"]) expect(isPrivateIp(ip), ip).toBe(false);
  });
});

describe("where a step may go", () => {
  const n = (executor: string, target?: string) => ({ executor: executor as never, target });
  it("n8n: only a listed webhook, under the owner's own base", () => {
    expect(resolveTarget(n("n8n", "daily-ops"), cfg)).toMatchObject({ ok: true, url: "https://n8n.example.com/webhook/daily-ops" });
    expect(resolveTarget(n("n8n", "Stock-Alert"), cfg)).toMatchObject({ ok: true, url: "https://n8n.example.com/webhook/Stock-Alert" });
    expect(resolveTarget(n("n8n", "other"), cfg)).toMatchObject({ ok: false });
    expect(resolveTarget(n("n8n", "../rest/workflows"), cfg)).toMatchObject({ ok: false });
    expect(resolveTarget(n("n8n"), cfg)).toMatchObject({ ok: false });
    expect(resolveTarget(n("n8n", "daily-ops"), siteConfigFrom({ N8N_ALLOWED_PATHS: "daily-ops" }))).toMatchObject({ ok: false });
  });
  it("http: https, a listed host, port 443, nothing hidden in the address", () => {
    expect(resolveTarget(n("http", "https://api.example.com/hook?x=1"), cfg)).toMatchObject({ ok: true, host: "api.example.com" });
    expect(resolveTarget(n("http", "https://a.partner.example/p"), cfg)).toMatchObject({ ok: true });
    for (const bad of ["http://api.example.com/x", "https://evil.example.org/x", "https://api.example.com:8443/x", "https://user:pw@api.example.com/x", "https://127.0.0.1/x", "https://[::1]/x", "https://169.254.169.254/latest", "https://localhost/x", "https://partner.example/x", "ftp://api.example.com", "api.example.com", "https://api.example.com.evil.org/x"]) expect(resolveTarget(n("http", bad), cfg), bad).toMatchObject({ ok: false });
  });
  it("telegram needs the bot; any other doer is not the site's", () => {
    expect(resolveTarget(n("telegram"), cfg)).toMatchObject({ ok: true });
    expect(resolveTarget(n("telegram"), siteConfigFrom({}))).toMatchObject({ ok: false });
    expect(resolveTarget(n("claude_mcp"), cfg)).toMatchObject({ ok: false });
  });
});

describe("signing", () => {
  const body = '{"a":1}';
  it("signs timestamp.body and verifies it", () => {
    const sig = signBody("s3cret", "1700000000", body);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifySignature("s3cret", "1700000000", body, sig, 1700000100_000)).toBe(true);
  });
  it("refuses a changed body, a wrong secret, an old or garbled timestamp, a wrong length", () => {
    const sig = signBody("s3cret", "1700000000", body);
    expect(verifySignature("s3cret", "1700000000", '{"a":2}', sig, 1700000100_000)).toBe(false);
    expect(verifySignature("other", "1700000000", body, sig, 1700000100_000)).toBe(false);
    expect(verifySignature("s3cret", "1700000000", body, sig, 1700001000_000)).toBe(false);
    expect(verifySignature("s3cret", "abc", body, sig, 1700000100_000)).toBe(false);
    expect(verifySignature("s3cret", "1700000000", body, "sha256=00", 1700000100_000)).toBe(false);
  });
});

describe("what leaves", () => {
  const ctx = (extra: Record<string, string> = {}) => ({ workflow: "daily-check", runRef: "site-1", node: { id: "read", label: "قراءة الأرقام", prompt: "اقرا أرقام الطنين", inputs: "المنتج", ...extra } });
  it("a body of words only", () => {
    const r = stepBody(ctx(), "2026-11-15T10:00:00.000Z");
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(r.body)).toMatchObject({ workflow: "daily-check", run_ref: "site-1", node: { id: "read" }, text: "اقرا أرقام الطنين" });
  });
  it("refuses a phone number, an e-mail, a key, and a body that is too long", () => {
    expect(stepBody(ctx({ prompt: "كلّم 0791234567" }), "t")).toMatchObject({ ok: false });
    expect(stepBody(ctx({ inputs: "a@b.com" }), "t")).toMatchObject({ ok: false });
    expect(stepBody(ctx({ prompt: "x".repeat(4100) }), "t")).toMatchObject({ ok: false });
    expect(stepMessage("اسم", ctx({ prompt: "0791234567" }))).toMatchObject({ ok: false });
  });
  it("the Telegram text names the workflow and the step; the reply note keeps only what is clean", () => {
    expect(stepMessage("الفحص اليومي", ctx())).toEqual({ ok: true, text: "الفحص اليومي — قراءة الأرقام\nاقرا أرقام الطنين" });
    expect(replyNote(200, '{"ok": true}')).toBe('ردّ 200: {"ok": true}');
    expect(replyNote(200, "اتصل 0791234567")).toBe("ردّ 200");
    expect(replyNote(502, "")).toBe("ردّ 502");
  });
});

describe("the walk", () => {
  const g = (nodes: Record<string, unknown>[], edges: [string, string][]): WfGraph => GraphSchema.parse({ nodes, edges: edges.map(([from, to]) => ({ from, to })) });
  const trigger = { id: "t", type: "trigger", label: "بداية" };
  const step = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: "step", label: `خطوة ${id}`, executor: "n8n", permission: "green", target: "daily-ops", ...extra });

  it("runs the green, listed steps in order and stops at the first one it must hand over", () => {
    const graph = g([trigger, step("a"), step("b", { executor: "telegram", target: undefined }), step("c", { permission: "yellow" }), step("d")], [["t", "a"], ["a", "b"], ["b", "c"], ["c", "d"]]);
    const plan = planWorkflow(graph, cfg);
    expect(plan.map((p) => `${p.node.id}:${p.mode}`)).toEqual(["a:site", "b:site", "c:handoff", "d:site"]);
    expect(siteRun(plan).map((p) => p.node.id)).toEqual(["a", "b"]);
    expect(plan[2]!.reason).toContain("الصلاحية");
  });
  it("conditions, gates, waits, Claude's steps and unlisted targets are handed over, each with its reason", () => {
    const graph = g(
      [trigger, { id: "c1", type: "condition", label: "شرط" }, { id: "g1", type: "approval", label: "موافقة", permission: "red" }, { id: "w1", type: "wait", label: "انتظار" }, step("x", { executor: "claude_mcp" }), step("y", { target: "nope" }), step("z", { disabled: true })],
      [["t", "c1"], ["c1", "g1"], ["g1", "w1"], ["w1", "x"], ["x", "y"], ["y", "z"]],
    );
    const plan = planWorkflow(graph, cfg);
    expect(plan.map((p) => p.mode)).toEqual(["handoff", "handoff", "handoff", "handoff", "handoff"]);
    expect(plan.map((p) => p.node.id)).toEqual(["c1", "g1", "w1", "x", "y"]); // the disabled one is not in the walk
    expect(plan[4]!.reason).toContain("مش بقائمتك");
    expect(siteRun(plan)).toEqual([]);
  });
  it("a workflow with nothing in it for the site has an empty run", () => {
    expect(siteRun(planWorkflow(g([trigger, step("a", { executor: "person" })], [["t", "a"]]), cfg))).toEqual([]);
  });
});

describe("tries and time", () => {
  it("1, 2, 4 seconds, at most three", () => {
    expect(retryDelays(undefined)).toEqual([]);
    expect(retryDelays(2)).toEqual([1000, 2000]);
    expect(retryDelays(10)).toEqual([1000, 2000, 4000]);
    expect(timeoutMs({})).toBe(30_000);
    expect(timeoutMs({ timeoutS: 5 })).toBe(5000);
    expect(timeoutMs({ timeoutS: 99_999 })).toBe(120_000);
  });
  it("a running step past its own timeout is overdue; one with no timeout never is", () => {
    const graph = GraphSchema.parse({ nodes: [{ id: "a", type: "step", label: "أ", timeoutS: 60 }, { id: "b", type: "step", label: "ب" }, { id: "c", type: "step", label: "ج", timeoutS: 60 }], edges: [] });
    const now = Date.parse("2026-11-15T10:10:00Z");
    const od = overdueNodes(graph, { a: { status: "running", at: "2026-11-15T10:05:00Z" }, b: { status: "running", at: "2026-11-15T09:00:00Z" }, c: { status: "done", at: "2026-11-15T09:00:00Z" } }, now);
    expect(od.map((o) => o.node.id)).toEqual(["a"]);
    expect(od[0]!.overBySec).toBe(240);
    expect(overdueNodes(graph, { a: { status: "running", at: "2026-11-15T10:09:30Z" } }, now)).toEqual([]);
    expect(overdueNodes(graph, { a: { status: "running", at: "garbage" } }, now)).toEqual([]);
  });
});
