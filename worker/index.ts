/**
 * THE WORKER (spec 13.3 / 13.6) — one loop, once a minute, Asia/Amman time. Each job has a slot name; `runOnce`
 * makes a slot run at most once even with two workers or a restart. A job whose link is not configured yet skips
 * itself (and says why in its run stats), so the worker can run from day one.
 *
 *   meta.sync      every 30 min 08:00–24:00, every 2 h at night — yesterday and today
 *   meta.final     03:00 — yesterday + the last 7 days again (the archive)
 *   db.backup      02:30 — every table to STORAGE_DIR/backups/<day>, the last 14 kept (src/ops/backup.ts)
 *   oms.sync       every hour at :05
 *   truth.compute  every hour at :10, and 07:00 for the last 7 days
 *   rules          every hour at :15, after the truth — the safety rules (Phase 2), dry-run unless META_WRITE_MODE=live
 *   creative.intake every 15 min — Drive 01_inbox of every product (probe · MD5 · number · name · policy · thumbnails)
 *   meta.upload    every 15 min after the intake — ready videos to Meta (dry-run unless META_WRITE_MODE=live)
 *   account.safety every hour at :20 — account status, rejections (3 in 24 h freeze creation), appeal drafts
 *   analysis       08:00 — M02: each product's weakest funnel step (by code), in words by the agent
 *   creatives.week Saturday 09:45 — M06: one new-script request per product with its winning tags, for the studio
 *   attribution    08:00 — M09 by code: the Meta/truth gap per campaign, attribution share, CAPI acceptance
 *   capi.send      every 15 min — the truth back to Meta as conversion events (queued always, sent only when live)
 *   report.morning 09:00 — built by code, sent to Telegram
 *   safety.month   the 1st at 06:00 — the account cap on Meta reset for the new month (waits for the owner)
 *   creatives.fatigue 07:30 — a tired winner is marked and new hooks are queued for the studio (never paused)
 *   rules.scale    every hour at :17, after the safety rules — the scale ladder (auto at level 2, approval at 1)
 *   plan.week      Saturday 09:30 — M03: the week's split inside the cap (numbers by code, words by the agent)
 *   report.weekly  Saturday 10:00 · report.monthly the 1st at 10:00 — built by code, sent to Telegram
 *   `npm run worker`
 */
import { runOnce } from "../src/jobs/runner";
import { metaToken, syncMeta } from "../src/jobs/meta-sync";
import { computeTruthDays, omsOptions, syncOms } from "../src/jobs/truth";
import { buildMorningReport } from "../src/jobs/morning-report";
import { runRules } from "../src/jobs/rules-run";
import { intakeDrive } from "../src/jobs/creative-intake";
import { capiDataset, enqueueCapi, sendCapi } from "../src/jobs/capi";
import { checkAccounts, storeAttributionHealth } from "../src/jobs/account-safety";
import { runScale } from "../src/jobs/scale-run";
import { storePeriodReport } from "../src/jobs/weekly-report";
import { storePlan } from "../src/agents/planner";
import { dailyBackup } from "../src/ops/backup";
import { runFatigue } from "../src/jobs/fatigue";
import { proposeSafetyNet } from "../src/server/safety-net";
import { storeAnalysis } from "../src/agents/analyst";
import { weeklyCreativeRequests } from "../src/agents/strategist";
import { MetaClient } from "../src/meta/client";
import { writeMode } from "../src/meta/write";
import { uploadReadyCreatives } from "../src/jobs/creative-upload";
import { driveFromEnv } from "../src/adapters/drive";
import { sendTelegram, telegramFromEnv } from "../src/adapters/telegram";
import { db } from "../src/server/db";

const DAY = 86_400_000;

