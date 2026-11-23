/**
 * WHO OWNS AN OBJECT'S STATE (v6 · P10) — pure.
 *
 * The site keeps a copy of Meta's campaigns, ad sets and ads, filled by two doors: the Meta sync (the source of truth) and the agent's push
 * (a helper that may know an object the sync has not seen yet). The stop, «اوقف» and the scale ladder read an object's status, budget and parent
 * from the copy, so once Meta's sync has filled an object those three come from the sync only. A push still names, labels and creates what the
 * sync does not know.
 *
 * The sync always fills fields a push never writes: a campaign's `objective`, an ad set's `optimizationGoal`; an ad belongs to what its ad set belongs to.
 */
export const campaignOwnedByMeta = (c: { objective: string | null }): boolean => c.objective !== null;
export const adSetOwnedByMeta = (s: { optimizationGoal: string | null }): boolean => s.optimizationGoal !== null;

/** The fields of a row update a push is not allowed to carry for an object Meta's sync owns. */
export const PROTECTED_FIELDS = { campaign: ["status", "dailyBudget", "budgetType", "accountId"], adset: ["status", "dailyBudget", "campaignId"], ad: ["status", "adSetId"] } as const;

/** `data` without the protected fields when the object is Meta's; the names of what was dropped (to say so). */
export function withoutProtected<T extends Record<string, unknown>>(level: keyof typeof PROTECTED_FIELDS, data: T, owned: boolean): { data: Partial<T>; dropped: string[] } {
  if (!owned) return { data, dropped: [] };
  const out: Record<string, unknown> = { ...data };
  const dropped: string[] = [];
  for (const k of PROTECTED_FIELDS[level]) {
    if (k in out) {
      delete out[k];
      dropped.push(k);
    }
  }
  return { data: out as Partial<T>, dropped };
}
