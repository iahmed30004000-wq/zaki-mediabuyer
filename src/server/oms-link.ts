/**
 * THE OMS LINK (P0.3) — where the hourly read goes, with which key, and whether it is switched on at all.
 *
 * Three settings, all in `.env` on the machine and never on the site (the «الربط» rule):
 *   OMS_LIVE=1        the switch. Anything else = the real adapter is off; screens stay on demo data and
 *                     `npm run demo:pipeline` keeps exercising the same adapter against the fixtures.
 *   OMS_BASE_URL      the OMS origin, e.g. https://crm.zakiai.io. https only, except a local OMS on this machine.
 *   OMS_TOKEN_ENC     the OMS key («الميديا باير» on the OMS token screen), sealed with ENCRYPTION_KEY by
 *                     `npm run oms:link`. A plaintext OMS_TOKEN is accepted on a dev machine only; production
 *                     refuses it, so the key is never sitting readable in a server's environment.
 *
 * Nothing here ever returns, logs or renders the token: `omsLinkStatus` is what screens and /api/health see, and
 * it carries the host and the state, nothing else.
 */
import { decryptSecrets } from "./crypto";
import type { OmsOptions } from "@/adapters/oms";

export type OmsLink = { mode: "live"; options: OmsOptions; encrypted: boolean } | { mode: "off"; why: string };

type Env = Record<string, string | undefined>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function omsLink(env: Env = process.env, fetchImpl?: typeof fetch): OmsLink {
  if (env.OMS_LIVE?.trim() !== "1") return { mode: "off", why: "الربط الحقيقي مطفي (OMS_LIVE ≠ 1) — الشاشات على التجريبي" };

  const raw = env.OMS_BASE_URL?.trim();
  if (!raw) return { mode: "off", why: "ما في عنوان للـ OMS (OMS_BASE_URL)" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { mode: "off", why: "عنوان الـ OMS مش رابط صحيح" };
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
    return { mode: "off", why: "عنوان الـ OMS لازم يكون https — التوكن ما بيمشي على رابط مكشوف" };
  }

  const sealed = env.OMS_TOKEN_ENC?.trim();
  if (sealed) {
    const token = decryptSecrets<{ token: string }>(sealed)?.token;
    if (!token) return { mode: "off", why: "مفتاح الـ OMS المشفّر ما انفك — تأكد من ENCRYPTION_KEY أو أعد `npm run oms:link`" };
    return { mode: "live", options: { baseUrl: url.origin, token, fetch: fetchImpl }, encrypted: true };
  }

  const plain = env.OMS_TOKEN?.trim();
  if (!plain) return { mode: "off", why: "ما في مفتاح للـ OMS — شغّل `npm run oms:link`" };
  if (env.NODE_ENV === "production") {
    return { mode: "off", why: "بالإنتاج المفتاح لازم يكون مشفّر (OMS_TOKEN_ENC) — شغّل `npm run oms:link`" };
  }
  return { mode: "live", options: { baseUrl: url.origin, token: plain, fetch: fetchImpl }, encrypted: false };
}

/** What a screen or /api/health may know about the link — never the key. */
export function omsLinkStatus(env: Env = process.env): { live: boolean; host: string | null; encrypted: boolean; why: string | null } {
  const link = omsLink(env);
  if (link.mode === "off") {
    let host: string | null = null;
    try {
      host = env.OMS_BASE_URL ? new URL(env.OMS_BASE_URL.trim()).host : null;
    } catch {
      host = null;
    }
    return { live: false, host, encrypted: false, why: link.why };
  }
  return { live: true, host: new URL(link.options.baseUrl).host, encrypted: link.encrypted, why: null };
}
