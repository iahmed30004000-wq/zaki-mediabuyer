/**
 * THE MCP PROTOCOL, the part that needs no web server (v4 · A). Streamable HTTP, stateless: every POST is one JSON-RPC
 * message (or a batch), answered with one JSON body — or 202 with no body for a notification. No sessions, no SSE: the
 * tools are quick, and a stateless server survives a restart of the app.
 *
 *   initialize · notifications/* · ping · tools/list · tools/call   (+ empty resources/prompts lists, so a probing client is happy)
 *
 * A tool that fails because of what it was given answers with `isError: true` and says why in words — so the model can
 * fix the call itself. Only a malformed message, an unknown method or an unknown tool is a JSON-RPC error.
 */
import type { ZodTypeAny } from "zod";
import { toJsonSchema } from "./zod-schema";

export const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

export type JsonRpcId = string | number | null;

export interface ToolResult {
  /** what the model reads first */
  text: string;
  /** the same answer as data (an object) */
  data?: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolDef<Ctx> {
  name: string;
  title: string;
  /** Arabic */
  description: string;
  /** what the call is checked against */
  input: ZodTypeAny;
  /** what `tools/list` tells the model, when it should be richer than `input` (a list whose rows are checked one by one inside the tool) */
  listSchema?: ZodTypeAny;
  /** true when the tool only reads */
  readOnly: boolean;
  run: (args: unknown, ctx: Ctx) => Promise<ToolResult>;
}

export interface ServerInfo {
  name: string;
  version: string;
  instructions?: string;
}

export interface RpcReply {
  status: 200 | 202;
  body?: unknown;
}

const error = (id: JsonRpcId, code: number, message: string, data?: unknown) => ({ jsonrpc: "2.0" as const, id, error: { code, message, ...(data === undefined ? {} : { data }) } });
const ok = (id: JsonRpcId, result: unknown) => ({ jsonrpc: "2.0" as const, id, result });

export function toolList<Ctx>(tools: ToolDef<Ctx>[]) {
  return tools.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: toJsonSchema(t.listSchema ?? t.input),
    annotations: { readOnlyHint: t.readOnly, destructiveHint: false, idempotentHint: t.readOnly, openWorldHint: false },
  }));
}

/** The version to speak: the client's if we know it, else our latest (the client decides whether it can live with that). */
export function negotiate(requested: unknown): string {
  return (SUPPORTED_VERSIONS as readonly string[]).includes(String(requested)) ? String(requested) : SUPPORTED_VERSIONS[0];
}

function validationText(e: { issues: { path: (string | number)[]; message: string }[] }): string {
  return "المدخلات مش صحيحة: " + e.issues.slice(0, 8).map((i) => `${i.path.join(".") || "(الأساس)"} — ${i.message}`).join(" · ");
}

async function callTool<Ctx>(tools: ToolDef<Ctx>[], params: unknown, ctx: Ctx) {
  const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
  const tool = tools.find((t) => t.name === p.name);
  if (!tool) return { unknown: true as const };
  const parsed = tool.input.safeParse(p.arguments ?? {});
  if (!parsed.success) return { result: { content: [{ type: "text", text: validationText(parsed.error) }], isError: true } };
  try {
    const r = await tool.run(parsed.data, ctx);
    return { result: { content: [{ type: "text", text: r.text }], ...(r.data ? { structuredContent: r.data } : {}), ...(r.isError ? { isError: true } : {}) } };
  } catch (e) {
    // an unexpected failure: the model is told something went wrong, never the details (they are in the server log)
    console.error(`mcp tool ${tool.name} failed:`, e);
    return { result: { content: [{ type: "text", text: "صار خطأ عند الميديا باير — جرّب بعد شوي. إذا تكرر، قول للمالك." }], isError: true } };
  }
}

async function one<Ctx>(msg: unknown, tools: ToolDef<Ctx>[], ctx: Ctx, info: ServerInfo): Promise<unknown | null> {
  if (!msg || typeof msg !== "object" || (msg as { jsonrpc?: unknown }).jsonrpc !== "2.0" || typeof (msg as { method?: unknown }).method !== "string") {
    const id = (msg as { id?: JsonRpcId } | null)?.id;
    // a response from the client (an id with a result or an error, and no method) is accepted and ignored
    if (msg && typeof msg === "object" && "id" in msg && !("method" in msg) && ("result" in msg || "error" in msg)) return null;
    return error(id ?? null, -32600, "رسالة JSON-RPC مش صحيحة");
  }
  const { id, method, params } = msg as { id?: JsonRpcId; method: string; params?: unknown };
  const isNotification = id === undefined;
  if (isNotification) return null;

  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: negotiate((params as { protocolVersion?: unknown } | undefined)?.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: info.name, version: info.version },
        ...(info.instructions ? { instructions: info.instructions } : {}),
      });
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: toolList(tools) });
    case "tools/call": {
      const r = await callTool(tools, params, ctx);
      return "unknown" in r ? error(id, -32602, `الأداة مش موجودة: ${String((params as { name?: unknown } | undefined)?.name)}`) : ok(id, r.result);
    }
    case "resources/list":
      return ok(id, { resources: [] });
    case "resources/templates/list":
      return ok(id, { resourceTemplates: [] });
    case "prompts/list":
      return ok(id, { prompts: [] });
    default:
      return error(id, -32601, `الطريقة مش معروفة: ${method}`);
  }
}

/** One HTTP POST body → what to answer. A batch answers with an array of the replies to its requests. */
export async function handleRpc<Ctx>(body: unknown, tools: ToolDef<Ctx>[], ctx: Ctx, info: ServerInfo): Promise<RpcReply> {
  if (Array.isArray(body)) {
    if (!body.length) return { status: 200, body: error(null, -32600, "دفعة فاضية") };
    const replies = (await Promise.all(body.map((m) => one(m, tools, ctx, info)))).filter((r) => r !== null);
    return replies.length ? { status: 200, body: replies } : { status: 202 };
  }
  const reply = await one(body, tools, ctx, info);
  return reply === null ? { status: 202 } : { status: 200, body: reply };
}
