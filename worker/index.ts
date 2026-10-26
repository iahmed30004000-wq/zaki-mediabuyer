/**
 * THE WORKER (spec 13.3 / 13.6) — one loop, once a minute, Asia/Amman time. Each job has a slot name; `runOnce`
 * makes a slot run at most once even with two workers or a restart. A job whose link is not configured yet skips
 * itself (and says why in its run stats), so the worker can run from day one.
 *
 *   meta.sync      every 30 min 08:00–24:00, every 2 h at night — yesterday and today
 *   meta.final     03:00 — yesterday + the last 7 days again (the archive)
 *   oms.sync       every hour at :05
 *   truth.compute  every hour at :10, and 07:00 for the last 7 days
 *   report.morning 09:00 — built by code, sent to Telegram
 *   `npm run worker`
 */
import { runOnce } from "../src/jobs/runner";
import { syncMeta } from "../src/jobs/meta-sync";
import { computeTruthDays, omsOptions, syncOms } from "../src/jobs/truth";
import { buildMorningReport } from "../src/jobs/morning-report";
import { omsBackoff } from "../src/jobs/oms-health";
import { sendTelegram, telegramFromEnv } from "../src/adapters/telegram";
import { db } from "../src/server/db";

const DAY = 86_400_000;

function amman(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Amman", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utcDay = (s: string) => new Date(`${s}T00:00:00Z`);

export async function tick(now = new Date()) {
  const t = amman(now);
  const yesterday = iso(new Date(utcDay(t.date).getTime() - DAY));
  const halfHour = `${t.date}T${String(t.hour).padStart(2, "0")}:${t.minute < 30 ? "00" : "30"}`;
  const day = t.hour >= 8;

  if (day || t.hour % 2 === 0) {
    await runOnce("meta.sync", day ? halfHour : `${t.date}T${t.hour}`, () => syncMeta({ since: yesterday, until: t.date }));
  }
  if (t.hour === 3) await runOnce("meta.final", t.date, () => syncMeta({ since: iso(new Date(utcDay(t.date).getTime() - 8 * DAY)), until: yesterday }));
  if (t.minute >= 5) {
    await runOnce("oms.sync", `${t.date}T${t.hour}`, async () => {
      const o = omsOptions();
      if (!o) return { skipped: "OMS link off (OMS_LIVE / npm run oms:link)" };
      // After failures, leave the OMS alone for 1 h, 2 h, 4 h, then 8 h (src/jobs/oms-health.ts).
      const runs = await db.jobRun.findMany({ where: { job: "oms.sync" }, orderBy: { startedAt: "desc" }, take: 48 });
      const back = omsBackoff(runs, now);
      if (back.wait) return { skipped: "backoff", backoff: true, failures: back.failures, until: back.until?.toISOString() };
      return syncOms(o, new Date(now.getTime() - 3 * DAY));
    });
  }
  if (t.minute >= 10) await runOnce("truth.compute", `${t.date}T${t.hour}`, () => computeTruthDays(utcDay(yesterday), utcDay(t.date), now));
  if (t.hour === 7) await runOnce("truth.week", t.date, () => computeTruthDays(new Date(utcDay(t.date).getTime() - 7 * DAY), utcDay(t.date), now));
  if (t.hour >= 9) {
    await runOnce("report.morning", t.date, async () => {
      const text = await buildMorningReport(utcDay(yesterday));
      await db.report.upsert({ where: { kind_forDate: { kind: "morning", forDate: utcDay(yesterday) } }, create: { kind: "morning", forDate: utcDay(yesterday), text }, update: { text } });
      const tg = telegramFromEnv();
      if (!tg) return { skipped: "Telegram not linked yet (P0.7)", chars: text.length };
      await sendTelegram(tg, text);
      await db.report.update({ where: { kind_forDate: { kind: "morning", forDate: utcDay(yesterday) } }, data: { sentAt: new Date() } });
      return { sent: true, chars: text.length };
    });
  }
}

if (process.argv[1]?.includes("worker")) {
  console.log("worker started (Asia/Amman)");
  const loop = async () => {
    try {
      await tick();
    } catch (e) {
      console.error("tick failed:", e instanceof Error ? e.message : e);
    }
  };
  void loop();
  setInterval(loop, 60_000);
}
