/**
 * THE OPERATIONS NUMBERS (docs/rebuild/06-dashboards.md §4): the funnel an order walks, and the flag beside a team member. Pure. Nothing here has
 * a number of its own: the limits that decide a flag are the owner's (`ops.rules`), and until he writes them there is no flag at all.
 */

export interface FunnelInput {
  ordersIn: number | null;
  confirmed: number | null;
  /** from the shipments check's own numbers (`metrics.landed`); null hides the step */
  landed: number | null;
  shippedOrders: number | null;
  delivered: number | null;
}

export interface FunnelStep {
  key: "in" | "confirmed" | "landed" | "shipped" | "delivered";
  label: string;
  value: number | null;
  /** the share of the step before it (one decimal), or null when either is unknown or the one before is zero */
  pctOfPrev: number | null;
}

const ROUND1 = (n: number) => Math.round(n * 10) / 10;

/** دخل ← مؤكد ← نزل على الشحن ← انشحن ← تسلّم. The «landed» step is left out when it is not known (no guess). Each carries its share of the step before. */
export function funnel(i: FunnelInput): FunnelStep[] {
  const raw: Omit<FunnelStep, "pctOfPrev">[] = [
    { key: "in", label: "دخل", value: i.ordersIn },
    { key: "confirmed", label: "مؤكد", value: i.confirmed },
    ...(i.landed !== null ? [{ key: "landed" as const, label: "نزل على الشحن", value: i.landed }] : []),
    { key: "shipped", label: "انشحن", value: i.shippedOrders },
    { key: "delivered", label: "تسلّم", value: i.delivered },
  ];
  return raw.map((s, n) => {
    const prev = n ? raw[n - 1]!.value : null;
    return { ...s, pctOfPrev: s.value !== null && prev !== null && prev > 0 ? ROUND1((s.value / prev) * 100) : null };
  });
}

/** The owner's limits for the flags. All empty by default: no limit written = no flag. */
export interface OpsRules {
  /** more than this stuck over 48 hours = «عالق كتير» */
  stuckMax: number | null;
  /** how far above the team's median «ما ردّ» rate counts as high (a share, e.g. 0.1 = 10 points) */
  noAnswerMargin: number | null;
  /** fewer than this many days of numbers = «جديد» */
  newDays: number | null;
}
export const EMPTY_OPS_RULES: OpsRules = { stuckMax: null, noAnswerMargin: null, newDays: null };

export function readOpsRules(v: unknown): OpsRules {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null);
  return { stuckMax: n(o.stuckMax), noAnswerMargin: n(o.noAnswerMargin), newDays: n(o.newDays) };
}

export type FlagKey = "new" | "stuck" | "noanswer" | "fine";
export interface PersonFlag {
  key: FlagKey;
  label: string;
  tone: "ok" | "warn" | "danger" | "info";
}

const FLAGS: Record<FlagKey, PersonFlag> = {
  new: { key: "new", label: "جديد", tone: "info" },
  stuck: { key: "stuck", label: "عالق كتير", tone: "danger" },
  noanswer: { key: "noanswer", label: "ما ردّ عالي", tone: "warn" },
  fine: { key: "fine", label: "منيح", tone: "ok" },
};

export interface PersonInput {
  claims: number | null;
  noAnswer: number | null;
  stuck48h: number | null;
  /** how many days of numbers the person has */
  daysOfData: number;
}

/** The share of the claims that did not answer, or null when it cannot be said. */
export const noAnswerRate = (p: Pick<PersonInput, "claims" | "noAnswer">): number | null => (p.claims && p.noAnswer !== null ? p.noAnswer / p.claims : null);

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * The flag beside a person: «جديد» (fewer days of numbers than the owner said) → «عالق كتير» (stuck over his limit) → «ما ردّ عالي» (the «ما ردّ»
 * rate above the team's median by his margin) → «منيح» (checked, nothing). No limit written (all three empty) = no flag; a limit that is missing is skipped.
 */
export function personFlag(p: PersonInput, teamMedianNoAnswer: number | null, rules: OpsRules): PersonFlag | null {
  if (rules.stuckMax === null && rules.noAnswerMargin === null && rules.newDays === null) return null;
  if (rules.newDays !== null && p.daysOfData < rules.newDays) return FLAGS.new;
  if (rules.stuckMax !== null && p.stuck48h !== null && p.stuck48h > rules.stuckMax) return FLAGS.stuck;
  const rate = noAnswerRate(p);
  if (rules.noAnswerMargin !== null && rate !== null && teamMedianNoAnswer !== null && rate > teamMedianNoAnswer + rules.noAnswerMargin) return FLAGS.noanswer;
  return FLAGS.fine;
}
