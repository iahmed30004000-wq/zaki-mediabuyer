/**
 * THE CALCULATOR — spec sections 6.2, 6.3 and 17.1/17.2.
 *
 * The code computes every number; a model only explains. Everything is Decimal end to end and
 * rounded only when shown (`round2`), so 7.575 is 7.58 and never 7.57 from a float.
 * A ratio with a zero denominator is `null` («غير كافي»), never 0 and never Infinity.
 */
import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Num = Decimal.Value;
const D = (v: Num) => new Decimal(v);

function div(a: Decimal, b: Decimal): Decimal | null {
  return b.isZero() ? null : a.div(b);
}

/** For display: two decimals, half up. */
export function round2(v: Decimal | null): number | null {
  return v === null ? null : v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

/** A percentage for display: one decimal (73.3). */
export function pct1(v: Decimal | null): number | null {
  return v === null ? null : v.mul(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber();
}

// ───────────────────────────── the truth of one object (ad, ad set, campaign, product) ─────────────────────────────

export interface TruthInput {
  /** Meta spend in USD, before the card's FX fee. */
  spend: Num;
  /** Card / FX fee as a fraction (0.01 = 1%). */
  fxFee: Num;
  conversations?: Num;
  orders: Num;
  /** Confirmed among MATURE orders (6.6). */
  confirmed: Num;
  /** Mature orders (the denominator of the confirm rate). Defaults to `orders`. */
  matureOrders?: Num;
  shipments: Num;
  delivered: Num;
  returned: Num;
  /** Cash collected (or price × delivered when the OMS has no collected amount yet). */
  collected: Num;
  /** Delivery fees paid, per shipment × shipments, as one amount. */
  deliveryFees: Num;
  returnFees: Num;
  /** Unit cost × delivered. */
  cogsDelivered: Num;
  /** The open question of the owner (spec 6.3): 0.97 until he decides what the 3% is. */
  overheadFactor: Num;
}

export interface Truth {
  spendWithFee: Decimal;
  costPerConversation: Decimal | null;
  conversationToOrder: Decimal | null;
  costPerOrder: Decimal | null;
  confirmRate: Decimal | null;
  costPerConfirmed: Decimal | null;
  deliveryRate: Decimal | null;
  returnRate: Decimal | null;
  costPerDelivered: Decimal | null;
  netCollected: Decimal;
  lossLimit: Decimal | null;
  scalingCeiling: Decimal | null;
  profitAfterCosts: Decimal;
  profitPerDelivered: Decimal | null;
  trueRoas: Decimal | null;
}

/** 0.60 of the loss limit per shipment is the target cost per CONFIRMED order (6.3). */
export const CEILING_SHARE = new Decimal("0.60");

export function computeTruth(i: TruthInput): Truth {
  const spendWithFee = D(i.spend).mul(D(1).plus(i.fxFee));
  const orders = D(i.orders);
  const confirmed = D(i.confirmed);
  const shipments = D(i.shipments);
  const delivered = D(i.delivered);
  const netCollected = D(i.collected).minus(i.deliveryFees).minus(i.returnFees);
  const margin = netCollected.minus(i.cogsDelivered);
  const lossLimit = div(margin, shipments);
  const raw = margin.minus(spendWithFee);
  // the overhead factor only shaves a POSITIVE profit; a loss is shown whole
  const profitAfterCosts = raw.isPositive() ? raw.mul(i.overheadFactor) : raw;
  return {
    spendWithFee,
    costPerConversation: i.conversations === undefined ? null : div(spendWithFee, D(i.conversations)),
    conversationToOrder: i.conversations === undefined ? null : div(orders, D(i.conversations)),
    costPerOrder: div(spendWithFee, orders),
    confirmRate: div(confirmed, D(i.matureOrders ?? i.orders)),
    costPerConfirmed: div(spendWithFee, confirmed),
    deliveryRate: div(delivered, shipments),
    returnRate: div(D(i.returned), shipments),
    costPerDelivered: div(spendWithFee, delivered),
    netCollected,
    lossLimit,
    scalingCeiling: lossLimit === null ? null : lossLimit.mul(CEILING_SHARE),
    profitAfterCosts,
    profitPerDelivered: div(profitAfterCosts, delivered),
    trueRoas: div(netCollected, spendWithFee),
  };
}

// ───────────────────────────── before 50 shipments: the estimate (6.3) ─────────────────────────────

export interface EstimateInput {
  /** P: average collected per delivered order. */
  price: Num;
  /** G: unit cost of the goods. */
  unitCost: Num;
  /** S: shipping fee. */
  shipping: Num;
  /** R: return fee. */
  returnFee: Num;
  /** f: COD fee as a fraction. */
  codFee: Num;
  /** K: confirmation cost per order. */
  confirmCost: Num;
  /** C and D: conservative defaults (0.65 / 0.75) until real numbers arrive. */
  confirmRate: Num;
  deliveryRate: Num;
  /** profit_min as a fraction of M (0.30 = 30%). */
  profitMinShare: Num;
}

export interface Estimate {
  /** M: expected margin per order before ads. */
  margin: Decimal;
  tOrder: Decimal;
  tConfirmed: Decimal;
  tDelivered: Decimal;
  /** M ≤ 0: the product loses at these prices whatever the ads do — alert the owner. */
  losing: boolean;
}

/** M = C·D·P·(1−f) − C·D·G − C·S − C·(1−D)·R − K, then T_order = min(M − profit_min, 0.6·M). */
export function estimateTargets(i: EstimateInput): Estimate {
  const C = D(i.confirmRate);
  const Dr = D(i.deliveryRate);
  const CD = C.mul(Dr);
  const M = CD.mul(i.price).mul(D(1).minus(i.codFee))
    .minus(CD.mul(i.unitCost))
    .minus(C.mul(i.shipping))
    .minus(C.mul(D(1).minus(Dr)).mul(i.returnFee))
    .minus(i.confirmCost);
  const profitMin = M.mul(i.profitMinShare);
  const tOrder = Decimal.min(M.minus(profitMin), M.mul("0.6"));
  return {
    margin: M,
    tOrder,
    tConfirmed: tOrder.div(C),
    tDelivered: tOrder.div(CD),
    losing: M.lte(0),
  };
}
