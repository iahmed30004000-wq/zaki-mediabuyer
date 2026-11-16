/**
 * How many decisions wait for the owner — the red number beside «بانتظارك». A cheap count on every page (two `count`s, no rows);
 * P3 replaces it with the inbox's own count (`src/server/inbox.ts`) so the number and the list can never disagree.
 */
import { db } from "@/server/db";
import { loadChanges } from "./changes-view";

export async function countWaiting(): Promise<number> {
  try {
    if (process.env.MOCK_MODE === "1") return (await loadChanges()).filter((c) => c.state === "pending_approval").length;
    const [changes, asks] = await Promise.all([db.changeSet.count({ where: { state: { in: ["pending_approval", "simulated"] } } }), db.approval.count({ where: { status: { in: ["pending", "postponed"] } } })]);
    return changes + asks;
  } catch {
    // a database that does not answer must not break every page: no number is shown
    return 0;
  }
}
