/**
 * INSTANT ALERTS (spec 12.3) — pure: the facts of the moment in, the alerts they call for out, each with a stable key.
 * «بلّغ بعد قراءتين متتاليتين»: a condition is raised only when two readings in a row see it (the state lives in
 * AlertState, src/jobs/alerts.ts) — except the instant ones (account, payment, rejection, a safety action, an
 * approval waiting), which go at once. Numbers are the code's; red is for danger only.
 */
export interface Signal {
  key: string;
  kind: string;
  tone: "danger" | "warn" | "info";
  text: string;
  href: string;
  instant?: boolean;
}

export interface AlertFacts {
  /** local hour (Asia/Amman) */
  hour: number;
  adsets: { id: string; name: string; dailyBudget: number; impressionsToday: number }[];
  pixelPurchasesToday: number;
  webOrdersToday: number;
  /** account-wide CPM today and on each of the last 7 days (with ≥ 1,000 impressions) */
  cpmToday: number | null;
  impressionsToday: number;
  cpm7: number[];
  metaLinked: boolean;
  omsLinked: boolean;
  metaAgeHours: number | null;
  omsAgeHours: number | null;
  attributedPct: number | null;
  capiRejectedLastHour: number;
  tokenDaysLeft: number | null;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : null;
};

export function detect(f: AlertFacts): Signal[] {
  const out: Signal[] = [];
  // no delivery: an active ad set with a budget and not one impression by midday (daily rows: hours can't be seen)
  if (f.hour >= 12 && f.hour < 23) {
    for (const s of f.adsets) {
      if (s.dailyBudget > 0 && s.impressionsToday === 0) out.push({ key: `delivery:${s.id}`, kind: "alert.no_delivery", tone: "warn", text: `ما في تسليم: ${s.name} شغّالة بميزانية ${s.dailyBudget}$ وصفر ظهور لهلأ اليوم`, href: "/ads" });
    }
  }
  // tracking: the pixel and the OMS disagree completely by the afternoon
  if (f.hour >= 14) {
    if (f.pixelPurchasesToday === 0 && f.webOrdersToday >= 3) out.push({ key: "tracking:pixel", kind: "alert.tracking", tone: "warn", text: `تتبع: ${f.webOrdersToday} طلب من الموقع بالـ OMS اليوم وصفر Purchase بالبكسل — البكسل أو صفحة الشكر فيها مشكلة`, href: "/reports" });
    if (f.webOrdersToday === 0 && f.pixelPurchasesToday >= 3 && f.omsLinked) out.push({ key: "tracking:oms", kind: "alert.tracking", tone: "warn", text: `تتبع: البكسل عدّ ${f.pixelPurchasesToday} Purchase اليوم والـ OMS صفر طلبات من الموقع — الطلبات مش واصلة أو معاملات الرابط ضايعة`, href: "/reports" });
  }
  // CPM: today more than twice the 7-day median (after 1,000 impressions)
  const m = median(f.cpm7);
  if (f.cpmToday !== null && m !== null && f.impressionsToday >= 1000 && f.cpmToday > 2 * m) out.push({ key: "cpm", kind: "alert.cpm", tone: "warn", text: `CPM اليوم ${f.cpmToday.toFixed(2)}$ أكتر من ضعف وسيط 7 أيام (${m.toFixed(2)}$)`, href: "/ads" });
  // a source that stopped
  if (f.metaLinked && (f.metaAgeHours === null || f.metaAgeHours > 2)) out.push({ key: "stale:meta", kind: "alert.stale", tone: "warn", text: `ميتا ما تحدّثت ${f.metaAgeHours === null ? "أبداً" : `من ${Math.round(f.metaAgeHours)} ساعات`} — التكبير مجمّد لحد ما ترجع`, href: "/settings#connections" });
  if (f.omsLinked && (f.omsAgeHours === null || f.omsAgeHours > 2)) out.push({ key: "stale:oms", kind: "alert.stale", tone: "warn", text: `الـ OMS ما تحدّث ${f.omsAgeHours === null ? "أبداً" : `من ${Math.round(f.omsAgeHours)} ساعات`} — قواعد الحقيقة مجمّدة لحد ما يرجع`, href: "/settings#connections" });
  // weak attribution
  if (f.attributedPct !== null && f.attributedPct < 70) out.push({ key: "attribution", kind: "alert.attribution", tone: "warn", text: `إسناد ضعيف: ${f.attributedPct}% بس من الطلبات واصلة لإعلانها (تحت 70%)`, href: "/reports" });
  // conversion events refused by Meta
  if (f.capiRejectedLastHour > 0) out.push({ key: "capi", kind: "alert.capi", tone: "warn", text: `${f.capiRejectedLastHour} حدث تحويل رفضته ميتا آخر ساعة — شوف «صحة البيانات»`, href: "/reports" });
  // the Meta token: 7 days before it ends, and at once when it ended
  if (f.tokenDaysLeft !== null && f.tokenDaysLeft <= 7) {
    out.push(f.tokenDaysLeft <= 0
      ? { key: "token", kind: "alert.token", tone: "danger", text: "توكن ميتا انتهى — كل حساب نزل للمستوى صفر لحد ما يتجدد", href: "/settings#connections", instant: true }
      : { key: "token", kind: "alert.token", tone: "warn", text: `توكن ميتا بينتهي بعد ${Math.ceil(f.tokenDaysLeft)} أيام — جدّده من الإعدادات`, href: "/settings#connections", instant: true });
  }
  return out;
}

export interface StateRow {
  key: string;
  count: number;
  lastSeenAt: Date;
  raisedAt: Date | null;
}

/**
 * One reading: which signals to raise now, and the state to keep. A signal seen in two readings in a row (≤ 40 min
 * apart) is raised once; a signal that disappears is forgotten, so it can be raised again if it comes back.
 */
export function reading(signals: Signal[], state: StateRow[], now: Date): { raise: Signal[]; keep: StateRow[] } {
  const raise: Signal[] = [];
  const keep: StateRow[] = [];
  for (const s of signals) {
    const prev = state.find((r) => r.key === s.key);
    const fresh = prev && now.getTime() - prev.lastSeenAt.getTime() <= 40 * 60_000;
    const count = fresh ? prev!.count + 1 : 1;
    const raisedAt = fresh ? prev!.raisedAt : null;
    const due = !raisedAt && (s.instant || count >= 2);
    if (due) raise.push(s);
    keep.push({ key: s.key, count, lastSeenAt: now, raisedAt: due ? now : raisedAt });
  }
  return { raise, keep };
}

/** The Telegram message for the alerts not sent yet: danger first, one line each, the site's link at the end. */
export function telegramText(alerts: { tone: string; text: string }[], siteUrl: string | null): string {
  const order = (t: string) => (t === "danger" ? 0 : t === "warn" ? 1 : 2);
  const lines = [...alerts].sort((a, b) => order(a.tone) - order(b.tone)).map((a) => `${a.tone === "danger" ? "🔴" : "🟠"} ${a.text}`);
  return ["تنبيهات الميديا باير", ...lines, ...(siteUrl ? ["", `افتح: ${siteUrl}`] : [])].join("\n");
}
