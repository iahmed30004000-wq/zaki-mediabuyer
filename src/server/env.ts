/**
 * Environment variables, read in one place. The owner's v3/v4 names are accepted beside the ones the code already used
 * (OMS_API_TOKEN beside OMS_TOKEN, ANTHROPIC_API_KEY beside CLAUDE_API_KEY), so whichever he put in Coolify works.
 * A value is never returned to a screen or a log — callers only ask «is it there?» or use it for a call.
 */
import { envProblems as problemsOf } from "@/core/env-check";

export function envAny(...names: string[]): string | null {
  for (const n of names) {
    const v = process.env[n]?.trim();
    if (v) return v;
  }
  return null;
}

export const omsToken = () => envAny("OMS_TOKEN", "OMS_API_TOKEN");
export const omsBaseUrl = () => envAny("OMS_BASE_URL");
/** The OMS is linked: its orders are the truth, and pushed order tallies step aside. */
export const omsLinked = () => Boolean(omsBaseUrl() && omsToken());
export const anthropicKey = () => envAny("ANTHROPIC_API_KEY", "CLAUDE_API_KEY");

/** The site's own address (no trailing slash) — for links inside a message and for the MCP address shown to the owner. */
export function appOrigin(): string {
  return (envAny("APP_URL") ?? "http://localhost:3140").replace(/\/+$/, "");
}

/** The variables production cannot do without that are missing or too weak (names only) — shown on the readiness panel and raised as an alert; it never stops the site from starting. */
export const envProblems = () => problemsOf(process.env, process.env.NODE_ENV === "production");
