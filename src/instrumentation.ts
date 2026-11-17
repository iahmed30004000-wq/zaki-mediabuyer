/**
 * Runs once when the web server starts (D62): the values the owner saved on «الإعدادات ← الربط» are put over the environment, and OAuth tokens are renewed
 * every half minute. Node only (the edge runtime has no database) — the guarded import is the form Next documents so the edge build never sees `node:crypto`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
