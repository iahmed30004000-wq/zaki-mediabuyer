/**
 * The campaign rules v2 as the owner edits them and Claude reads them (v4 · F). A rule changes only through here:
 * validated, versioned (every save is a new version that can be restored), audited.
 */
import { CampaignRulesSchema, describeRules, missingRules, readRules, type CampaignRules } from "@/core/rules-v2";
import { db } from "./db";
import { getSetting, setSetting } from "./settings";

export interface RulesView {
  rules: CampaignRules;
  version: number;
  updatedAt: string | null;
  text: string[];
  missing: { key: string; label: string }[];
}

export async function getRules(): Promise<RulesView> {
  const row = await db.setting.findUnique({ where: { key: "campaign.rules" } });
  const rules = readRules(row?.value ?? (await getSetting("campaign.rules")));
  return { rules, version: row?.version ?? 0, updatedAt: row?.updatedAt.toISOString() ?? null, text: describeRules(rules), missing: missingRules(rules) };
}

/** Saves the whole rule set. Throws a ZodError (the caller turns it into words) when a value is not acceptable. */
export async function saveRules(next: unknown, by: string | null): Promise<RulesView> {
  const ok = CampaignRulesSchema.parse(next);
  await setSetting("campaign.rules", ok, by);
  return getRules();
}
