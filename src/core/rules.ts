/**
 * THE HOURLY WATCH (spec 6.4, v6 · P10 + D82) — pure: facts in, ALERTS out. The code decides what is wrong; nothing here touches Meta.
 *
 * Until P10 this file was a second rulebook: it paused, cut budgets and froze scaling every hour on numbers of its own. The rulebook that
 * judges ads, ad sets and products is still the night round alone (src/core/rulebook.ts, reading the owner's `campaign.rules`). What is here:
 *   • the account's spend today (an Amman day) against its cap — and, since D82, the job stops the account's campaigns at the cap;
 *   • a spend spike against the daily budgets the account actually planned (ad sets AND campaign budgets) — since D82, a 30% cut;
 *   • stale data — said as an alert, and the night round refuses to decide on it (no freeze row that expires);
 *   • fake or wrong-number orders on one ad (alert only).
 * A sentence here is the FACT only. What was done about it is added from what really happened (outcomeSentence), never assumed.
 */
import { fmt, fmtExact } from "@/lib/format";

export type RuleKey = "daily_cap" | "spend_spike" | "stale_data" | "fake_orders";

export interface Alert {
  rule: RuleKey;
  level: "ad" | "account";
  targetId: string;
  tone: "danger" | "warn";
  sentence: string;
}

export interface AdWatchFacts {
  adId: string;
  orders: number;
  fakeOrders: number;
}

export interface AccountFacts {
  accountId: string;
  /** spend of the Amman day so far, the card fee already added by the caller: what the cap is read against */
  spendToday: number;
  /** v6 · D82: Meta's own spend today (no fee) of the ads that sit under a running DAILY budget — what a spike is read against. A paused or
   *  lifetime-budget ad is not in the planned sum, so it is not in this one either */
  budgetedSpend: number;
  dailyCap: number | null;
  hourSpend: number;
  avgHourSpend7d: number;
  /** what the account planned per day: every active ad set budget plus every active campaign budget */
  dailyBudgetsSum: number;
  /** hours since the last successful pull of Meta AND of the OMS (the older one) */
  dataAgeHours: number;
  /** v6 · P11: set when these figures are NOT dollars (an account of another currency with no rate): the unit the sentences write */
  unit?: string | null;
}

export const WATCH = { spikeHourX: 3, spikeDayX: 1.75, staleHours: 2, fakeShare: 0.3, fakeMinOrders: 10, reducePct: 0.3, tries: 3 };

export function watchAd(a: AdWatchFacts): Alert[] {
  if (a.orders >= WATCH.fakeMinOrders && a.fakeOrders / a.orders >= WATCH.fakeShare) {
    return [{ rule: "fake_orders", level: "ad", targetId: a.adId, tone: "warn", sentence: `${a.fakeOrders} من ${a.orders} طلب من هالإعلان وهمية أو أرقام غلط — الأحسن توقفه.` }];
  }
  return [];
}

export function watchAccount(a: AccountFacts): Alert[] {
  const out: Alert[] = [];
  const money = (n: number) => (a.unit ? `${fmtExact(n, "", 2)} ${a.unit}` : fmt(n, "$"));
  // a cap of 0 is a cap not typed: it must never read as «stop everything»
  if (a.dailyCap !== null && a.dailyCap > 0 && a.spendToday >= a.dailyCap) {
    out.push({ rule: "daily_cap", level: "account", targetId: a.accountId, tone: "danger", sentence: `صرف اليوم ${money(a.spendToday)} وصل سقف الحساب ${money(a.dailyCap)}.` });
  }
  const hourSpike = a.avgHourSpend7d > 0 && a.hourSpend > WATCH.spikeHourX * a.avgHourSpend7d;
  // Meta itself may spend up to 1.75 × a daily budget on one day: only what is ABOVE that, on Meta's own figure, is a spike
  const daySpike = a.dailyBudgetsSum > 0 && a.budgetedSpend > WATCH.spikeDayX * a.dailyBudgetsSum;
  if (hourSpike || daySpike) {
    const why = hourSpike ? `ساعة صرفت ${money(a.hourSpend)} (المعتاد ${money(a.avgHourSpend7d)})` : `صرف اليوم ${money(a.budgetedSpend)} فوق ${WATCH.spikeDayX} × مجموع الميزانيات ${money(a.dailyBudgetsSum)}`;
    out.push({ rule: "spend_spike", level: "account", targetId: a.accountId, tone: "danger", sentence: `قفزة صرف: ${why}.` });
  }
  if (a.dataAgeHours > WATCH.staleHours) {
    out.push({ rule: "stale_data", level: "account", targetId: a.accountId, tone: "warn", sentence: `البيانات متأخرة ${Number.isFinite(a.dataAgeHours) ? Math.round(a.dataAgeHours) : "؟"} ساعات — جولة الليل ما بتقرر على أرقام قديمة لحد ما ترجع.` });
  }
  return out;
}

