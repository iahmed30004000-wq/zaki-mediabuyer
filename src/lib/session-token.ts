/**
 * The session cookie: a signed JWT (HS256, AUTH_SECRET) with the person, their role and their session version.
 * Edge-safe (jose only), so the middleware can read it too. Bumping User.sessionVer signs every session out.
 */
import { SignJWT, jwtVerify } from "jose";
import type { RoleKey } from "@/core/roles";

export const SESSION_COOKIE = "mb_session";
export const SESSION_DAYS = 14;

export interface Session {
  sub: string;
  role: RoleKey;
  ver: number;
}

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters");
  return new TextEncoder().encode(s);
}

export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ role: s.role, ver: s.ver }).setProtectedHeader({ alg: "HS256" }).setSubject(s.sub).setIssuedAt().setExpirationTime(`${SESSION_DAYS}d`).sign(secret());
}

export async function readSession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.role !== "string" || typeof payload.ver !== "number") return null;
    return { sub: payload.sub, role: payload.role as RoleKey, ver: payload.ver };
  } catch {
    return null;
  }
}

/** Login is required, except on a local development machine that explicitly turns it off (AUTH_REQUIRED=0). Never in production. */
export function authRequired(): boolean {
  return !(process.env.AUTH_REQUIRED === "0" && process.env.NODE_ENV !== "production");
}
