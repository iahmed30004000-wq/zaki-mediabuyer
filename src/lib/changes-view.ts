/**
 * The change sets as the screens draw them: the demo list, or the real ones from the database (MOCK_MODE=0),
 * mapped to the same card shape.
 */
import { db } from "@/server/db";
import { reachedMeta } from "@/core/reached-meta";
import { CHANGES, type ChangeSet } from "@/lib/mock/data";

const BY: Record<string, string> = { rule: "قاعدة", agent: "وكيل", user: "إنت", kill_switch: "الإيقاف الكامل", telegram: "تيليجرام" };
const RULE_AR: Record<string, string> = {
  loser_no_orders: "قاعدة الخاسر", loser_no_confirmed: "قاعدة الخاسر بلا مؤكد", high_cpa: "قاعدة تكلفة المؤكد", high_return: "قاعدة المرتجع",
  daily_cap: "قاعدة السقف اليومي", spend_spike: "قاعدة قفزة الصرف", stock_out: "قاعدة المخزون", scale: "سلّم التكبير",
};

const when = (d: Date) => new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(d);

function side(items: { op: string; objectType?: string; before: unknown; after: unknown }[], key: "before" | "after"): string {
  const i = items[0];
  if (!i) return "—";
  if (i.op === "create") {
    // a launch: nothing before it; after it, what gets made (paused first, switched on after the check)
    const made = items.filter((x) => x.op === "create");
    const n = (t: string) => made.filter((x) => (x as { objectType?: string }).objectType === t).length;
    return key === "before" ? "ما في شي" : `حملة · ${n("adset")} مجموعة · ${n("ad")} إعلان`;
  }
  const v = (key === "before" ? i.before : i.after) as { status?: string; dailyBudget?: number };
  const one = v.dailyBudget !== undefined && i.op === "set_budget" ? `${v.dailyBudget}$ باليوم` : v.status === "PAUSED" ? "موقوف" : v.status ? "شغّال" : "—";
  return items.length > 1 ? `${one} (+${items.length - 1})` : one;
}

/** The states as they are in the database (R-22 · U-15): a rejected change is «رفضت», not «انرجع»; one that was approved but is not done yet is «عم يتنفّذ», not «تنفّذ». */
export type ChangeViewState = ChangeSet["state"] | "rejected" | "executing";

export type ChangeView = Omit<ChangeSet, "state"> & { state: ChangeViewState; /** it really went to Meta (never for a trial) */ reached: boolean; live: boolean; atIso?: string; launch?: boolean; writeMode?: string; checks?: { key: string; ok: boolean; note: string }[]; spendTodayAfter?: number };

/** The stored state in the words the screens use: only what is really so (a proposal that waits is «بانتظار», an approved one that has not run is «عم يتنفّذ»). */
export function changeViewState(state: string): ChangeViewState {
  if (state === "simulated" || state === "draft") return "pending_approval";
  if (state === "approved" || state === "executing") return "executing";
  if (state === "pending_approval" || state === "executed" || state === "rolled_back" || state === "rejected" || state === "failed") return state;
  return "failed";
}

export async function loadChanges(): Promise<ChangeView[]> {
  if (process.env.MOCK_MODE === "1") return CHANGES.map((c) => ({ ...c, reached: false, live: false }));
  const rows = await db.changeSet.findMany({ where: { state: { notIn: ["draft"] } }, include: { items: true }, orderBy: { createdAt: "desc" }, take: 60 });
  return rows.map((r) => ({
    id: r.id,
    state: changeViewState(r.state),
    reached: reachedMeta({ writeMode: r.writeMode, state: r.state }),
    by: r.source === "rule" ? RULE_AR[r.sourceRef ?? ""] ?? "قاعدة" : BY[r.source] ?? r.source,
    reasonCode: r.reasonCode,
    sentence: r.error === "loop_guard" ? `${r.sentence} — ⚠️ انعكس القرار مرتين خلال 48 ساعة، بدو مراجعتك` : r.sentence,
    target: r.items.length === 1 ? r.items[0]!.objectId : `${r.items.length} عناصر`,
    before: side(r.items, "before"),
    after: side(r.items, "after"),
    spendDeltaDaily: Number(r.spendDeltaDaily),
    at: when(r.createdAt),
    atIso: r.createdAt.toISOString(),
    launch: r.items.some((i) => i.op === "create"),
    auto: r.source === "rule" && r.state !== "pending_approval",
    live: true,
    writeMode: r.writeMode,
    checks: (r.simulation as { checks?: ChangeView["checks"] } | null)?.checks,
    spendTodayAfter: (r.simulation as { spendTodayAfter?: number } | null)?.spendTodayAfter,
  }));
}
