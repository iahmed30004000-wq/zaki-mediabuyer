/**
 * «اختبر الربط»: ONE real read-only call per row, and the answer in the owner's words. Never writes, never sends a message, never echoes a value or a response body:
 * a failure says the status (or that nothing answered) and what to do. The credential is read from `process.env` — the overlay has already put the site's value there.
 */
import { driveFromEnv, getFile } from "@/adapters/drive";
import { readCapacity, repliesFromEnv } from "@/adapters/replies";
import { missingText } from "@/core/readiness";
import { statusWords } from "@/core/connections";
import { audit } from "./audit";

export interface TestResult {
  ok: boolean;
  message: string;
}

const T = 15_000;
const hostOf = (u: string): string => {
  try {
    return new URL(u).host;
  } catch {
    return "العنوان";
  }
};
const unreachable = (what: string) => `ما قدرت أوصل لـ ${what} — اتأكد من العنوان وإنو الموقع شغّال`;

async function bearerGet(base: string, path: string, token: string, what: string, fetchImpl: typeof fetch): Promise<{ ok: true; json: unknown } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await fetchImpl(`${base.replace(/\/+$/, "")}${path}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(T) });
  } catch {
    return { ok: false, message: unreachable(what) };
  }
  if (!res.ok) return { ok: false, message: statusWords(res.status, what) };
  try {
    return { ok: true, json: await res.json() };
  } catch {
    return { ok: false, message: `${what} ردّ بشي مش JSON` };
  }
}

type Tester = (fetchImpl: typeof fetch) => Promise<TestResult>;

const TESTS: Record<string, Tester> = {
  async meta(fetchImpl) {
    const why = missingText("meta");
    if (why) return { ok: false, message: why };
    const version = process.env.META_API_VERSION ?? "v24.0";
    let res: Response;
    try {
      res = await fetchImpl(`https://graph.facebook.com/${version}/me?fields=id,name`, { headers: { authorization: `Bearer ${process.env.META_SYSTEM_USER_TOKEN}` }, signal: AbortSignal.timeout(T) });
    } catch {
      return { ok: false, message: unreachable("ميتا") };
    }
    if (res.status === 400 || res.status === 401) return { ok: false, message: "ميتا رفض التوكن (غلط أو انتهى) — خذ توكن جديد من System Users" };
    if (!res.ok) return { ok: false, message: statusWords(res.status, "ميتا") };
    const j = (await res.json().catch(() => ({}))) as { name?: string };
    return { ok: true, message: `تمام — ميتا قبلت التوكن${j.name ? ` (${j.name})` : ""}. قراءة بس، ما انغيّر شي` };
  },

  async drive(fetchImpl) {
    const o = driveFromEnv();
    if (!o) return { ok: false, message: "ملف الـService Account ناقص أو مش صحيح" };
    const ids = [["مجلد المنتجات", process.env.DRIVE_PRODUCTS_FOLDER_ID], ["مجلد المكتبة", process.env.DRIVE_PRODUCTION_FOLDER_ID], ["مجلد الاستوديو", process.env.DRIVE_STUDIO_FOLDER_ID]].filter((x): x is [string, string] => !!x[1]?.trim());
    const checks = ids.length ? ids : ([["حساب درايف", "root"]] as [string, string][]);
    const done: string[] = [];
    for (const [label, id] of checks) {
      try {
        const f = await getFile({ ...o, fetch: fetchImpl }, id.trim());
        done.push(`${label}: «${f.name}»`);
      } catch (e) {
        const m = /answered (\d+)/.exec(e instanceof Error ? e.message : "");
        const status = m ? Number(m[1]) : 0;
        if (status === 404) return { ok: false, message: `${label}: مش موجود أو ما انشارك مع إيميل الـService Account` };
        return { ok: false, message: status ? statusWords(status, `درايف (${label})`) : unreachable("جوجل") };
      }
    }
    return { ok: true, message: `تمام — قريت ${done.join(" · ")}` };
  },

  async oms(fetchImpl) {
    const why = missingText("oms");
    if (why) return { ok: false, message: why.replace("بـ Coolify.", "من «اربط ← اسمح» ومن عنوان الـOMS.") };
    const r = await bearerGet(process.env.OMS_BASE_URL!, "/api/v1/products?fields=code", (process.env.OMS_TOKEN ?? process.env.OMS_API_TOKEN)!, "الـOMS", fetchImpl);
    if (!r.ok) return r;
    const items = (r.json as { items?: unknown[] })?.items ?? (Array.isArray(r.json) ? (r.json as unknown[]) : []);
    return { ok: true, message: `تمام — الـOMS ردّ: ${items.length} منتج. قراءة بس` };
  },

  async replies(fetchImpl) {
    const o = repliesFromEnv(fetchImpl);
    if (!o) return { ok: false, message: missingText("replies")?.replace("بـ Coolify.", "من «اربط ← اسمح» ومن العنوان.") ?? "نظام الردود مش مربوط" };
    try {
      const c = await readCapacity(o);
      return { ok: true, message: `تمام — ${c.unanswered} محادثة بلا رد${c.firstResponseP50Min !== null ? `، وسيط أول ردّ ${c.firstResponseP50Min} دقيقة` : ""}` };
    } catch (e) {
      const m = /answered (\d+)/.exec(e instanceof Error ? e.message : "");
      if (m) return { ok: false, message: statusWords(Number(m[1]), "نظام الردود") };
      return { ok: false, message: e instanceof Error && /Zod|invalid|Unrecognized/i.test(e.name + e.message) ? "نظام الردود ردّ بشكل مش المتفق عليه (حقل زيادة أو ناقص)" : unreachable(hostOf(o.baseUrl)) };
    }
  },

  async workspace(fetchImpl) {
    const why = missingText("workspace");
    if (why) return { ok: false, message: why.replace("بـ Coolify.", "من «اربط ← اسمح» ومن العنوان.") };
    const r = await bearerGet(process.env.WORKSPACE_BASE_URL!, "/api/v1/boards", process.env.WORKSPACE_API_TOKEN!, "Workspace", fetchImpl);
    if (!r.ok) return r;
    const n = Array.isArray(r.json) ? r.json.length : Array.isArray((r.json as { boards?: unknown[] })?.boards) ? (r.json as { boards: unknown[] }).boards.length : 0;
    return { ok: true, message: `تمام — Workspace ردّ: ${n} لوح. قراءة بس` };
  },
};

export const testableRows = Object.keys(TESTS);

/** Run the test of one row and write it to the audit log (the key and the result, nothing else). */
export async function testRow(key: string, userId: string, fetchImpl: typeof fetch = fetch): Promise<TestResult> {
  const t = TESTS[key];
  const r: TestResult = t ? await t(fetchImpl).catch(() => ({ ok: false, message: "صار خطأ بالفحص — جرّب كمان مرة" })) : { ok: false, message: "ما في فحص قراءة لهالرابط" };
  await audit({ type: "user", id: userId }, "connection.test", { type: "connection", id: key }, { after: { ok: r.ok } });
  return r;
}
