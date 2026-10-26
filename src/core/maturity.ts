/**
 * MATURE ORDERS (spec 6.6). The confirmation team works set hours, so a night order is confirmed
 * the next day. Every confirm-rate or confirmed-count rule uses MATURE orders only: an order whose
 * `confirm_window` has passed. Younger orders are «لسا مفتوح» and never feed a stop rule.
 */
export const DEFAULT_CONFIRM_WINDOW_H = 24;

export function maturesAt(createdAt: Date, windowHours = DEFAULT_CONFIRM_WINDOW_H): Date {
  return new Date(createdAt.getTime() + windowHours * 3_600_000);
}

export function isMature(createdAt: Date, now: Date, windowHours = DEFAULT_CONFIRM_WINDOW_H): boolean {
  return maturesAt(createdAt, windowHours).getTime() <= now.getTime();
}

export interface OrderLike {
  createdAt: Date;
  status: "new" | "confirmed" | "shipped" | "delivered" | "returned" | "canceled";
  isFake?: boolean;
}

const CONFIRMED_OR_LATER = new Set<OrderLike["status"]>(["confirmed", "shipped", "delivered", "returned"]);

/** Counts for the truth: all orders, mature ones, and confirmed among the mature. */
export function maturityCounts(orders: readonly OrderLike[], now: Date, windowHours = DEFAULT_CONFIRM_WINDOW_H) {
  let mature = 0;
  let confirmedMature = 0;
  let open = 0;
  for (const o of orders) {
    if (isMature(o.createdAt, now, windowHours)) {
      mature++;
      if (CONFIRMED_OR_LATER.has(o.status)) confirmedMature++;
    } else open++;
  }
  return { orders: orders.length, mature, confirmedMature, open };
}
