/**
 * /mcp — the MCP server Claude connects to (v4 · A). Streamable HTTP, stateless, JSON only (src/core/mcp-rpc.ts).
 *
 * Who may call: a token the owner made in «الإعدادات ← الربط ← Claude»: `Authorization: Bearer mbm_…`, shown once,
 * stored as a sha256. No cookie is ever read here, so a web page cannot make the owner's browser call it. The call is
 * rate-limited per token, every tool call is in the audit log, and no tool can spend, delete or approve (src/server/mcp).
 */
import { NextResponse } from "next/server";
import { handleRpc } from "@/core/mcp-rpc";
import { makeLimiter, originAllowed } from "@/core/rate-limit";
import { toolAllowed, TOOL_SCOPE } from "@/core/token-scopes";
import { ContractError, requireToken } from "@/server/api-token";
import { audit } from "@/server/audit";
import { appOrigin } from "@/server/env";
import { SERVER_INSTRUCTIONS, TOOLS, type McpCtx } from "@/server/mcp/tools";

export const dynamic = "force-dynamic";

const limit = makeLimiter(120, 60_000);
const MAX_BODY = 2_000_000;
const NO_STORE = { "Cache-Control": "no-store" };

const rpcError = (status: number, code: number, message: string, headers: Record<string, string> = {}) => NextResponse.json({ jsonrpc: "2.0", id: null, error: { code, message } }, { status, headers: { ...NO_STORE, ...headers } });

export async function POST(req: Request) {
  if (!originAllowed(req.headers.get("origin"), appOrigin())) return rpcError(403, -32000, "origin مش مسموح");

  let token;
  try {
    token = await requireToken(req, "mcp");
  } catch (e) {
    if (e instanceof ContractError) return rpcError(e.status, -32001, e.message, e.status === 401 ? { "WWW-Authenticate": 'Bearer realm="zaki-mediabuyer"' } : {});
    console.error("mcp auth failed:", e instanceof Error ? e.message : e);
    return rpcError(500, -32603, "صار خطأ عند الميديا باير");
  }

  const rl = limit(token.id);
  if (!rl.ok) return rpcError(429, -32002, `كتير نداءات — جرّب بعد ${rl.retryAfterS} ثانية`, { "Retry-After": String(rl.retryAfterS) });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return rpcError(413, -32600, "الطلب كبير — قسّمه دفعات أصغر");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return rpcError(400, -32700, "JSON مش صحيح");
  }

  // a token with finer scopes sees only its tools; asking for another one is answered in words, so the agent knows which scope it lacks
  const one0 = Array.isArray(body) ? null : (body as { id?: unknown; method?: string; params?: { name?: string } });
  if (one0?.method === "tools/call" && typeof one0.params?.name === "string" && TOOLS.some((t) => t.name === one0.params!.name) && !toolAllowed(token.scopes, one0.params.name)) {
    const need = TOOL_SCOPE[one0.params.name] ?? "mcp";
    return NextResponse.json({ jsonrpc: "2.0", id: one0.id ?? null, result: { content: [{ type: "text", text: `هالتوكن ما إله صلاحية لهالأداة (بدها ${need}). المالك بيعطيه إياها من الإعدادات ← الفريق.` }], isError: true } }, { status: 200, headers: NO_STORE });
  }
  const visible = TOOLS.filter((t) => toolAllowed(token.scopes, t.name));
  const ctx: McpCtx = { tokenId: token.id, tokenName: token.name, actor: { type: "agent", id: `mcp:${token.name}`.slice(0, 60) } };
  const reply = await handleRpc(body, visible, ctx, { name: "zaki-mediabuyer", version: process.env.APP_VERSION ?? "dev", instructions: SERVER_INSTRUCTIONS });

  // every tool call is in the audit log (name and token — never the arguments: the tools audit what they changed)
  const one = Array.isArray(body) ? null : (body as { method?: string; params?: { name?: string } });
  if (one?.method === "tools/call") {
    const isError = (reply.body as { result?: { isError?: boolean } } | undefined)?.result?.isError ?? !!(reply.body as { error?: unknown } | undefined)?.error;
    await audit(ctx.actor, "mcp.call", { type: "tool", id: String(one.params?.name ?? "?").slice(0, 60) }, { after: { token: token.id, error: isError } }).catch(() => undefined);
  }

  if (reply.status === 202) return new Response(null, { status: 202, headers: NO_STORE });
  return NextResponse.json(reply.body, { status: 200, headers: NO_STORE });
}

/** No server-initiated stream: a client that asks for one is told so (405), as the transport allows. */
export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

/** No sessions to end. */
export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
