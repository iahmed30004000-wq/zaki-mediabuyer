/**
 * WHAT EACH LINK NEEDS (v3 · R), pure. With `MOCK_MODE=0` nothing pretends: a path that writes to (or reads from) a system whose
 * key is missing stops with a sentence in Arabic that names the environment variable — never a quiet «skipped», never a made-up
 * success. `MOCK_MODE=1` is the one labelled demo and is left alone. The values of the keys are never read here: only whether
 * they are there.
 *
 * Meta has one more lock: even with `META_WRITE_MODE=live` and a token, nothing is written to Meta until the owner puts
 * `META_LIVE_VERIFIED=1` — his own «yes, write for real now». The first time it is put, the token must see ONLY the test ad
 * account, so the first real write can only land there (docs/LIVE_CHECKS.md).
 */

export type Env = Record<string, string | undefined>;

export interface Integration {
  key: string;
  label: string;
  /** every group must have at least one variable set (the names inside a group are alternatives) */
  needs: string[][];
  /** it sends something out (a message, a file, a change) — not only reads */
  writes: boolean;
  /** the worker jobs whose last successful run says «it really worked» */
  jobs: string[];
  /** where the real call is recorded when it is not a worker job (the panel reads it) */
  probe?: "telegram" | "telegramIn" | "assistant" | "n8n" | "workspace" | "hermes" | "none";
  /** said once on the panel: what it is for */
  why: string;
  /** later, by the owner's own order */
  later?: boolean;
}

export const INTEGRATIONS: Integration[] = [
  { key: "assistant", label: "المساعد الذكي (Claude)", needs: [["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"]], writes: false, jobs: [], probe: "assistant", why: "بيجاوب من أرقامك ويعمل مهام ومسودات (ومعه PRIVACY_MODE=off)" },
  { key: "meta", label: "ميتا (قراءة)", needs: [["META_SYSTEM_USER_TOKEN"]], writes: false, jobs: ["meta.sync"], why: "سحب الصرف والنتائج" },
  { key: "metaWrite", label: "ميتا (كتابة)", needs: [["META_SYSTEM_USER_TOKEN"], ["META_WRITE_MODE"], ["META_LIVE_VERIFIED"]], writes: true, jobs: ["meta.upload"], why: "أي تغيير على الحملات — مقفولة لحد ما يتفحص على الحساب التجريبي" },
  { key: "oms", label: "الـ OMS", needs: [["OMS_BASE_URL"], ["OMS_TOKEN", "OMS_API_TOKEN"]], writes: false, jobs: ["oms.sync"], why: "الطلبات الحقيقية — الحقيقة اللي بنقرر عليها" },
  { key: "telegram", label: "تيليجرام", needs: [["TELEGRAM_BOT_TOKEN"], ["TELEGRAM_OWNER_CHAT_ID"]], writes: true, jobs: ["alerts.send"], probe: "telegram", why: "التنبيهات والتقارير و«اوقف»" },
  { key: "telegramIn", label: "تيليجرام — استقبال «اوقف»", needs: [["TELEGRAM_BOT_TOKEN"], ["TELEGRAM_OWNER_CHAT_ID"], ["TELEGRAM_WEBHOOK_SECRET"]], writes: false, jobs: [], probe: "telegramIn", why: "أي رسالة «اوقف» بتصير إيقاف مسجّل (والصرف بيتعمل من الموقع بس)" },
  { key: "workspace", label: "Zaki Workspace — مهام الفريق", needs: [["WORKSPACE_BASE_URL"], ["WORKSPACE_API_TOKEN"]], writes: true, jobs: ["workspace.sync"], probe: "workspace", why: "دفع مهام الأشخاص وسحب «خلص»" },
  { key: "n8n", label: "n8n (تنفيذ الخطوات)", needs: [["N8N_BASE_URL"], ["N8N_WEBHOOK_SECRET"]], writes: true, jobs: [], probe: "n8n", why: "زر «من الموقع» ومواعيد المهام" },
  { key: "n8nApi", label: "n8n (فحص الحالة)", needs: [["N8N_BASE_URL"], ["N8N_API_KEY"]], writes: false, jobs: [], probe: "none", why: "قراءة حالة الفلوهات" },
  { key: "drive", label: "درايف — الوارد", needs: [["GOOGLE_SERVICE_ACCOUNT_JSON"], ["DRIVE_PRODUCTS_FOLDER_ID"]], writes: true, jobs: ["creative.intake"], why: "استلام الفيديوهات ونقلها (ولا حذف)" },
  { key: "driveLibrary", label: "درايف — مكتبة الفيديوهات", needs: [["GOOGLE_SERVICE_ACCOUNT_JSON"], ["DRIVE_PRODUCTION_FOLDER_ID"]], writes: false, jobs: ["drive.library"], why: "ربط كل فيديو بملفه وسيناريوه" },
  { key: "studioDrive", label: "درايف — الاستوديو", needs: [["GOOGLE_SERVICE_ACCOUNT_JSON"], ["DRIVE_STUDIO_FOLDER_ID"]], writes: false, jobs: ["creative.intake.studio"], why: "قراءة مجلد الاستوديو" },
  { key: "replies", label: "نظام الردود", needs: [["REPLIES_BASE_URL"], ["REPLIES_TOKEN"]], writes: false, jobs: ["replies.sync"], why: "قدرة الرد وتجميد تكبير الرسائل" },
  { key: "hermes", label: "هيرمز (طلبات الفيديو)", needs: [["HERMES_BASE_URL", "TELEGRAM_HERMES_CHAT_ID"], ["HERMES_TOKEN", "TELEGRAM_HERMES_CHAT_ID"]], writes: true, jobs: [], probe: "hermes", why: "وصول طلبات الفيديو لهيرمز" },
  { key: "firebase", label: "الإشعارات للجوال (Firebase)", needs: [["FIREBASE_API_KEY"], ["FIREBASE_PROJECT_ID"], ["FIREBASE_MESSAGING_SENDER_ID"], ["FIREBASE_APP_ID"], ["FIREBASE_VAPID_KEY"], ["FIREBASE_SERVICE_ACCOUNT_JSON"]], writes: true, jobs: [], probe: "none", why: "إشعار على الجوال والموقع مسكّر (من «الربط»)" },
];

