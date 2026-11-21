/**
 * The server side of the permission filter: what a view model carries to the browser depends on the caller's role. Outside a request (the night round, a test,
 * a job) there is no caller and nothing is stripped — those read the real numbers to decide; only what is built for a screen goes through here.
 */
import { stripMoney } from "@/core/redact-money";
import { can, type RoleKey } from "@/core/roles";
import { currentCaller } from "./auth";

/**
 * The role of whoever is looking, or null outside a request (a job, a test): nothing is filtered for those. Inside a request with nobody signed in it answers the least role there is.
 */
export async function viewerRole(): Promise<RoleKey | null> {
  try {
    return (await currentCaller())?.role ?? "MEMBER";
  } catch {
    return null;
  }
}

export async function forViewer<T>(data: T): Promise<T> {
  let caller;
  try {
    caller = await currentCaller();
  } catch {
    return data; // outside a request: no cookies, no caller
  }
  // inside a request the money is stripped unless the caller may see it; a job or a test has no request and reads the real numbers
  if (caller && can(caller.role, "money.view")) return data;
  return stripMoney(data);
}
