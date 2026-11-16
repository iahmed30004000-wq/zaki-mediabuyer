import { describe, expect, it } from "vitest";
import { CAPABILITY_COUNT, agentMatrix, roleMatrix, type AgentIn } from "@/core/permissions";
import { ROLES, can } from "@/core/roles";
import { MCP_SCOPES, SCOPE_AR, TOOL_SCOPE, isMcpToken, normalizeScopes, toolAllowed, toolsOf } from "@/core/token-scopes";
import { TOOLS } from "@/server/mcp/tools";

describe("the people's side of «who can do what»", () => {
  const sections = roleMatrix();
  const rows = sections.flatMap((s) => s.rows);
  const row = (k: string) => rows.find((r) => r.key === k)!;

  it("three groups, and a cell for each of the eight roles on every row", () => {
    expect(sections.map((s) => s.title)).toEqual(["الإعلانات", "التشغيل والفريق", "الشغل والنظام"]);
    for (const r of rows) expect(Object.keys(r.cells).sort(), r.key).toEqual([...ROLES].sort());
    expect(CAPABILITY_COUNT).toBe(18);
  });

  it("every cell is the table of roles, not a copy: ✓ exactly where `can` says so", () => {
    expect(row("money.view").cells.OPS_MANAGER.state).toBe("no");
    expect(row("money.view").cells.ANALYST.state).toBe("self");
    expect(row("ops.people").cells.TEAM_LEAD.state).toBe("self");
    expect(row("ops.people").cells.ANALYST.state).toBe("no");
    for (const r of ROLES) expect(row("ads.pause").cells[r].state === "self").toBe(can(r, "ads.pause"));
  });

  it("the rows with a hard limit are locked, and an ads manager reaches the owner's approval through a proposal, not through the box", () => {
    for (const k of ["spend_over_cap", "new_campaign", "rules", "order_relax", "team"]) expect(row(k).locked, k).toBe(true);
    expect(row("spend_over_cap").cells.OWNER.state).toBe("self");
    expect(row("spend_over_cap").cells.ADS_MANAGER.state).toBe("approval");
    expect(row("spend_over_cap").cells.VIEWER.state).toBe("no");
    expect(row("team").cells.MANAGER.state).toBe("no");
  });
});

describe("the agents' side", () => {
  const agent = (key: string, ...scopes: string[][]): AgentIn => ({ key, name: key, tokenScopes: scopes });
  const cell = (secs: ReturnType<typeof agentMatrix>, row: string, who: string) => secs.flatMap((s) => s.rows).find((r) => r.key === row)!.cells[who]!;

  it("the doors come from the tokens: a full `mcp` token opens all seven, a fine one only its own, no token none", () => {
    const m = agentMatrix([agent("full", ["mcp"]), agent("muse", ["mcp:read", "mcp:ask", "mcp:tasks"]), agent("bare")], []);
    for (const d of ["door.read", "door.push", "door.run", "door.ask", "door.tasks", "door.handoff", "door.videos"]) expect(cell(m, d, "full").state, d).toBe("self");
    expect(["door.read", "door.ask", "door.tasks"].map((d) => cell(m, d, "muse").state)).toEqual(["self", "self", "self"]);
    expect(["door.push", "door.run", "door.handoff", "door.videos"].map((d) => cell(m, d, "muse").state)).toEqual(["no", "no", "no", "no"]);
    expect(cell(m, "door.read", "bare").state).toBe("no");
    expect(cell(m, "door.read", "bare").note).toContain("ما معه توكن");
  });

  it("on Meta the account's level decides, and the cell says it is an instruction (the site cannot hold a Meta token back)", () => {
    const a = [agent("claude", ["mcp"])];
    const lvl = (n: number) => agentMatrix(a, [{ name: "حساب", level: n }]);
    expect(cell(lvl(0), "meta.pause", "claude").state).toBe("approval");
    expect(cell(lvl(1), "meta.pause", "claude").state).toBe("self");
    expect(cell(lvl(1), "meta.pause", "claude").basis).toBe("instruction");
    expect([0, 1, 2, 3].map((n) => cell(lvl(n), "meta.scale", "claude").state)).toEqual(["no", "approval", "self", "self"]);
    // with several accounts the highest level speaks, and the note names it
    const two = agentMatrix(a, [{ name: "أ", level: 1 }, { name: "ب", level: 2 }]);
    expect(cell(two, "meta.scale", "claude").state).toBe("self");
    expect(cell(two, "meta.scale", "claude").note).toContain("ب");
  });

  it("the limits that never move are the same for every agent and every level", () => {
    for (const n of [0, 1, 2, 3]) {
      const m = agentMatrix([agent("claude", ["mcp"])], [{ name: "x", level: n }]);
      expect(cell(m, "meta.over", "claude")).toMatchObject({ state: "approval", basis: "locked" });
      expect(cell(m, "meta.order_relax", "claude")).toMatchObject({ state: "approval", basis: "locked" });
      expect(cell(m, "meta.never", "claude")).toMatchObject({ state: "no", basis: "locked" });
      expect(cell(m, "meta.message", "claude").state).toBe("approval");
    }
  });
});

describe("token scopes (§5)", () => {
  const names = TOOLS.map((t) => t.name);

  it("every tool the MCP server has is in the scope table, and no stale name is left in it", () => {
    expect(Object.keys(TOOL_SCOPE).sort()).toEqual([...names].sort());
    expect(names).toHaveLength(22);
    for (const s of Object.values(TOOL_SCOPE)) expect(MCP_SCOPES).toContain(s);
  });
  it("the old `mcp` is everything; a finer token is only its own tools", () => {
    for (const n of names) expect(toolAllowed(["mcp"], n), n).toBe(true);
    expect(toolAllowed(["mcp:read"], "get_rules")).toBe(true);
    expect(toolAllowed(["mcp:read"], "push_metrics")).toBe(false);
    expect(toolAllowed(["mcp:read", "mcp:ask", "mcp:tasks"], "push_metrics")).toBe(false);
    expect(toolAllowed(["mcp:push"], "push_metrics")).toBe(true);
    expect(toolAllowed(["mcp:push"], "no_such_tool")).toBe(false);
    expect(toolAllowed(["handoff"], "claim_handoff")).toBe(false); // the handoff queue token has its own REST door, not the MCP tools
  });
  it("which tokens are MCP tokens, and what a form may ask for", () => {
    expect(isMcpToken(["mcp"])).toBe(true);
    expect(isMcpToken(["mcp:push"])).toBe(true);
    expect(isMcpToken(["handoff"])).toBe(false);
    expect(isMcpToken(["vp:read"])).toBe(false);
    expect(normalizeScopes(["mcp:push", "mcp:push", "evil", "vp:launch"])).toEqual(["mcp:push"]);
    expect(normalizeScopes([])).toEqual(["mcp"]);
    expect(normalizeScopes(undefined)).toEqual(["mcp"]);
  });
  it("each scope has a plain Arabic line, and a token lists the tools it holds", () => {
    for (const s of [...MCP_SCOPES, "mcp", "handoff"] as const) expect(SCOPE_AR[s].length).toBeGreaterThan(3);
    expect(toolsOf(["mcp:run"], names)).toEqual(["log_run"]);
    expect(toolsOf(["mcp"], names)).toHaveLength(22);
  });
});
