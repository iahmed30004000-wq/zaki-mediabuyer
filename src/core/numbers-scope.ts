/**
 * WHAT THE SUMMARY SHOWS EACH ROLE (v6 · P6) — pure. «الأرقام ← الخلاصة» opens for a role that has the ads' numbers or the operations' (see `PAGE_RULES`), but it carries the ads' side too:
 * the spend, the cost of an order, every product's cost and verdict, and «شو عملنا». A role that only has `ops.view` is shown the operations' part and nothing else: the orders and
 * the confirmation, the journey of the order, and what is missing for the order numbers. The strip is done by the code, on the server, before anything is drawn.
 */
import { can, type RoleKey } from "./roles";

/** The metrics whose source is the orders, never the spend (they are the operations' numbers). */
export const OPS_TILE_KEYS: readonly string[] = ["orders", "confirmRate"];
/** The readiness items about the orders and the stock (the ads' ones are the spend, the break-even and the names). */
export const OPS_READINESS_KEYS: readonly string[] = ["orders", "stock"];

/** May this role see the ads' side of the summary (spend, cost, products, what we did)? */
export const seesAdsNumbers = (role: RoleKey): boolean => can(role, "ads.view");

interface Shape {
  tiles: readonly { key: string; now: number | null }[];
  readiness: readonly { key: string }[];
  products: readonly unknown[];
  series: Record<string, unknown>;
  target: number | null;
  breakeven: number | null;
  allMissing: boolean;
}

/**
 * The summary's data for this role: whole for a role with `ads.view`; for the others only the operations' tiles, the journey and the readiness of the orders. The products, the lines of the
 * chart, the target and the break-even are dropped, not hidden.
 */
export function compareForRole<C extends Shape>(c: C, role: RoleKey): C {
  if (seesAdsNumbers(role)) return c;
  const tiles = c.tiles.filter((t) => OPS_TILE_KEYS.includes(t.key));
  return {
    ...c,
    tiles,
    readiness: c.readiness.filter((r) => OPS_READINESS_KEYS.includes(r.key)),
    products: [],
    series: {},
    target: null,
    breakeven: null,
    allMissing: tiles.every((t) => t.now === null),
  };
}
