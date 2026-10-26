/**
 * The CAPI acceptance run (spec 14 T4.3) against the pretend Meta and OMS, on the local database:
 *   1. orders become events once — a second run queues nothing (the same event never twice);
 *   2. an event older than 7 days is dropped before sending;
 *   3. the rest are sent, and only Meta's answer is kept — no phone, no click id, no hash in the database.
 * `npx tsx --env-file=.env scripts/demo-capi.ts` (run `npm run demo:pipeline` first)
 */
import { db } from "../src/server/db";
import { enqueueCapi, sendCapi } from "../src/jobs/capi";
import { fakeFetch, FAKE_OMS_URL } from "../src/adapters/fixtures";
import { MetaClient } from "../src/meta/client";

const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) process.exitCode = 1;
};

(async () => {
  await db.capiEvent.deleteMany();
  const now = new Date();
  const f = fakeFetch(now);
  // one old order to prove the 7-day limit
  const old = await db.attributedOrder.findFirstOrThrow({ where: { confirmedAt: { not: null } } });
  await db.attributedOrder.update({ where: { id: old.id }, data: { confirmedAt: new Date(now.getTime() - 9 * 86_400_000) } });

  const first = await enqueueCapi(now);
  const second = await enqueueCapi(now);
  check(first.queued > 0 && second.queued === 0, `1. ${first.queued} events queued from ${first.orders} orders · a second run queued ${second.queued}`);
  const expired = await db.capiEvent.count({ where: { state: "expired" } });
  check(expired >= 1, `2. ${expired} event(s) older than 7 days marked expired, never sent`);

  const r = await sendCapi({ meta: new MetaClient({ token: "demo", fetch: f, sleep: async () => {} }), oms: { baseUrl: FAKE_OMS_URL, token: "demo", fetch: f }, datasetId: "PX_DEMO", now });
  check(r.sent > 0 && r.rejected === 0, `3. sent ${r.sent} · skipped ${r.skipped} · rejected ${r.rejected}`);
  const stored = JSON.stringify(await db.capiEvent.findMany());
  check(!/\+9639|fb\.1\.|"ph"|ctwa/.test(stored), "   …and the database holds only Meta's answer (no phone, no click id, no hash)");
  const again = await sendCapi({ meta: new MetaClient({ token: "demo", fetch: f, sleep: async () => {} }), oms: { baseUrl: FAKE_OMS_URL, token: "demo", fetch: f }, datasetId: "PX_DEMO", now });
  check(again.sent === 0, "   …a second send sends nothing");
  await db.attributedOrder.update({ where: { id: old.id }, data: { confirmedAt: old.confirmedAt } });
  process.exit();
})();
