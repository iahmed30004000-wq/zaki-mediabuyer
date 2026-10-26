/**
 * The real rows of the settings screen (MOCK_MODE=0): each account's level and whether it may go up, and each
 * agent's spend today against its cap. In demo mode the screen keeps its demo rows (null here).
 */
import { db } from "@/server/db";
import { getSetting } from "@/server/settings";
import { levelChange, type AutonomyLevel } from "@/core/autonomy";
import { accountRestricted } from "@/jobs/account-safety";
import { AGENT_NAMES, AGENTS } from "@/gateway";
import type { SourceHealth } from "@/lib/mock/data";
import { lastSuccess } from "@/jobs/runner";
import { productTargets } from "@/server/launch";
import { ROLE_AR, type RoleKey } from "@/core/roles";
import { safetyNetState } from "@/server/safety-net";

export interface LevelRow {
  metaId: string;
  name: string;
  level: number;
  dailyCap: number | null;
  restricted: boolean;
  /** for each target level 0–3: allowed, and why not */
  options: { level: number; ok: boolean; why: string }[];
}

export interface AgentRow {
  code: string;
  name: string;
  internalOnly: boolean;
  todayUsd: number;
  capUsd: number;
  runsToday: number;
  failedToday: number;
}

export async function loadSettingsView(): Promise<{ levels: LevelRow[]; agents: AgentRow[]; monthUsd: number; monthCap: number; modelConnected: boolean } | null> {
  if (process.env.MOCK_MODE === "1") return null;
  const levels: LevelRow[] = [];
  for (const a of await db.adAccount.findMany({ orderBy: { name: "asc" } })) {
    const first = await db.changeSet.findFirst({ where: { accountMetaId: a.metaId }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
    const days = first ? Math.floor((Date.now() - first.createdAt.getTime()) / 86_400_000) : 0;
    const restricted = await accountRestricted(a.metaId);
    levels.push({
      metaId: a.metaId,
      name: a.name,
      level: a.autonomyLevel,
      dailyCap: a.dailyCap ? Number(a.dailyCap) : null,
      restricted,
      options: [0, 1, 2, 3].map((l) => ({ level: l, ...levelChange(a.autonomyLevel as AutonomyLevel, l, { daysOfDecisions: days, restricted }) })),
    });
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const month = new Date(today);
  month.setDate(1);
  const caps = (await getSetting("agents.daily_caps")) as Record<string, number>;
  const runs = await db.agentRun.groupBy({ by: ["agent", "ok"], where: { createdAt: { gte: today } }, _sum: { costUsd: true }, _count: true });
  const agents = Object.values(AGENTS).map((p) => {
    const mine = runs.filter((r) => r.agent === p.code);
    return {
      code: p.code,
      name: AGENT_NAMES[p.code] ?? p.code,
      internalOnly: p.internalOnly,
      todayUsd: mine.reduce((n, r) => n + Number(r._sum.costUsd ?? 0), 0),
      capUsd: caps[p.code] ?? p.dailyCapUsd,
      runsToday: mine.reduce((n, r) => n + r._count, 0),
      failedToday: mine.filter((r) => !r.ok).reduce((n, r) => n + r._count, 0),
    };
  });
  const monthUsd = Number((await db.agentRun.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: month } } }))._sum.costUsd ?? 0);
  const { modelConnected } = await import("@/gateway");
  return { levels, agents, monthUsd, monthCap: Number(await getSetting("agents.monthly_cap")), modelConnected: modelConnected() };
}

// ───────────────────────────── the editable settings (real rows only) ─────────────────────────────


export interface EditView {
  links: SourceHealth[];
  writeMode: "dry_run" | "live";
  accounts: { metaId: string; name: string; market: string; dailyCap: number | null; monthlyCap: number | null; payment: string | null; safetyNet: "none" | "pending" | "on" }[];
  split: { scale: number; test: number; new: number };
  purchaseOn: "confirmed" | "delivered";
  products: { code: string; name: string; market: string; price: number; unitCost: number; deliveryFee: number; returnFee: number; codFeePct: number; confirmCost: number; stockDays: number | null; source: string; tOrder: number | null; ceiling: number | null; losing: boolean; dailyCap: number | null }[];
  pages: { metaId: string; name: string; code: string | null }[];
  landing: { productCode: string; lpCode: string; url: string }[];
  team: { id: string; email: string; name: string; role: RoleKey; roleAr: string; active: boolean; lastLogin: string | null; invitePending: boolean }[];
}

const ago = (d: Date | null) => {
  if (!d) return null;
  const m = Math.round((Date.now() - d.getTime()) / 60_000);
  return m < 60 ? `قبل ${m} دقيقة` : m < 48 * 60 ? `قبل ${Math.round(m / 60)} ساعة` : `قبل ${Math.round(m / 1440)} يوم`;
};

function link(key: string, label: string, configured: boolean, at: Date | null, lateMinutes: number, what: string): SourceHealth {
  if (!configured) return { key, label, state: "off", detail: "مش مربوط لسا" };
  if (!at) return { key, label, state: "late", detail: `مربوط — لسا ما ${what}` };
  const late = Date.now() - at.getTime() > lateMinutes * 60_000;
  return { key, label, state: late ? "late" : "ok", detail: `آخر ${what} ${ago(at)}` };
}

