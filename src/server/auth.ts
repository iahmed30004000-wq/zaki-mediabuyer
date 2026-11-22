/**
 * Who is calling, and may they? Every API route that changes something calls `requireCapability`, and every change
 * it makes goes through `audit()` (spec 13.7).
 */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { ROLE_START, can, canOpenPath, hasHome, type Capability, type RoleKey } from "@/core/roles";
import { DUMMY_PASSWORD_HASH } from "@/core/auth-guards";
import { SESSION_COOKIE, SESSION_DAYS, authRequired, readSession, signSession } from "@/lib/session-token";
import { db } from "./db";

export interface Caller {
  id: string;
  role: RoleKey;
  /** The local demo without login: a stand-in owner that can only touch demo data. */
  demo: boolean;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function currentCaller(): Promise<Caller | null> {
  if (!authRequired()) return { id: "demo-owner", role: "OWNER", demo: true };
  const s = await readSession(cookies().get(SESSION_COOKIE)?.value);
  if (!s) return null;
  const user = await db.user.findUnique({ where: { id: s.sub } });
  if (!user || !user.active || user.sessionVer !== s.ver) return null;
  return { id: user.id, role: user.role, demo: false };
}

export async function requireCapability(capability: Capability): Promise<Caller> {
  const caller = await currentCaller();
  if (!caller) throw new HttpError(401, "لازم تسجّل دخول");
  if (!can(caller.role, capability)) throw new HttpError(403, "دورك ما بيسمح بهالإجراء");
  return caller;
}

/**
 * The first line of every page (v6 P0-1): a layout does not run again on a client-side navigation, so each page asks for itself.
 * Nobody signed in → the door. A role that may not open this page — by the capability named here (one of them is enough),
 * or by the table of places (`canOpenPath`, which the middleware's x-pathname header feeds) — → the page it starts on. `requirePage()` with no capability only needs a person signed in.
 */
export async function requirePage(capability?: Capability | readonly Capability[]): Promise<Caller> {
  const me = await currentCaller();
  if (!me) redirect("/login");
  const any = capability === undefined ? [] : Array.isArray(capability) ? capability : [capability as Capability];
  const path = headers().get("x-pathname");
  const start = ROLE_START[me.role];
  const denied = (any.length > 0 && !any.some((c) => can(me.role, c))) || (path !== null && !canOpenPath(me.role, path)) || (path === "/" && !hasHome(me.role));
  if (denied) redirect(start === path ? "/login" : start);
  return me;
}

/** Any signed-in person (the demo owner counts): for an answer that carries nothing a role may not see, or that filters itself by the caller's role. */
export async function requireSignedIn(): Promise<Caller> {
  const caller = await currentCaller();
  if (!caller) throw new HttpError(401, "لازم تسجّل دخول");
  return caller;
}

/** Turns an HttpError into a JSON answer in Arabic; anything else is a 500 without details. */
export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error(e);
  return NextResponse.json({ error: "صار خطأ، جرّب كمان مرة" }, { status: 500 });
}

export async function verifyPassword(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  // compare even when the person does not exist, so timing does not reveal who has an account
  // an invited member has no password yet (""): they sign in with their one-time code first
  const ok = await bcrypt.compare(password, user?.passwordHash || DUMMY_PASSWORD_HASH).catch(() => false);
  return ok && user?.active && user.passwordHash ? user : null;
}

export async function startSession(user: { id: string; role: RoleKey; sessionVer: number }) {
  const token = await signSession({ sub: user.id, role: user.role, ver: user.sessionVer });
  cookies().set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_DAYS * 86400 });
}

export function endSession() {
  cookies().delete(SESSION_COOKIE);
}
