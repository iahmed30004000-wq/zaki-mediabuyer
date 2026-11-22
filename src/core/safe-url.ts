/**
 * A link an agent sent is shown as a link only when it is `https://`: no `javascript:`, `data:`, `http:` or a relative path — the page that lists a
 * run's links is opened by the owner, and a link from outside is the one thing on it he did not write.
 */
export function isHttpsUrl(u: unknown): u is string {
  if (typeof u !== "string" || u.length > 300) return false;
  try {
    const url = new URL(u.trim());
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}
