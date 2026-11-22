/**
 * THE CONNECTIONS PAGE, as data (D62). Which value belongs to which row, which are secrets, how each is checked — pure, so a test holds every rule. The key of one
 * of OUR systems (OMS · replies · Workspace) is made by that system, on its «توكنات الأنظمة» page: a token with named scopes and an expiry; the owner pastes it here
 * once (write-only, sealed). What has no such system — Meta's System User token, Google's service account file, an AI key — is entered the same way. Nothing here
 * ever sees a value's content beyond checking its shape.
 */
export type FieldKind = "secret" | "file" | "text" | "url";

export interface ConnField {
  /** the environment variable it stands for (and the name it is stored under) */
  name: string;
  label: string;
  kind: FieldKind;
  hint?: string;
  example?: string;
}

export interface ConnRow {
  key: string;
  title: string;
  /** external = a key from a company (Meta, Google); internal = a token from one of our systems; info = nothing to enter */
  kind: "external" | "internal" | "info";
  fields: readonly ConnField[];
  /** a real read-only call exists for it */
  testable: boolean;
  note?: string;
}

export const ROWS: readonly ConnRow[] = [
  {
    key: "meta",
    title: "ميتا (System User)",
    kind: "external",
    fields: [{ name: "META_SYSTEM_USER_TOKEN", label: "توكن المستخدم النظامي", kind: "secret", hint: "من Business Settings ← System Users. بيظهر مرة وحدة عند ميتا." }],
    testable: true,
    note: "قفل الكتابة على ميتا (وضع الكتابة والتحقق) بيضل بـ Coolify بقرارك.",
  },
  {
    key: "drive",
    title: "جوجل درايف (Service Account)",
    kind: "external",
    fields: [
      { name: "GOOGLE_SERVICE_ACCOUNT_JSON", label: "ملف الـService Account (JSON)", kind: "file", hint: "ارفع الملف اللي نزّلته من جوجل. ما بينعرض ولا بينرجع." },
      { name: "DRIVE_PRODUCTS_FOLDER_ID", label: "مجلد «المنتجات» (الوارد)", kind: "text", example: "1AbCdEfGhIjKlMnOpQrStUvWxYz012345", hint: "معرّف المجلد من رابطه. مش سرّ." },
      { name: "DRIVE_PRODUCTION_FOLDER_ID", label: "مجلد مكتبة الفيديوهات", kind: "text", example: "1AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
      { name: "DRIVE_STUDIO_FOLDER_ID", label: "مجلد الاستوديو", kind: "text", example: "1AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
    ],
    testable: true,
  },
  {
    key: "oms",
    title: "الـOMS",
    kind: "internal",
    fields: [
      { name: "OMS_BASE_URL", label: "عنوان الـOMS", kind: "url", example: "https://crm.zakiai.io" },
      { name: "OMS_TOKEN", label: "توكن النظام", kind: "secret", hint: "من الـOMS ← الإعدادات ← توكنات الأنظمة ← «الميديا باير». صلاحياته: products.read · products.costs.read · orders.attribution.read · ads.spend.read · notify.send." },
      { name: "OMS_EVENT_SECRET", label: "سرّ توقيع أحداث الـOMS (اختياري)", kind: "secret", hint: "بيطلع مع التوكن. بيوقّع حدث «اوقف» اللي بيبعته الـOMS لنا." },
    ],
    testable: true,
  },
  {
    key: "replies",
    title: "نظام الردود",
    kind: "internal",
    fields: [
      { name: "REPLIES_BASE_URL", label: "عنوان نظام الردود", kind: "url", example: "https://replies.example.com" },
      { name: "REPLIES_TOKEN", label: "توكن النظام", kind: "secret", hint: "من نظام الردود ← توكنات الأنظمة، بصلاحية capacity.read بس." },
    ],
    testable: true,
  },
  {
    key: "workspace",
    title: "Zaki Workspace",
    kind: "internal",
    fields: [
      { name: "WORKSPACE_BASE_URL", label: "عنوان Workspace", kind: "url", example: "https://workspace.zakiai.io" },
      { name: "WORKSPACE_BOARD_ID", label: "اللوح (إذا في أكتر من وحد)", kind: "text", example: "brd_example" },
      { name: "WORKSPACE_API_TOKEN", label: "توكن النظام", kind: "secret", hint: "من Workspace ← توكنات الأنظمة، بصلاحيات tasks.write وtasks.read." },
    ],
    testable: true,
  },
  {
    key: "firebase",
    title: "إشعارات الجوال (Firebase)",
    kind: "external",
    fields: [
      { name: "FIREBASE_API_KEY", label: "apiKey (من «تطبيق ويب» بمشروعك)", kind: "text", example: "AIzaSy-example", hint: "مش سرّ — بيوصل للمتصفح." },
      { name: "FIREBASE_PROJECT_ID", label: "projectId", kind: "text", example: "my-project-12345", hint: "مش سرّ." },
      { name: "FIREBASE_MESSAGING_SENDER_ID", label: "messagingSenderId", kind: "text", example: "123456789012", hint: "مش سرّ." },
      { name: "FIREBASE_APP_ID", label: "appId", kind: "text", example: "1:123456789012:web:abc123", hint: "مش سرّ." },
      { name: "FIREBASE_VAPID_KEY", label: "المفتاح العام (Web Push certificates)", kind: "text", hint: "من Cloud Messaging ← Web Push certificates. مفتاح عام، مش سرّ." },
      { name: "FIREBASE_SERVICE_ACCOUNT_JSON", label: "ملف الـService Account (JSON)", kind: "file", hint: "سرّي: ارفعه مرة وما بيرجع يظهر. من Project settings ← Service accounts." },
    ],
    testable: true,
    note: "بلا هالست ما بتوصل إشعارات للجوال: بتضل بالجرس بالموقع بس (وتيليجرام لو مربوط). كل القيم بتنلصق هون بالموقع، مش بإعدادات السيرفر.",
  },
  { key: "telegram", title: "تيليجرام", kind: "info", fields: [], testable: false, note: "التنبيهات وتقرير الصبح لسا بتنبعت من بوت الموقع نفسه، ومفاتيحه (TELEGRAM_BOT_TOKEN · TELEGRAM_OWNER_CHAT_ID) بتنكتب بـ Coolify مش من هون. بعد ما ينتقل الإرسال إلى الـOMS (`/api/v1/notify`) بيصير عنده البوت." },
  { key: "hermes", title: "هيرمز", kind: "info", fields: [], testable: false, note: "هيرمز هو اللي بيسحب منّا بتوكن بنعمله هون من «الفريق ← توكنات الوكلاء». ما في شي يتكتب بهالسطر." },
  { key: "assistant", title: "مفتاح الذكاء الاصطناعي (Claude)", kind: "info", fields: [], testable: false, note: "من «ربط مفتاح Claude» تحت." },
];

/** Every name a person may write from the site. Anything else (the Meta write locks, MOCK_MODE, the master key itself) stays in Coolify. */
export const FIELD_NAMES: readonly string[] = ROWS.flatMap((r) => r.fields.map((f) => f.name));
export const fieldOf = (name: string): ConnField | undefined => ROWS.flatMap((r) => r.fields).find((f) => f.name === name);
export const rowOf = (key: string): ConnRow | undefined => ROWS.find((r) => r.key === key);
export const rowOfField = (name: string): ConnRow | undefined => ROWS.find((r) => r.fields.some((f) => f.name === name));

/** The keys that belong to an address: the secrets of the same row. A key is only meant for the host it was made for, so changing the address ends their pairing. */
export const pairedSecrets = (urlField: string): string[] => (fieldOf(urlField)?.kind === "url" ? (rowOfField(urlField)?.fields ?? []) : []).filter((x) => x.kind === "secret").map((x) => x.name);

/** The host part of an address (scheme + host + port), or null when it is not one. */
export function originOf(value: string | undefined | null): string | null {
  try {
    return new URL((value ?? "").trim()).origin.toLowerCase();
  } catch {
    return null;
  }
}


const SECRET_KINDS: readonly FieldKind[] = ["secret", "file"];
export const isSecretField = (f: ConnField): boolean => SECRET_KINDS.includes(f.kind);

export type Checked = { ok: true; value: string } | { ok: false; error: string };

/** What a value must look like before it is stored. The message is for the owner and never repeats the value. */
export function checkValue(f: ConnField, raw: unknown): Checked {
  if (typeof raw !== "string") return { ok: false, error: "القيمة لازم تكون نص" };
  const v = raw.trim();
  if (!v) return { ok: false, error: "اكتب القيمة (أو اضغط «امسح» لإزالتها)" };
  switch (f.kind) {
    case "secret":
      if (v.length < 8 || v.length > 4000) return { ok: false, error: "المفتاح قصير أو طويل بزيادة" };
      if (/\s/.test(v)) return { ok: false, error: "المفتاح ما بيحتوي مسافات أو سطور — انسخه من جديد" };
      return { ok: true, value: v };
    case "file": {
      if (v.length > 20_000) return { ok: false, error: "الملف كبير — لازم يكون ملف الـService Account نفسه" };
      try {
        const j = JSON.parse(v) as Record<string, unknown>;
        if (j.type !== "service_account" || typeof j.client_email !== "string" || typeof j.private_key !== "string" || !j.private_key.includes("PRIVATE KEY")) return { ok: false, error: "هاد مش ملف Service Account من جوجل" };
      } catch {
        return { ok: false, error: "الملف مش JSON صحيح" };
      }
      return { ok: true, value: v };
    }
    case "url": {
      let u: URL;
      try {
        u = new URL(v);
      } catch {
        return { ok: false, error: "العنوان مش صحيح (اكتبه كامل مع https://)" };
      }
      const local = u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
      if (u.protocol !== "https:" && !local) return { ok: false, error: "العنوان لازم https" };
      if (u.username || u.password || u.search || u.hash) return { ok: false, error: "العنوان بلا مستخدم أو كلمة سر أو علامات" };
      return { ok: true, value: u.origin + u.pathname.replace(/\/+$/, "") };
    }
    case "text":
      if (!/^[A-Za-z0-9_.:\/-]{1,128}$/.test(v)) return { ok: false, error: "المعرّف حروف وأرقام ونقطة وشرطة بس" };
      return { ok: true, value: v };
  }
}

/** The only part of a secret that stays readable: its last four characters (a file shows none). */
export const last4Of = (f: ConnField, value: string): string | null => (f.kind === "secret" ? value.slice(-4) : null);

// ── the in-process overlay: an in-app value wins, the environment is the fallback, a deleted value gives the environment back ──

export type EnvLike = Record<string, string | undefined>;
export interface OverlayState {
  /** what the environment held before the first overlay of that name (undefined = it held nothing) */
  originals: Map<string, string | undefined>;
  applied: Set<string>;
}
export const newOverlay = (): OverlayState => ({ originals: new Map(), applied: new Set() });

/** Puts `values` over `env`; a name that was overlaid before and is gone now gets its original back. Returns what changed. */
export function applyOverlay(env: EnvLike, state: OverlayState, values: Readonly<Record<string, string>>): { set: string[]; restored: string[] } {
  const set: string[] = [];
  const restored: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    if (!state.originals.has(name)) state.originals.set(name, env[name]);
    if (env[name] !== value) set.push(name);
    env[name] = value;
    state.applied.add(name);
  }
  for (const name of [...state.applied]) {
    if (name in values) continue;
    const orig = state.originals.get(name);
    if (orig === undefined) delete env[name];
    else env[name] = orig;
    state.applied.delete(name);
    state.originals.delete(name);
    restored.push(name);
  }
  return { set, restored };
}

/** Where a value comes from now: the site, Coolify, or nowhere. */
export function sourceOf(name: string, saved: ReadonlySet<string>, env: EnvLike, state: OverlayState): "app" | "env" | "none" {
  if (saved.has(name)) return "app";
  const base = state.originals.has(name) ? state.originals.get(name) : env[name];
  return base?.trim() ? "env" : "none";
}

/** A reason in the owner's words for a failed test, from a status code only (no body, no echo). */
export function statusWords(status: number, what: string): string {
  if (status === 401) return `${what} رفض المفتاح (انتهى أو انسحب) — اعمل توكن جديد والصقه`;
  if (status === 403) return `${what} قبل المفتاح بس ما إله صلاحية لهالطلب`;
  if (status === 404) return `${what}: العنوان أو المورد مش موجود`;
  if (status === 429) return `${what}: كتير طلبات — جرّب بعد شوي`;
  if (status >= 500) return `${what} ما ردّ منيح (${status})`;
  return `${what} ردّ غير متوقع (${status})`;
}
