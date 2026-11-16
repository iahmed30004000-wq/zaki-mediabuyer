/**
 * ROLES — who may do what, as ONE table (docs/rebuild/05-permissions.md §2–3). Eight roles × eighteen capabilities. Pure: the API checks it,
 * the screens hide what is not allowed, and tests/roles.test.ts holds every cell. A role is a ready-made template: the owner picks one for a person
 * and does not edit boxes (simpler, and every box is tested).
 *
 * The seven old capability names are gone (P10): `view` → by area · `connect_meta` → `ads.connect` · `propose_change` → `ads.propose` ·
 * `pause_or_reduce` and `kill_switch` → `ads.pause` · `approve_within_cap` → `ads.approve_within_cap` · `owner_only` stays.
 */
export const ROLES = ["OWNER", "MANAGER", "ADS_MANAGER", "OPS_MANAGER", "TEAM_LEAD", "MEMBER", "ANALYST", "VIEWER"] as const;
export type RoleKey = (typeof ROLES)[number];

export const ROLE_AR: Record<RoleKey, string> = {
  OWNER: "المالك",
  MANAGER: "مدير",
  ADS_MANAGER: "مسؤول إعلانات",
  OPS_MANAGER: "مسؤول تشغيل",
  TEAM_LEAD: "قائد فريق",
  MEMBER: "عضو",
  ANALYST: "محلل",
  VIEWER: "مشاهد",
};

/** One line for the team screen: what the role is for. */
export const ROLE_NOTE: Record<RoleKey, string> = {
  OWNER: "كل شي",
  MANAGER: "كل شي ما عدا «للمالك بس»",
  ADS_MANAGER: "الإعلانات: يشوف، يقترح، يوقّف، ويوافق ضمن السقف",
  OPS_MANAGER: "التشغيل: يشوف، يدير مهام الفريق، ويوافق على رسايل الفريق",
  TEAM_LEAD: "أرقام فريقه ومهامهم",
  MEMBER: "مهامه بس",
  ANALYST: "يشوف كل الأرقام ويقترح، وما بينفّذ",
  VIEWER: "يشوف اللوحات بس، بلا أرباح",
};

