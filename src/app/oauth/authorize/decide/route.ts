import { NextResponse } from "next/server";
import { appOrigin } from "@/server/env";
import { currentCaller } from "@/server/auth";
import { can } from "@/core/roles";
import { checkAuthRequest, createCode } from "@/server/oauth";

export const dynamic = "force-dynamic";

const page = (msg: string, status = 400) =>
  new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body dir="rtl" style="font-family:sans-serif;padding:2rem"><p>${msg}</p>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

/**
 * POST /oauth/authorize/decide — the owner's yes or no. Only his own session (a cookie, SameSite=Lax, so another site's form never carries it) and only from this site's page
 * (the Origin is checked). Everything the page showed is checked again from the form; nothing is trusted. A yes makes a one-time code and sends the browser back to the client.
 */
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(appOrigin()).origin) return page("الطلب جاي من موقع تاني — انرفض.", 403);
  const me = await currentCaller();
  if (!me || me.demo || !can(me.role, "owner_only")) return page("الموافقة للمالك وهو داخل بحسابه.", 403);
  const form = await req.formData();
  const params: Record<string, string> = { response_type: "code", code_challenge_method: "S256" };
  for (const k of ["client_id", "redirect_uri", "code_challenge", "scope", "state", "resource"]) {
    const v = form.get(k);
    if (typeof v === "string" && v) params[k] = v;
  }
  const checked = await checkAuthRequest(params);
  if (!checked.ok) return page(`${checked.why}. ما صار شي.`);
  const r = checked.req;
  const back = new URL(r.redirectUri);
  if (form.get("decision") !== "approve") {
    back.searchParams.set("error", "access_denied");
  } else {
    back.searchParams.set("code", await createCode(r, me.id));
  }
  if (r.state) back.searchParams.set("state", r.state);
  return NextResponse.redirect(back, 303);
}
