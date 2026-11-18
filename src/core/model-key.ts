/**
 * The Claude key the owner pastes on the site (settings → «ربط مفتاح Claude»). Pure: only the SHAPE is judged here, and a hint
 * that is safe to show. The key itself is stored encrypted by src/server/assistant/connection.ts and never returned to a screen.
 */
export type KeyShape = { ok: true; key: string } | { ok: false; reason: string };

/** Anthropic keys look like sk-ant-api03-… (letters, digits, - and _). Whitespace around a paste is trimmed, inside it is refused. */
export function checkKeyShape(raw: unknown): KeyShape {
  if (typeof raw !== "string") return { ok: false, reason: "الصق المفتاح" };
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key) return { ok: false, reason: "الصق المفتاح" };
  if (/\s/.test(key)) return { ok: false, reason: "المفتاح فيه مسافة أو سطر — الصقه كما هو بدون زيادة" };
  if (!key.startsWith("sk-ant-")) return { ok: false, reason: "هاد مش مفتاح Claude — بيبدأ بـ sk-ant-" };
  if (key.length < 40 || key.length > 400) return { ok: false, reason: "طول المفتاح مش طبيعي — تأكد إنك نسخته كامل" };
  if (!/^[A-Za-z0-9_-]+$/.test(key)) return { ok: false, reason: "المفتاح فيه حروف مش مسموحة" };
  return { ok: true, key };
}

/** The last four characters — enough for the owner to recognise which key is linked, nothing more. */
export const keyHint = (key: string): string => `…${key.slice(-4)}`;