export const CAPABILITIES = [
  "ads.view",
  "ads.propose",
  "ads.pause",
  "ads.approve_within_cap",
  "ads.connect",
  "ops.view",
  "ops.people",
  "ops.send",
  "money.view",
  "work.view",
  "work.control",
  "orders.restrict",
  "tasks.manage",
  "tasks.own",
  "inbox.view",
  "assistant.use",
  "settings.view",
  "owner_only",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** What each capability means, in the owner's words (the team screen reads these). */
export const CAPABILITY_AR: Record<Capability, string> = {
  "ads.view": "يشوف لوحة الإعلانات والحملات والفيديوهات (مع الصرف)",
  "ads.propose": "يقترح تغيير أو إطلاق أو طلب فيديو",
  "ads.pause": "يوقّف ويخفّض (أمان) والإيقاف الكامل",
  "ads.approve_within_cap": "يوافق على زيادة ضمن السقف",
  "ads.connect": "يربط حساب فيسبوك أو يستورد ملف",
  "ops.view": "يشوف لوحة التشغيل (القمع، الشحن، المخزون)",
  "ops.people": "يشوف أرقام كل موظف باسمه",
  "ops.send": "يوافق على رسالة أو نصيحة للفريق",
  "money.view": "يشوف الأرباح والهوامش والتكاليف ونقط التعادل",
  "work.view": "يشوف خريطة المهام والتقارير (لمجالاته بس)",
  "work.control": "يشغّل أو يطفي مهمة أو فرع، ويقرّر على ورقة القرار",
  "orders.restrict": "يسجّل أمر ساري بيشدّد",
  "tasks.manage": "ينشئ ويوزّع وينقل مهام أي حدا",
  "tasks.own": "يشوف ويحدّث مهامه",
  "inbox.view": "يشوف قرارات مجالاته",
  "assistant.use": "يسأل المساعد (وأدواته بتتفلتر بقدراته)",
  "settings.view": "يشوف الإعدادات (قراءة)",
  owner_only: "الصرف فوق السقف · حملة جديدة · القواعد والسقوف · مستوى الحساب · الربط والتوكنات · الفريق والصلاحيات · الأمر اللي بيرخّي",
};

/** The table of §3, cell by cell. */
const MATRIX: Record<Capability, readonly RoleKey[]> = {
  "ads.view": ["OWNER", "MANAGER", "ADS_MANAGER", "ANALYST", "VIEWER"],
  "ads.propose": ["OWNER", "MANAGER", "ADS_MANAGER", "ANALYST"],
  "ads.pause": ["OWNER", "MANAGER", "ADS_MANAGER"],
  "ads.approve_within_cap": ["OWNER", "MANAGER", "ADS_MANAGER"],
  "ads.connect": ["OWNER", "ADS_MANAGER"],
  "ops.view": ["OWNER", "MANAGER", "OPS_MANAGER", "TEAM_LEAD", "ANALYST", "VIEWER"],
  "ops.people": ["OWNER", "MANAGER", "OPS_MANAGER", "TEAM_LEAD"],
  "ops.send": ["OWNER", "MANAGER", "OPS_MANAGER"],
  "money.view": ["OWNER", "MANAGER", "ADS_MANAGER", "ANALYST"],
  "work.view": ["OWNER", "MANAGER", "ADS_MANAGER", "OPS_MANAGER", "TEAM_LEAD", "ANALYST", "VIEWER"],
  "work.control": ["OWNER", "MANAGER"],
  "orders.restrict": ["OWNER", "MANAGER"],
  "tasks.manage": ["OWNER", "MANAGER", "ADS_MANAGER", "OPS_MANAGER", "TEAM_LEAD"],
  "tasks.own": ["OWNER", "MANAGER", "ADS_MANAGER", "OPS_MANAGER", "TEAM_LEAD", "MEMBER", "ANALYST"],
  "inbox.view": ["OWNER", "MANAGER", "ADS_MANAGER", "OPS_MANAGER"],
  "assistant.use": ["OWNER", "MANAGER", "ADS_MANAGER", "OPS_MANAGER", "ANALYST"],
  "settings.view": ["OWNER", "MANAGER"],
  owner_only: ["OWNER"],
};
export function can(role: RoleKey, capability: Capability): boolean {
  return MATRIX[capability].includes(role);
}

/** Every capability a role holds, in table order. */
export const capabilitiesOf = (role: RoleKey): Capability[] => CAPABILITIES.filter((c) => can(role, c));

/** A value from outside (a form, a session) that is one of the roles. */
export const isRoleKey = (v: unknown): v is RoleKey => typeof v === "string" && (ROLES as readonly string[]).includes(v);

/**
 * WHERE EACH ROLE LANDS and WHICH PLACES IT SEES (§3, «شو بيشوف كل دور أول ما يفتح»). A place that is not in the list is not in the bar, and its
 * address answers «هالصفحة مش من صلاحياتك».
 */
export type PlaceId = "home" | "inbox" | "work" | "ads" | "ops";
export const ROLE_PLACES: Record<RoleKey, readonly PlaceId[]> = {
  OWNER: ["home", "inbox", "work", "ads", "ops"],
  MANAGER: ["home", "inbox", "work", "ads", "ops"],
  ADS_MANAGER: ["home", "inbox", "work", "ads"],
  OPS_MANAGER: ["home", "inbox", "work", "ops"],
  TEAM_LEAD: ["work", "ops"],
  MEMBER: ["work"],
  ANALYST: ["home", "work", "ads"],
  VIEWER: ["home", "ads", "ops"],
};

/** The page a role opens on. */
export const ROLE_START: Record<RoleKey, string> = {
  OWNER: "/",
  MANAGER: "/",
  ADS_MANAGER: "/",
  OPS_MANAGER: "/",
  TEAM_LEAD: "/ops/confirm",
  MEMBER: "/work/tasks",
  ANALYST: "/",
  VIEWER: "/",
};

/**
 * Which capability opens an address (page level; the API checks its own). The first rule that matches wins, so the narrow ones come first.
 * `any` = one of these is enough. An address that matches none is open to any signed-in person (the login door).
 */
const PAGE_RULES: readonly { test: RegExp; any: readonly Capability[]; place?: PlaceId }[] = [
  { test: /^\/inbox(\/|$)/, any: ["inbox.view"], place: "inbox" },
  { test: /^\/work\/tasks(\/|$)/, any: ["tasks.own", "tasks.manage"], place: "work" },
  { test: /^\/work(\/|$)/, any: ["work.view"], place: "work" },
  { test: /^\/print\/(work|report)(\/|$)/, any: ["work.view"] },
  { test: /^\/(ads|products)(\/|$)/, any: ["ads.view"], place: "ads" },
  { test: /^\/ops(\/|$)/, any: ["ops.view"], place: "ops" },
  { test: /^\/settings(\/|$)/, any: ["settings.view"] },
  { test: /^\/p\//, any: ["tasks.own", "tasks.manage"] },
];

/**
 * May this role open this address? It needs the capability AND the place in its bar (§3): the table of capabilities decides what a role may DO and read through the
 * API; the bar decides which screens it is given. (An analyst holds «ops.view» but has no operations place; a viewer holds «work.view» but no work place.)
 * `/` is handled by the start page, below.
 */
export function canOpenPath(role: RoleKey, path: string): boolean {
  const rule = PAGE_RULES.find((r) => r.test.test(path));
  if (!rule) return true;
  if (rule.place && !ROLE_PLACES[role].includes(rule.place)) return false;
  return rule.any.some((c) => can(role, c));
}

/** The home page is for the roles that have it in their bar; the others are sent to where they start. */
export const hasHome = (role: RoleKey): boolean => ROLE_PLACES[role].includes("home");

/** The people this role may see, as the team directory says (§3 «المجال»): all for those with `tasks.manage` in the owner/manager sense; see `taskScopeOf`. */
export type TaskScope = "all" | "team" | "own";
export const taskScopeOf = (role: RoleKey): TaskScope => (role === "OWNER" || role === "MANAGER" || role === "ADS_MANAGER" || role === "OPS_MANAGER" ? "all" : role === "TEAM_LEAD" ? "team" : "own");

/** What a role's inbox may hold (§3 «المجال»): decisions of the areas it can look at. */
export const inboxDomainsOf = (role: RoleKey): readonly ("ads" | "ops" | "work")[] =>
  !can(role, "inbox.view") ? [] : [...(can(role, "ads.view") ? (["ads"] as const) : []), ...(can(role, "ops.view") ? (["ops"] as const) : []), ...(can(role, "work.view") ? (["work"] as const) : [])];