function amman(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Amman", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now).map((p) => [p.type, p.value]));
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Amman", weekday: "short" }).format(now);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute), saturday: weekday === "Sat", firstOfMonth: parts.day === "01" };
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
  if (t.hour > 2 || (t.hour === 2 && t.minute >= 30)) await runOnce("db.backup", t.date, () => dailyBackup(db, now));
  if (t.hour === 3) await runOnce("meta.final", t.date, () => syncMeta({ since: iso(new Date(utcDay(t.date).getTime() - 8 * DAY)), until: yesterday }));
  if (t.minute >= 5) {
    await runOnce("oms.sync", `${t.date}T${t.hour}`, async () => {
      const o = omsOptions();
      return o ? syncOms(o, new Date(now.getTime() - 3 * DAY)) : { skipped: "OMS not linked yet (P0.3)" };
    });
  }
  if (t.minute >= 10) await runOnce("truth.compute", `${t.date}T${t.hour}`, () => computeTruthDays(utcDay(yesterday), utcDay(t.date), now));
  if (t.minute >= 15) await runOnce("rules", `${t.date}T${t.hour}`, () => runRules(now));
  const quarter = `${t.date}T${String(t.hour).padStart(2, "0")}:${String(Math.floor(t.minute / 15) * 15).padStart(2, "0")}`;
  await runOnce("creative.intake", quarter, async () => {
    const drive = driveFromEnv();
    const root = process.env.DRIVE_PRODUCTS_FOLDER_ID?.trim();
    return drive && root ? intakeDrive(drive, root) : { skipped: "Drive not linked yet (P0.6)" };
  });
  await runOnce("meta.upload", quarter, () => uploadReadyCreatives());
  await runOnce("capi.send", quarter, async () => {
    const queued = await enqueueCapi(now);
    const live = writeMode() === "live";
    const token = live ? await metaToken() : null;
    const sent = await sendCapi({ meta: token ? new MetaClient({ token }) : null, oms: live ? omsOptions() : null, datasetId: await capiDataset(), testEventCode: process.env.CAPI_TEST_EVENT_CODE?.trim() || null, now });
    return { ...queued, ...sent };
  });
  if (t.firstOfMonth && t.hour >= 6) {
    await runOnce("safety.month", t.date, async () => {
      const done: string[] = [];
      for (const a of await db.adAccount.findMany({ where: { monthlyCap: { gt: 0 } } })) {
        const cs = await proposeSafetyNet(a.metaId, { type: "rule", id: "safety_net" }, { reset: true, source: "rule" }).catch(() => null);
        if (cs) {
          done.push(a.metaId);
          await db.alert.create({ data: { kind: "safety.month", tone: "warn", text: `شهر جديد: سقف حساب ${a.name} عند ميتا بدو تصفير — وافق عليه بـ «القرارات»`, href: "/decisions" } });
        }
      }
      return { proposed: done };
    });
  }
  if (t.hour > 7 || (t.hour === 7 && t.minute >= 30)) await runOnce("creatives.fatigue", t.date, () => runFatigue(now));
  if (t.minute >= 17) await runOnce("rules.scale", `${t.date}T${t.hour}`, () => runScale(now));
  if (t.saturday && (t.hour > 9 || (t.hour === 9 && t.minute >= 30))) await runOnce("plan.week", t.date, () => storePlan(now));
  for (const kind of ["weekly", "monthly"] as const) {
    if ((kind === "weekly" ? t.saturday : t.firstOfMonth) && t.hour >= 10) {
      await runOnce(`report.${kind}`, t.date, async () => {
        const r = await storePeriodReport(kind, now);
        const tg = telegramFromEnv();
        if (!tg) return { ...r, skipped: "Telegram not linked yet (P0.7)" };
        const report = await db.report.findUniqueOrThrow({ where: { kind_forDate: { kind, forDate: r.forDate } } });
        await sendTelegram(tg, report.text);
        await db.report.update({ where: { id: report.id }, data: { sentAt: new Date() } });
        return { ...r, sent: true };
      });
    }
  }
  if (t.minute >= 20) await runOnce("account.safety", `${t.date}T${t.hour}`, () => checkAccounts(now));
  if (t.hour >= 8) await runOnce("analysis", t.date, () => storeAnalysis(now));
  if (t.saturday && (t.hour > 9 || (t.hour === 9 && t.minute >= 45))) await runOnce("creatives.week", t.date, () => weeklyCreativeRequests(now));
  if (t.hour >= 8) await runOnce("attribution.health", t.date, () => storeAttributionHealth(now));
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
