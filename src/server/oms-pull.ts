/**
 * «اسحب هلق» (v6 · P0-2, R-26) — the owner pulls the OMS now instead of waiting for the next hour: the orders of the last 3 days, then the truth of
 * yesterday and today, so the numbers show at once. It goes through the same `runOnce` ledger as the worker (slot = the minute), so a double click is one pull
 * and every pull is in the run log. A failure is said with its reason and counts like any failed pull (the back-off still protects the OMS).
 */
import { HttpError } from "./auth";
import { audit } from "./audit";
import { missingText } from "@/core/readiness";
import { ammanKey, addDays } from "@/core/dates";
import { omsOptions, syncOms, computeTruthDays } from "@/jobs/truth";
import { runOnce } from "@/jobs/runner";

const DAY = 86_400_000;
const utcDay = (s: string) => new Date(`${s}T00:00:00Z`);

export async function pullOmsNow(userId: string, now = new Date()): Promise<{ orders: number; sentence: string }> {
  const o = omsOptions();
  if (!o) throw new HttpError(409, missingText("oms") ?? "الـ OMS مش مربوط");
  const r = await runOnce("oms.sync", `manual-${Math.floor(now.getTime() / 60_000)}`, () => syncOms(o, new Date(now.getTime() - 3 * DAY)));
  if (!r) throw new HttpError(429, "في سحب صار قبل لحظات — استنى دقيقة");
  if (!r.ok) throw new HttpError(502, `ما انسحب من الـ OMS: ${(r.error ?? "ما انعرف السبب").slice(0, 200)}`);
  const today = ammanKey(now);
  await computeTruthDays(utcDay(addDays(today, -1)), utcDay(today), now);
  const orders = (r.stats as { orders?: number } | undefined)?.orders ?? 0;
  await audit({ type: "user", id: userId }, "oms.pull_now", { type: "connection", id: "oms" }, { after: { orders } });
  return { orders, sentence: `انسحب ${orders} طلب من الـ OMS` };
}
