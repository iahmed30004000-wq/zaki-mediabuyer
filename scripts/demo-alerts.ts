/**
 * Instant alerts (spec 12.3) on the local database: a condition is raised on the second reading in a row, an event
 * (a change with spend waiting) at once, and every unsent alert goes to Telegram in ONE message — here to a pretend
 * Telegram that records what it would send. `npx tsx --env-file=.env scripts/demo-alerts.ts`
 */
import { db } from "../src/server/db";
import { readAlerts, sendAlerts } from "../src/jobs/alerts";
import { propose } from "../src/server/changes";

const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) process.exitCode = 1;
};

(async () => {
  await db.alertState.deleteMany();
  await db.alert.updateMany({ where: { sentAt: null }, data: { sentAt: new Date() } });
  // a change with spend that waits for the owner → an instant alert
  const adset = await db.adSet.findFirstOrThrow({ where: { dailyBudget: { gt: 0 } } });
  await propose({ source: "user", reasonCode: "S11", sentence: "زيادة تجريبية للتنبيه", kind: "raise_step", items: [{ op: "set_budget", objectType: "adset", objectId: adset.metaId, before: { dailyBudget: Number(adset.dailyBudget) }, after: { dailyBudget: Number(adset.dailyBudget) + 5 } }] }, { type: "user", id: "demo-owner" });
  // an attribution report under 70% → a condition alert (needs two readings)
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  await db.report.upsert({ where: { kind_forDate: { kind: "attribution", forDate: today } }, create: { kind: "attribution", forDate: today, text: JSON.stringify({ attributed_pct: 55, gaps: [], attribution_health: "broken" }) }, update: { text: JSON.stringify({ attributed_pct: 55, gaps: [], attribution_health: "broken" }) } });

  const t0 = new Date();
  const r1 = await readAlerts(t0);
  const kinds1 = (await db.alert.findMany({ where: { sentAt: null } })).map((a) => a.kind);
  check(kinds1.includes("alert.approval") && !kinds1.includes("alert.attribution"), `1. first reading (${r1.signals} signals): the waiting approval at once, the weak attribution not yet`);
  const r2 = await readAlerts(new Date(t0.getTime() + 15 * 60_000));
  const kinds2 = (await db.alert.findMany({ where: { sentAt: null } })).map((a) => a.kind);
  const mine = await db.alert.count({ where: { text: { contains: "زيادة تجريبية للتنبيه" }, createdAt: { gte: t0 } } });
  check(kinds2.includes("alert.attribution") && mine === 1, `2. second reading (${r2.raised} raised): the weak attribution now — and the same approval not twice (${mine})`);
  await readAlerts(new Date(t0.getTime() + 30 * 60_000));
  check((await db.alert.count({ where: { sentAt: null, kind: "alert.attribution" } })) === 1, "   …a third reading raises nothing again");

  let sent = "";
  const fakeTelegram = { token: "demo", chatId: "1", fetch: (async (_: unknown, init?: RequestInit) => { sent += JSON.parse(String(init?.body)).text; return new Response("{}"); }) as typeof fetch };
  const s = await sendAlerts(fakeTelegram);
  check(s.sent >= 2 && sent.startsWith("تنبيهات الميديا باير") && sent.includes("إسناد ضعيف") && sent.includes("بانتظار موافقتك"), `3. one Telegram message with ${s.sent} alerts:\n      ${sent.split("\n").slice(0, 4).join("\n      ")}`);
  check((await sendAlerts(fakeTelegram)).sent === 0, "   …and nothing is sent twice");
  await db.report.deleteMany({ where: { kind: "attribution", forDate: today } });
  await db.changeSet.updateMany({ where: { sentence: "زيادة تجريبية للتنبيه", state: "pending_approval" }, data: { state: "rejected" } });
  process.exit();
})();
