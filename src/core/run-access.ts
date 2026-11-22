/**
 * What a role may read on the page of ONE run (v6 · P3): the same rules as the results screen (`getReport`) — the report, the numbers, the links and the summary
 * belong to the area of the job (`ads.view` or `ops.view`), the money numbers to `money.view` — and the decisions that wait on its steps belong to the inbox
 * (`inbox.view`, and only the areas the role's inbox holds). A role of null is a job or a test (it reads the real values), exactly as `viewerRole` says.
 */
import { isMoneyKey } from "./redact-money";
import { can, inboxDomainsOf, type RoleKey } from "./roles";

/** May this role read the result (report · numbers · links · summary) of a run of a job in this domain? */
export const canReadRunResult = (role: RoleKey | null, domain: string): boolean => !role || can(role, domain === "ops" ? "ops.view" : "ads.view");

/** The metrics of a run as this role may see them: no money keys without `money.view`. */
export function runMetricsFor(role: RoleKey | null, metrics: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!metrics || !role || can(role, "money.view")) return metrics;
  return Object.fromEntries(Object.entries(metrics).filter(([label]) => !isMoneyKey(label)));
}

/** May this role see a decision of this inbox area? Only when its inbox holds that area. */
export const canSeeRunApproval = (role: RoleKey | null, domain: "ads" | "ops" | "work"): boolean => !role || inboxDomainsOf(role).includes(domain);