export async function loadEditView(): Promise<EditView | null> {
  if (process.env.MOCK_MODE === "1") return null;
  const has = (k: string) => Boolean(process.env[k]?.trim());
  const lastTelegram = (await db.report.findFirst({ where: { sentAt: { not: null } }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }))?.sentAt ?? null;
  const { modelConnected } = await import("@/gateway");
  const links: SourceHealth[] = [
    link("meta", "ميتا", has("META_SYSTEM_USER_TOKEN"), await lastSuccess("meta.sync"), 90, "سحب"),
    link("oms", "الـ OMS", has("OMS_BASE_URL") && has("OMS_TOKEN"), await lastSuccess("oms.sync"), 120, "مزامنة"),
    link("telegram", "تيليجرام", has("TELEGRAM_BOT_TOKEN") && has("TELEGRAM_OWNER_CHAT_ID"), lastTelegram, 26 * 60, "تقرير انبعت"),
    link("drive", "Google Drive", has("GOOGLE_SERVICE_ACCOUNT_JSON") && has("DRIVE_PRODUCTS_FOLDER_ID"), await lastSuccess("creative.intake"), 60, "فحص للوارد"),
    { key: "model", label: "الموديل", state: modelConnected() ? "ok" : "off", detail: modelConnected() ? (has("EXTERNAL_MODEL_BASE_URL") ? "داخلي + خارجي" : "داخلي") : "مش موصول — الكود بيكمّل لحاله" },
  ];
  const caps = (await getSetting("scale.product_caps")) as Record<string, number>;
  const products = [];
  for (const e of await db.productEconomics.findMany({ orderBy: { productCode: "asc" } })) {
    const t = await productTargets(e.productCode);
    products.push({
      code: e.productCode, name: e.name, market: e.market, price: Number(e.price), unitCost: Number(e.unitCost), deliveryFee: Number(e.deliveryFee), returnFee: Number(e.returnFee),
      codFeePct: Number(e.codFeePct), confirmCost: Number(e.confirmCost), stockDays: e.stockDays, source: e.source, tOrder: t?.tOrder ?? null, ceiling: t?.ceiling ?? null, losing: t?.losing ?? false, dailyCap: caps[e.productCode] ?? null,
    });
  }
  const users = await db.user.findMany({ orderBy: { createdAt: "asc" } });
  return {
    links,
    writeMode: process.env.META_WRITE_MODE === "live" ? "live" : "dry_run",
    accounts: await Promise.all((await db.adAccount.findMany({ orderBy: { name: "asc" } })).map(async (a) => ({ metaId: a.metaId, name: a.name, market: a.market ?? "—", dailyCap: a.dailyCap ? Number(a.dailyCap) : null, monthlyCap: a.monthlyCap ? Number(a.monthlyCap) : null, payment: a.paymentStatus, safetyNet: await safetyNetState(a.metaId) }))),
    split: (await getSetting("budget.split")) as { scale: number; test: number; new: number },
    purchaseOn: String(await getSetting("capi.purchase_on")) === "delivered" ? "delivered" : "confirmed",
    products,
    pages: (await db.page.findMany({ orderBy: { name: "asc" } })).map((p) => ({ metaId: p.metaId, name: p.name, code: p.code })),
    landing: (await getSetting("landing.pages")) as { productCode: string; lpCode: string; url: string }[],
    team: users.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, roleAr: ROLE_AR[u.role], active: u.active, lastLogin: ago(u.lastLoginAt), invitePending: !!u.inviteHash })),
  };
}

export interface AuditRow {
  id: string;
  at: string;
  who: string;
  action: string;
  target: string;
  change: string | null;
}

const ACTION_AR: Record<string, string> = {
  "change.propose": "اقترح تغيير", "change.approve": "وافق", "change.reject": "رفض", "change.execute": "نفّذ", "change.failed": "فشل التنفيذ", "change.rollback": "رجّع",
  "account.level": "غيّر المستوى", "account.caps": "غيّر السقوف", "setting.set": "غيّر إعداد", "product.update": "عدّل منتج", "product.create": "ضاف منتج", "page.code": "رمز صفحة",
  "team.invite": "دعا عضو", "team.update": "عدّل عضو", "team.reinvite": "رمز جديد لعضو", "team.accept_invite": "دخل بدعوة", "user.login": "دخل", "user.first_owner": "عمل حساب المالك",
  "creative.approve": "وافق على فيديو", "creative.exclude": "استبعد فيديو", "studio.token_create": "توكن للاستديو",
};

/** The audit trail (S18): who (a person, a rule, an agent) did what, to what, before and after, when. */
export async function loadAudit(o: { actor?: string; take?: number } = {}): Promise<AuditRow[] | null> {
  if (process.env.MOCK_MODE === "1") return null;
  const rows = await db.auditLog.findMany({ where: o.actor ? { actorType: o.actor } : {}, orderBy: { createdAt: "desc" }, take: o.take ?? 60 });
  const names = new Map((await db.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const when = (d: Date) => new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
  const short = (v: unknown) => (v === null || v === undefined ? "" : JSON.stringify(v).slice(0, 140));
  return rows.map((r) => ({
    id: r.id,
    at: when(r.createdAt),
    who: r.actorType === "user" ? names.get(r.actorId ?? "") ?? (r.actorId === "demo-owner" ? "المالك (تجربة)" : "إنسان") : r.actorType === "rule" ? `قاعدة ${r.actorId ?? ""}` : r.actorType === "agent" ? `وكيل ${r.actorId ?? ""}` : "النظام",
    action: ACTION_AR[r.action] ?? r.action,
    target: [r.targetType, r.targetId].filter(Boolean).join(" "),
    change: r.before || r.after ? `${short(r.before)}${r.before && r.after ? " ← " : ""}${short(r.after)}` : null,
  }));
}
