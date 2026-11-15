/**
 * The REST face of the handoff queue (`/api/v1/handoffs…`), for an agent that is not an MCP client — Claude Desktop
 * polling, a Hermes or n8n job. Same rules as /mcp: a bearer token the owner made (scope «handoff», or Claude's MCP token),
 * no cookie ever read, 120 calls a minute per token, every refusal as `{code, message}`.
 */
import { NextResponse } from "next/server";
import { makeLimiter } from "@/core/rate-limit";
import { ContractError, contractResponse, requireToken } from "./api-token";
import type { Actor } from "./audit";
import { HandoffRefused } from "./handoffs";
import { UnknownJob } from "./workflows";

const limit = makeLimiter(120, 60_000);

export interface HandoffCaller {
  /** shown as «who has it» */
  by: string;
  actor: Actor;
}

export async function withHandoffToken(req: Request, run: (who: HandoffCaller) => Promise<Response>): Promise<Response> {
  try {
    const token = await requireToken(req, "handoff");
    const rl = limit(token.id);
    if (!rl.ok) return NextResponse.json({ code: "rate_limited", message: `كتير نداءات — جرّب بعد ${rl.retryAfterS} ثانية` }, { status: 429, headers: { "Retry-After": String(rl.retryAfterS) } });
    return await run({ by: token.name.slice(0, 60), actor: { type: "agent", id: `api:${token.name}`.slice(0, 60) } });
  } catch (e) {
    if (e instanceof HandoffRefused) return NextResponse.json({ code: e.status === 404 ? "not_found" : e.status === 409 ? "conflict" : "refused", message: e.message }, { status: e.status });
    if (e instanceof UnknownJob) return NextResponse.json({ code: "unknown_workflow", message: `مفتاح الورك فلو مش معروف. المفاتيح: ${e.known.join("، ")}` }, { status: 404 });
    if (e instanceof ContractError) return contractResponse(e);
    return contractResponse(e);
  }
}

/** A body that does not fit the schema, said in words. */
export const invalid = (issues: { path: (string | number)[]; message: string }[]) =>
  NextResponse.json({ code: "invalid", message: "المدخلات مش صحيحة: " + issues.slice(0, 3).map((i) => `${i.path.join(".") || "الطلب"}: ${i.message}`).join(" · ") }, { status: 422 });
