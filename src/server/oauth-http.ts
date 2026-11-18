/** The HTTP side the connector's OAuth routes share: CORS for the open endpoints (no cookies, nothing credentialed), no caching, the JSON of an error, the client's address for the limiter. */
import { NextResponse } from "next/server";
import type { OAuthError } from "@/core/oauth";

const CORS: Record<string, string> = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version", "Access-Control-Max-Age": "86400" };
const NO_STORE: Record<string, string> = { "Cache-Control": "no-store", Pragma: "no-cache" };

export const preflight = () => new Response(null, { status: 204, headers: CORS });
export const jsonOk = (data: unknown, status = 200, cache = false) => NextResponse.json(data, { status, headers: { ...CORS, ...(cache ? { "Cache-Control": "public, max-age=300" } : NO_STORE) } });
export const jsonError = (status: number, body: OAuthError) => NextResponse.json(body, { status, headers: { ...CORS, ...NO_STORE } });
export const clientIp = (req: Request) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || "local";

/** A body as a client sends it: the standard form encoding (the token endpoint) or JSON (registration). */
export async function readParams(req: Request): Promise<URLSearchParams> {
  const type = req.headers.get("content-type") ?? "";
  const raw = await req.text();
  if (raw.length > 20_000) return new URLSearchParams();
  if (type.includes("application/json")) {
    try {
      const o = JSON.parse(raw) as Record<string, unknown>;
      return new URLSearchParams(Object.entries(o).filter(([, v]) => typeof v === "string").map(([k, v]) => [k, v as string]));
    } catch {
      return new URLSearchParams();
    }
  }
  return new URLSearchParams(raw);
}