export const integrationOf = (key: string): Integration => {
  const i = INTEGRATIONS.find((x) => x.key === key);
  if (!i) throw new Error(`integration ${key}`);
  return i;
};

const has = (env: Env, name: string) => !!env[name]?.trim();

/** The groups that have nothing set — each as the names the owner may use («A أو B»). Empty = it is linked. */
export function missingGroups(i: Integration, env: Env = process.env): string[] {
  return i.needs.filter((g) => !g.some((n) => has(env, n))).map((g) => g.join(" أو "));
}

export const isLinked = (key: string, env: Env = process.env): boolean => missingGroups(integrationOf(key), env).length === 0;

/** «تيليجرام مش مربوط — ناقص: TELEGRAM_BOT_TOKEN و TELEGRAM_OWNER_CHAT_ID. ضيفهم بـ Coolify.» — or null when it is linked. */
export function missingText(key: string, env: Env = process.env): string | null {
  const i = integrationOf(key);
  const m = missingGroups(i, env);
  return m.length ? `${i.label} مش مربوط — ناقص: ${m.join(" و ")}. ضيف${m.length > 1 ? "هم" : "ه"} بـ Coolify.` : null;
}

/** Thrown where a path would otherwise do nothing, or pretend. Its message is the sentence for the owner. */
export class MissingKeyError extends Error {
  constructor(
    public integration: string,
    message: string,
  ) {
    super(message);
    this.name = "MissingKeyError";
  }
}

/** The demo (`MOCK_MODE=1`) is the one labelled mock: it never stops here. */
export const isDemo = (env: Env = process.env): boolean => env.MOCK_MODE === "1";

/** Stops with the sentence when the link is not there (never in the demo). */
export function requireKeys(key: string, env: Env = process.env): void {
  if (isDemo(env)) return;
  const t = missingText(key, env);
  if (t) throw new MissingKeyError(key, t);
}

export interface WriteGate {
  /** what the code does: «live» only when everything is in place */
  mode: "dry_run" | "live";
  /** why a live write was asked for and refused (null: nothing was asked, or all is in place) */
  error: string | null;
}

/**
 * The one place that says whether Meta may be written to. `dry_run` is the default and is honest (the item records what would
 * have been sent). `META_WRITE_MODE=live` is a request, and it is refused — loudly — until the token is there AND
 * `META_LIVE_VERIFIED=1` says the owner saw a write work on the test ad account. The token may come from the environment or from
 * the encrypted connection in the database, so the caller says whether there is one (`hasToken`).
 */
export function metaWriteGate(env: Env = process.env, hasToken: boolean = has(env, "META_SYSTEM_USER_TOKEN")): WriteGate {
  if (env.META_WRITE_MODE !== "live") return { mode: "dry_run", error: null };
  if (env.META_LIVE_VERIFIED !== "1") return { mode: "dry_run", error: "الكتابة على ميتا مقفولة: META_WRITE_MODE=live موجود بس META_LIVE_VERIFIED=1 مش محطوط. حطّه لما تقرّر تسمح بالكتابة الحقيقية — وأول فحص لازم يكون على حساب إعلاني تجريبي بتوكن مش شايف غيره (docs/LIVE_CHECKS.md)" };
  if (!hasToken) return { mode: "dry_run", error: "الكتابة على ميتا ما بتمشي — ناقص META_SYSTEM_USER_TOKEN (ضيفه بـ Coolify)" };
  return { mode: "live", error: null };
}
