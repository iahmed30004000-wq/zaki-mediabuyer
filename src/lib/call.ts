/**
 * CALLING THE SITE FROM A BUTTON (v6 · P0-2, U-13).
 *
 * A bare `await fetch(...)` throws when the network drops: the button stays «busy» forever, or the click does nothing and says nothing.
 * `safeFetch` never throws — when the network is gone it answers with a Response (status 503, header `x-offline: 1`) whose body is `{ error: <an Arabic sentence> }`,
 * so every caller that already reads `r.ok` and `d.error` shows the sentence instead of dying. `callJson` is the same thing already read.
 */

export const OFFLINE_SENTENCE = "انقطع الاتصال — تأكد من النت وجرّب مرة تانية";

export type CallInit = RequestInit;

/** A drop-in for `fetch` that never throws. A network failure is a 503 whose JSON body carries the sentence. */
export async function safeFetch(url: string, init: CallInit = {}, fetchImpl: typeof fetch = fetch): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch (e) {
    // a request the caller aborted on purpose (a closed panel, a new question) is not «the network is gone»: let the caller see it
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return new Response(JSON.stringify({ ok: false, error: OFFLINE_SENTENCE }), { status: 503, headers: { "content-type": "application/json", "x-offline": "1" } });
  }
}

export interface CallResult<T> {
  ok: boolean;
  status: number;
  /** the JSON body (null when there was none) */
  data: T | null;
  /** the sentence to show when it did not work (null when it did) */
  error: string | null;
  /** the network was gone: nothing reached the site */
  offline: boolean;
}

/** Sends JSON (when `body` is an object) and reads JSON back. Never throws. */
export async function callJson<T = Record<string, unknown>>(url: string, init: Omit<RequestInit, "body"> & { body?: unknown } = {}, fetchImpl: typeof fetch = fetch): Promise<CallResult<T>> {
  const { body, headers, ...rest } = init;
  const hasBody = body !== undefined && body !== null;
  const r = await safeFetch(url, { ...rest, headers: { ...(hasBody ? { "content-type": "application/json" } : {}), ...(headers as Record<string, string> | undefined) }, ...(hasBody ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) }, fetchImpl);
  const data = (await r.json().catch(() => null)) as T | null;
  const offline = r.headers.get("x-offline") === "1";
  const sentence = (data as { error?: unknown } | null)?.error;
  return { ok: r.ok, status: r.status, data, error: r.ok ? null : typeof sentence === "string" && sentence ? sentence : `صار خطأ (${r.status})`, offline };
}
