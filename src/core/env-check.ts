/**
 * The variables the site cannot do its job without, in production (v6 P0-1, N-10). Pure: it only says which are missing or too weak,
 * by NAME (never a value). The answer goes to the readiness panel and to an alert — it never stops the site from starting.
 */
export type Env = Record<string, string | undefined>;

export interface EnvProblem {
  name: string;
  /** one line for the owner */
  why: string;
}

const val = (env: Env, name: string) => env[name]?.trim() ?? "";

const RULES: { name: string; ok: (v: string) => boolean; why: string }[] = [
  { name: "DATABASE_URL", ok: (v) => v.startsWith("postgres"), why: "عنوان القاعدة" },
  { name: "AUTH_SECRET", ok: (v) => v.length >= 32, why: "سر الجلسات (32 خانة على الأقل) — بلاه ما حدا بيقدر يسجّل دخول" },
  { name: "ENCRYPTION_KEY", ok: (v) => v.length >= 32, why: "مفتاح تشفير التوكنات المحفوظة (32 خانة على الأقل)" },
  { name: "OWNER_EMAIL", ok: (v) => v.includes("@"), why: "بريد المالك: بلاه القاعدة الفاضية بتخلّي أول حساب يسجّل هو المالك" },
  { name: "APP_URL", ok: (v) => /^https?:\/\//.test(v), why: "عنوان الموقع (للروابط بالرسائل والموصّل)" },
  { name: "STORAGE_DIR", ok: (v) => v.length > 0, why: "مجلد التخزين (النسخ الاحتياطية والملفات) — بلاه بتنكتب جوّا الحاوية وبتضيع مع كل نشر" },
];

/** What is missing or weak. In development (not production) nothing is demanded, so it returns an empty list. */
export function envProblems(env: Env, production: boolean): EnvProblem[] {
  if (!production) return [];
  return RULES.filter((r) => !r.ok(val(env, r.name))).map((r) => ({ name: r.name, why: r.why }));
}
