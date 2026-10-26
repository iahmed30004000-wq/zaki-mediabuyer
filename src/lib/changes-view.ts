/**
 * The change sets as the screens draw them: the demo list, or the real ones from the database (MOCK_MODE=0),
 * mapped to the same card shape.
 */
import { db } from "@/server/db";
import { CHANGES, type ChangeSet } from "@/lib/mock/data";

const BY: Record<string, string> = { rule: "قاعدة", agent: "وكيل", user: "إنت", kill_switch: "الإيقاف الكامل", telegram: "تيليجرام" };
const RULE_AR: Record<string, string> = {
  loser_no_orders: "قاعدة الخاسر", loser_no_confirmed: "قاعدة الخاسر بلا مؤكد", high_cpa: "قاعدة تكلفة المؤكد", high_return: "قاعدة المرتجع",
  daily_cap: "قاعدة السقف اليومي", spend_spike: "قاعدة قفزة الصرف", stock_out: "قاعدة المخزون", scale: "سلّم التكبير",
};

const when = (d: Date) => new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(d);

function side(items: { op: string; before: unknown; after: unknown }[], key: "before" | "after"): string {
  const i = items[0];
  if (!i) return "—";
  const v = (key === "before" ? i.before : i.after) as { status?: string; dailyBudget?: number };
  const one = v.dailyBudget !== undefined && i.op === "set_budget" ? `${v.dailyBudget}$ باليوم` : v.status === "PAUSED" ? "موقوف" : v.status ? "شغّال" : "—";
  return items.length > 1 ? `${one} (+${items.length - 1})` : one;
}

export type ChangeView = ChangeSet & { live: boolean; writeMode?: string; checks?: { key: string; ok: boolean; note: string }[]; spendTodayAfter?: number };

export async function loadChanges(): Promise<ChangeView[]> {
  if (process.env.MOCK_MODE === "1") return CHANGES.map((c) => ({ ...c, live: false }));
  const rows = await db.changeSet.findMany({ where: { state: { notIn: ["draft"] } }, include: { items: true }, orderBy: { createdAt: "desc" }, take: 60 });
  return rows.map((r) => ({
    id: r.id,
    state: (r.state === "simulated" ? "pending_approval" : r.state === "rejected" ? "rolled_back" : r.state === "approved" || r.state === "executing" ? "executed" : r.state) as ChangeSet["state"],
    by: r.source === "rule" ? RULE_AR[r.sourceRef ?? ""] ?? "قاعدة" : BY[r.source] ?? r.source,
    reasonCode: r.reasonCode,
    sentence: r.error === "loop_guard" ? `${r.sentence} — ⚠️ انعكس القرار مرتين خلال 48 ساعة، بدو مراجعتك` : r.sentence,
    target: r.items.length === 1 ? r.items[0]!.objectId : `${r.items.length} عناصر`,
    before: side(r.items, "before"),
    after: side(r.items, "after"),
    spendDeltaDaily: Number(r.spendDeltaDaily),
    at: when(r.createdAt),
    auto: r.source === "rule" && r.state !== "pending_approval",
    live: true,
    writeMode: r.writeMode,
    checks: (r.simulation as { checks?: ChangeView["checks"] } | null)?.checks,
    spendTodayAfter: (r.simulation as { spendTodayAfter?: number } | null)?.spendTodayAfter,
  }));
}