// ───────────────────────────── the safety stop (D82) ─────────────────────────────

/** The two rules the hourly job acts on, and what each does. */
export type SafetyRule = "daily_cap" | "spend_spike";
export const SAFETY_ACTION: Record<SafetyRule, "pause" | "reduce"> = { daily_cap: "pause", spend_spike: "reduce" };
export const isSafetyRule = (r: RuleKey): r is SafetyRule => r === "daily_cap" || r === "spend_spike";

/** Why the job did not even propose a change. */
export type Held =
  | "handled_today" // a change for this rule already exists today (whatever its fate): never twice, and the owner's «رجّع» stands
  | "gave_up" // it failed `WATCH.tries` times today
  | "cap_first" // the account is at its cap: the stop decides, not the cut
  | "stale_meta" // a cut is computed from budgets; old ones are not good enough
  | "foreign_money" // the site writes dollars only
  | "nothing_running";

/** What really happened. `state` is the stored change's own state. */
export type Outcome =
  | { held: Held; currency?: string }
  | { held?: undefined; state: string; writeMode: string; done: number; total: number; lastTry?: boolean };

export function outcomeSentence(rule: SafetyRule, o: Outcome): string {
  const pause = SAFETY_ACTION[rule] === "pause";
  const pct = `${Math.round(WATCH.reducePct * 100)}%`;
  if (o.held !== undefined) {
    const why: Record<Held, string> = {
      handled_today: "انعمل قرار لهالسبب اليوم، وما بعيده: القرار إلك.",
      gave_up: `حاولت ${WATCH.tries} مرات اليوم وما زبط. ${pause ? "وقّف" : "خفّض"} من مدير الإعلانات هلق.`,
      cap_first: "ما خفّضت: الحساب واصل سقفه، وقرار السقف هو اللي بيمشي.",
      stale_meta: "ما خفّضت: أرقام ميتا متأخرة. شوف الحساب.",
      foreign_money: `ما خفّضت: الحساب بعملة ${o.currency ?? "غير الدولار"} والموقع بيغيّر ميزانيات الدولار بس. وقّف من الموقع إذا بدك.`,
      nothing_running: "ما لقيت شي شغّال بنسخة الموقع. شوف الحساب بمدير الإعلانات.",
    };
    return why[o.held];
  }
  const what = pause ? `${o.total} حملة` : `${o.total} ميزانية`;
  if (o.state === "executed") {
    if (o.writeMode !== "live") return `تجربة: كان لازم ${pause ? `أوقّف ${what}` : `أخفّض ${what} ${pct}`}، بس الكتابة على ميتا مقفولة، فما تغيّر شي. اعملها من مدير الإعلانات إذا بدك.`;
    return pause ? `وقّفت ${what}. بتضل موقّفة لحد ما ترجّعها إنت.` : `خفّضت ${what} ${pct}. بتضل هيك لحد ما ترجّعها إنت.`;
  }
  if (o.state === "pending_approval") return "ما تغيّر شي لسا: القرار بانتظار موافقتك.";
  if (o.state === "simulated") return "ما تغيّر شي: الحساب بمستوى «مستشار» (أو عليه تنبيه سلامة)، فهاد اقتراح بس.";
  if (o.state === "failed") return `ما اكتمل: ${o.done} من ${o.total} ${pause ? "انوقفوا" : "انخفّضوا"}. ${o.lastTry ? "ما رح أجرّب مرة تانية اليوم" : "بجرّب كمان مرة الساعة الجاية"}، وشوف الحساب هلق.`;
  return "القرار لسا عم يتنفّذ — شوف الحساب.";
}
