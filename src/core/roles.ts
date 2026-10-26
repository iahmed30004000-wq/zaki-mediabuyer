/**
 * ROLES (spec 13.8) — who may do what, as one table. Pure: the API checks it, the screens hide what is not allowed,
 * and tests/roles.test.ts holds every cell.
 */
export const ROLES = ["OWNER", "ADS_MANAGER", "ANALYST", "VIEWER"] as const;
export type RoleKey = (typeof ROLES)[number];

export const ROLE_AR: Record<RoleKey, string> = { OWNER: "المالك", ADS_MANAGER: "مدير الإعلانات", ANALYST: "المحلل", VIEWER: "مشاهد" };

export type Capability =
  | "view" // numbers and reports
  | "connect_meta" // link Facebook (ADS_MANAGER: their own account only — checked at the call)
  | "propose_change" // draft a ChangeSet
  | "pause_or_reduce" // safety actions
  | "approve_within_cap" // approve a raise inside the cap
  | "owner_only" // spend above the cap, a new campaign, autonomy level, rules, models, users
  | "kill_switch";

const MATRIX: Record<Capability, readonly RoleKey[]> = {
  view: ["OWNER", "ADS_MANAGER", "ANALYST", "VIEWER"],
  connect_meta: ["OWNER", "ADS_MANAGER"],
  propose_change: ["OWNER", "ADS_MANAGER", "ANALYST"],
  pause_or_reduce: ["OWNER", "ADS_MANAGER"],
  approve_within_cap: ["OWNER", "ADS_MANAGER"],
  owner_only: ["OWNER"],
  kill_switch: ["OWNER", "ADS_MANAGER"],
};

export function can(role: RoleKey, capability: Capability): boolean {
  return MATRIX[capability].includes(role);
}
