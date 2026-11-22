/**
 * WHAT A TOKEN MAY CALL (docs/rebuild/05-permissions.md §5). The old `mcp` scope stays and means every tool (a working token never breaks); the new
 * scopes are finer, so an agent gets only the doors it needs: Muse takes `mcp:read` + `mcp:ask` + `mcp:tasks` and so cannot push ad numbers.
 * Pure: the MCP route filters its tool list by this, and the team screen prints the same table.
 */
export const MCP_SCOPES = ["mcp:read", "mcp:push", "mcp:run", "mcp:ask", "mcp:tasks", "mcp:handoff", "mcp:videos"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export const SCOPE_AR: Record<McpScope | "mcp" | "handoff", string> = {
  mcp: "كل الأدوات",
  "mcp:read": "يقرا القواعد والمهام والطلبات",
  "mcp:push": "يدفع الأرقام والمخزون والفيديوهات والمهام المجدولة",
  "mcp:run": "يسجّل تشغيلات",
  "mcp:ask": "يطلب موافقة ويبعت إشعار ويسجّل أمر",
  "mcp:tasks": "ينشئ ويحدّث مهام",
  "mcp:handoff": "يمسك الطلبات الواقفة ويكمّلها",
  "mcp:videos": "يمسك طلبات الفيديو ويسلّمها",
  handoff: "طابور الطلبات الواقفة بس",
};

/** Which scope opens each tool. Every tool of src/server/mcp/tools.ts is here (tests/token-scopes.test.ts holds it). */
export const TOOL_SCOPE: Readonly<Record<string, McpScope>> = {
  get_rules: "mcp:read",
  get_mode: "mcp:read",
  get_approvals: "mcp:read",
  get_handoffs: "mcp:read",
  get_video_requests: "mcp:read",
  list_tasks: "mcp:read",
  push_metrics: "mcp:push",
  push_stock: "mcp:push",
  push_videos: "mcp:push",
  push_jobs: "mcp:push",
  log_run: "mcp:run",
  request_approval: "mcp:ask",
  ack_approval: "mcp:ask",
  notify: "mcp:ask",
  record_order: "mcp:ask",
  end_order: "mcp:ask",
  create_task: "mcp:tasks",
  update_task: "mcp:tasks",
  claim_handoff: "mcp:handoff",
  complete_handoff: "mcp:handoff",
  create_handoff: "mcp:handoff",
  claim_video_request: "mcp:videos",
  complete_video_request: "mcp:videos",
};

/** Is this a token for the MCP door at all (the old `mcp` or any of the finer ones)? */
export const isMcpToken = (scopes: readonly string[]): boolean => scopes.includes("mcp") || scopes.some((s) => (MCP_SCOPES as readonly string[]).includes(s));

/** May this token call this tool? `mcp` = all; otherwise the tool's own scope must be in the list. An unknown tool is never allowed to a scoped token. */
export function toolAllowed(scopes: readonly string[], tool: string): boolean {
  if (scopes.includes("mcp")) return true;
  const need = TOOL_SCOPE[tool];
  return !!need && scopes.includes(need);
}

/** The scopes of a token as the owner chose them: only known ones, no duplicates; empty or `mcp` alone = the old full token. */
export function normalizeScopes(input: unknown): string[] {
  const list = Array.isArray(input) ? input.filter((s): s is string => typeof s === "string") : [];
  const known = [...new Set(list.filter((s) => (MCP_SCOPES as readonly string[]).includes(s)))];
  return known.length ? known : ["mcp"];
}

/** The names of the tools a token holds, for the team screen. */
export const toolsOf = (scopes: readonly string[], tools: readonly string[] = Object.keys(TOOL_SCOPE)): string[] => tools.filter((t) => toolAllowed(scopes, t));
