/**
 * Search and pending decisions follow the caller's role (v6 · P5, S-18). The search box reads names only, and a name leaves the server only for a role that could open the screen it leads
 * to; the requests the open app polls (`/api/approvals/pending`) are the same areas as the inbox of the role (`inboxFor`'s rule), not everything.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const table = (rows: unknown[]) => ({ findMany: vi.fn(async (_a?: unknown) => rows) });
  return {
    db: {
      productEconomics: table([{ productCode: "TRF01", name: "ماء الكمأة" }]),
      workflow: table([
        { key: "ads-night", name: "جولة الليل للحملات", description: null, domain: "ads" },
        { key: "ops-confirm", name: "متابعة التأكيد", description: null, domain: "ops" },
      ]),
      task: table([{ id: "t1", title: "متابعة التأكيد مع الفريق", status: "new", board: "x" }]),
      videoBankItem: table([{ id: "v1", job: "TRF", vName: "V1", productCode: "TRF01", status: "ready" }]),
      ad: table([{ metaId: "a1", name: "TRF01_V1_hook", status: "ACTIVE" }]),
      campaign: table([{ metaId: "c1", name: "TRF01 تأكيد", status: "ACTIVE", productCode: "TRF01" }]),
      productAlias: table([{ productCode: "TRF01", alias: "كمأة" }]),
    },
    caller: { id: "u1", role: "OWNER", demo: false } as { id: string; role: string; demo: boolean },
    approvals: [] as unknown[],
  };
});
vi.mock("@/server/db", () => ({ db: h.db }));
vi.mock("@/server/auth", () => ({
  requireCapability: async () => h.caller,
  requireSignedIn: async () => h.caller,
  errorResponse: (e: unknown) => new Response(JSON.stringify({ error: String(e) }), { status: 500 }),
}));
vi.mock("@/server/directory", () => ({ taskKeysFor: async () => null }));
vi.mock("@/server/approvals", () => ({ listApprovals: async () => h.approvals }));
vi.mock("@/server/mode", () => ({ currentMode: async () => ({ mode: "awake" }) }));

import { approvalsFor, type ApprovalIn } from "@/core/inbox";
import type { RoleKey } from "@/core/roles";
import { searchScopeOf } from "@/core/search";
import { GET as pending } from "@/app/api/approvals/pending/route";
import { searchData } from "@/server/search";

describe("searchScopeOf — a role finds a name only on a screen it may open", () => {
  it("the owner and the manager find everything; a job or a test (no role) too", () => {
    for (const r of [null, "OWNER", "MANAGER"] as const) expect(searchScopeOf(r), String(r)).toEqual({ products: true, ads: true, campaigns: true, videos: true, tasks: true, workflows: { ads: true, ops: true } });
  });

  it("the ads manager: the ads and their products and videos, the ads jobs and the people's tasks — no operations job", () => {
    expect(searchScopeOf("ADS_MANAGER")).toEqual({ products: true, ads: true, campaigns: true, videos: true, tasks: true, workflows: { ads: true, ops: false } });
  });

  it("the operations manager and a team lead: the operations jobs and the people's tasks — no ads, no campaign, no video, no product", () => {
    for (const r of ["OPS_MANAGER", "TEAM_LEAD"] as const) expect(searchScopeOf(r), r).toEqual({ products: false, ads: false, campaigns: false, videos: false, tasks: true, workflows: { ads: false, ops: true } });
  });

  it("a member finds the people's tasks (their own: `taskKeysFor`) and nothing else", () => {
    expect(searchScopeOf("MEMBER")).toEqual({ products: false, ads: false, campaigns: false, videos: false, tasks: true, workflows: { ads: false, ops: false } });
  });

  it("a viewer has no work place and no task: the ads side only", () => {
    expect(searchScopeOf("VIEWER")).toEqual({ products: true, ads: true, campaigns: true, videos: true, tasks: false, workflows: { ads: false, ops: false } });
  });
});

describe("searchData — what is read, by role", () => {
  beforeEach(() => {
    for (const t of Object.values(h.db)) t.findMany.mockClear();
  });
  const ids = (hits: { kind: string; id: string }[]) => hits.map((x) => `${x.kind}:${x.id}`).sort();

  it("the owner reads every kind", async () => {
    const hits = await searchData("تأكيد", { role: "OWNER", taskKeys: null });
    expect(ids(hits)).toEqual(["campaign:c1", "task:t1", "workflow:ops-confirm"]);
    for (const t of Object.values(h.db)) expect(t.findMany).toHaveBeenCalled();
  });

  it("an operations manager never reads the ads tables, and finds only the jobs of the operations", async () => {
    const hits = await searchData("تأكيد", { role: "OPS_MANAGER", taskKeys: null });
    expect(ids(hits)).toEqual(["task:t1", "workflow:ops-confirm"]);
    for (const name of ["productEconomics", "productAlias", "videoBankItem", "ad", "campaign"] as const) expect(h.db[name].findMany, name).not.toHaveBeenCalled();
    // and the ads job is not in the answer even for a word it has
    expect(ids(await searchData("جولة", { role: "OPS_MANAGER", taskKeys: null }))).toEqual([]);
  });

  it("a member reads only the tasks of their own scope — the query itself is narrowed to their keys", async () => {
    await searchData("تأكيد", { role: "MEMBER", taskKeys: ["member-a"] });
    expect(h.db.task.findMany).toHaveBeenCalledTimes(1);
    expect(h.db.task.findMany.mock.calls[0]![0]).toMatchObject({ where: { archivedAt: null, assignee: { in: ["member-a"] } } });
    for (const name of ["productEconomics", "productAlias", "workflow", "videoBankItem", "ad", "campaign"] as const) expect(h.db[name].findMany, name).not.toHaveBeenCalled();
  });

  it("a person with no scope (a person not in the directory) reads no task at all — not «everybody's»", async () => {
    expect(await searchData("تأكيد", { role: "MEMBER", taskKeys: [] })).toEqual([]);
    expect(h.db.task.findMany).not.toHaveBeenCalled();
  });

  it("a viewer finds the ads side and no task", async () => {
    const hits = await searchData("TRF01", { role: "VIEWER", taskKeys: null });
    expect(ids(hits)).toEqual(["ad:a1", "campaign:c1", "product:TRF01", "video:v1"]);
    expect(h.db.task.findMany).not.toHaveBeenCalled();
    expect(h.db.workflow.findMany).not.toHaveBeenCalled();
  });
});

describe("searchData — a product is found and shown by its Arabic name (v6 · P6, U-08)", () => {
  it("a product the OMS wrote in Latin letters is shown by its Arabic alias, found by it, and opens the new product page", async () => {
    h.db.productEconomics.findMany.mockResolvedValueOnce([{ productCode: "ALBETCHU", name: "ALBETCHU" }]);
    h.db.productAlias.findMany.mockResolvedValueOnce([{ productCode: "ALBETCHU", alias: "حرير" }]);
    const hits = await searchData("حرير", { role: "VIEWER", taskKeys: null });
    expect(hits.find((x) => x.kind === "product")).toMatchObject({ id: "ALBETCHU", title: "حرير", href: "/numbers/products/ALBETCHU" });
  });
});

describe("pending decisions — the same areas as the inbox of the role", () => {
  const ask = (id: string, over: Partial<ApprovalIn> = {}): ApprovalIn => ({ id, title: id, why: "x", numbers: [], options: [], amount: null, urgency: "orange", kind: null, source: "mcp", workflowKey: null, expiresAt: null, postponedUntil: null, createdAt: "2026-11-22T10:00:00.000Z", analysis: null, ...over });
  // an ads request (no job), a request of a job (the «work» area) and a stock one (the operations)
  const all = [ask("ads-1"), ask("job-1", { workflowKey: "night" }), ask("stock-1", { kind: "stock" })];

  it("approvalsFor keeps the areas the role's inbox holds", () => {
    const keep = (role: RoleKey) => approvalsFor(all, role).map((a) => a.id);
    expect(keep("OWNER")).toEqual(["ads-1", "job-1", "stock-1"]);
    expect(keep("ADS_MANAGER")).toEqual(["ads-1", "job-1"]);
    expect(keep("OPS_MANAGER")).toEqual(["job-1", "stock-1"]);
    expect(keep("ANALYST")).toEqual([]); // no inbox at all
    expect(keep("VIEWER")).toEqual([]);
  });

  it("the endpoint hands the caller only those — a request of another area never leaves the server", async () => {
    h.approvals = all;
    h.caller = { id: "u2", role: "ADS_MANAGER", demo: false };
    const body = (await (await pending()).json()) as { approvals: { id: string }[]; mode: string };
    expect(body.approvals.map((a) => a.id)).toEqual(["ads-1", "job-1"]);
    expect(body.mode).toBe("awake");
    h.caller = { id: "u1", role: "OWNER", demo: false };
    expect(((await (await pending()).json()) as { approvals: unknown[] }).approvals).toHaveLength(3);
  });
});
