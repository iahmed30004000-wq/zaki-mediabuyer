/**
 * «شو عملنا»: what happened on the days of the chart (v6 · P6, docs/rebuild-v6/04-numbers.md §5). Reads the few tables that hold an event — the night round's own log, the changes that REALLY reached Meta, the
 * videos the bank took in, the standing orders — and hands them to `src/core/chart-events.ts`, which writes every sentence and decides what is drawn. A trial (`dry_run`) change is never asked for.
 * Read only; nothing here says one thing caused another.
 */
import { addDays, ammanInstant, ammanKey, keyMs } from "@/core/dates";
import { changeEvent, nightRoundEvent, orderEvents, videoEvents, type ChartEvent } from "@/core/chart-events";
import { isDemo } from "@/core/readiness";
import { nameOf, productLabels } from "@/core/product-name";
import { db } from "@/server/db";

export type { ChartEvent } from "@/core/chart-events";

/** The days the chart covers: the last `days` days ending yesterday (the line never draws the unfinished day). */
export const chartRange = (now: Date, days = 30): { from: string; to: string } => {
  const to = addDays(ammanKey(now), -1);
  return { from: addDays(to, -(days - 1)), to };
};

/** What we did on the days of a range, the oldest first. The demo has no history of its own: nothing is drawn rather than something made up. */
export async function loadEvents(range: { from: string; to: string }): Promise<ChartEvent[]> {
  if (isDemo(process.env)) return [];
  // the days are Amman days: from its first midnight to the midnight after its last day
  const gte = ammanInstant(range.from, "00:00") ?? new Date(keyMs(range.from));
  const lt = ammanInstant(addDays(range.to, 1), "00:00") ?? new Date(keyMs(addDays(range.to, 1)));
  const [rounds, changes, videos, orders, econ, aliases] = await Promise.all([
    db.workflowRun.findMany({ where: { workflow: { key: "night-round" }, startedAt: { gte, lt } }, orderBy: { startedAt: "asc" }, select: { id: true, startedAt: true, metrics: true, workflow: { select: { key: true } } } }),
    db.changeSet.findMany({ where: { state: "executed", writeMode: "live", executedAt: { gte, lt } }, orderBy: { executedAt: "asc" }, select: { id: true, kind: true, sentence: true, writeMode: true, state: true, executedAt: true } }),
    db.videoBankItem.findMany({ where: { createdAt: { gte, lt } }, select: { productCode: true, createdAt: true } }),
    db.standingOrder.findMany({ where: { OR: [{ startsAt: { gte, lt } }, { endedAt: { gte, lt } }] }, select: { id: true, text: true, startsAt: true, endedAt: true, status: true } }),
    db.productEconomics.findMany({ select: { productCode: true, name: true } }),
    db.productAlias.findMany({ select: { productCode: true, alias: true } }),
  ]);
  const labels = productLabels(econ, aliases);
  const events: ChartEvent[] = [
    ...rounds.map((r) => nightRoundEvent({ id: r.id, day: ammanKey(r.startedAt), jobKey: r.workflow.key, metrics: r.metrics })),
    ...changes.map((c) => changeEvent({ id: c.id, kind: c.kind, sentence: c.sentence, writeMode: c.writeMode, state: c.state, day: ammanKey(c.executedAt ?? new Date(0)) })),
    ...videoEvents(videos.map((v) => ({ productCode: v.productCode, day: ammanKey(v.createdAt) })), (code) => nameOf(labels, code)),
    ...orderEvents(orders.map((o) => ({ id: o.id, text: o.text, startsDay: ammanKey(o.startsAt), endedDay: o.endedAt ? ammanKey(o.endedAt) : null, status: o.status })), range.from, range.to),
  ].filter((e): e is ChartEvent => e !== null && e.day >= range.from && e.day <= range.to);
  return events.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}
