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
 *   studio.launch every 15 min — the studio's direct uploads (POST /api/v1/vp/launch-requests) go through the same intake
 *   drive.library every 30 min — the owner's «Zaki Production» Drive: which file is which video, its scenario, the register (read only)
 *   drive.library every 30 min — the owner's «Zaki Production» Drive: which file is which video, its scenario, the register (read only)
 *   creative.intake.studio every 15 min — the studio's own Drive tree (Zakiai/<product>/<VP>/6-نهائي), read only
 *   replies.sync   every 15 min — the replies inbox capacity; message ad sets are held (scale freeze) while it is behind or unseen
 *   meta.upload    every 15 min after the intake — ready videos to Meta (dry-run unless META_WRITE_MODE=live)
 *   account.safety every hour at :20 — account status, rejections (3 in 24 h freeze creation), appeal drafts
 *   analysis       08:00 — M02: each product's weakest funnel step (by code), in words by the agent
 *   creatives.week Saturday 09:45 — M06: one new-script request per product with its winning tags, for the studio
 *   attribution    08:00 — M09 by code: the Meta/truth gap per campaign, attribution share, CAPI acceptance
 *   capi.send      every 15 min — the truth back to Meta as conversion events (queued always, sent only when live)
 *   report.morning 09:00 — built by code, sent to Telegram
 *   alerts.read    every 15 min — the instant alerts of spec 12.3 (two readings in a row, the instant ones at once)
 *   alerts.send    every 5 min — every unsent danger/warning alert in ONE Telegram message
 *   workflow.timeouts every 5 min — a workflow step «running» past its own timeout goes to the handoff queue (once each)
 *   safety.month   the 1st at 06:00 — the account cap on Meta reset for the new month (waits for the owner)
 *   creatives.fatigue 07:30 — a tired winner is marked and new hooks are queued for the studio (never paused)
 *   rules.scale    every hour at :17, after the safety rules — the scale ladder (auto at level 2, approval at 1)
 *   plan.week      Saturday 09:30 — M03: the week's split inside the cap (numbers by code, words by the agent)
 *   report.weekly  Saturday 10:00 · report.monthly the 1st at 10:00 — built by code, sent to Telegram
 *   `npm run worker`
 */
import { runOnce, stopStarting, sweepInterrupted } from "../src/jobs/runner";
import { JOB_RETRIES } from "../src/core/job-slot";
import { WORKER_TICK_KEY } from "../src/core/health";
import { startOverlay } from "../src/server/connections";
import { metaToken, syncMeta } from "../src/jobs/meta-sync";
import { computeTruthDays, omsOptions, syncOms } from "../src/jobs/truth";
import { buildMorningReport } from "../src/jobs/morning-report";
import { linkSlot, omsBackoff } from "../src/jobs/oms-health";
import { runRules } from "../src/jobs/rules-run";
import { intakeDrive } from "../src/jobs/creative-intake";
import { capiDataset, enqueueCapi, sendCapi } from "../src/jobs/capi";
import { capiSendOn } from "../src/core/capi";
import { checkAccounts, storeAttributionHealth } from "../src/jobs/account-safety";
import { runScale } from "../src/jobs/scale-run";
import { storePeriodReport } from "../src/jobs/weekly-report";
import { storePlan } from "../src/agents/planner";
import { dailyBackup } from "../src/ops/backup";
import { runFatigue } from "../src/jobs/fatigue";
import { proposeSafetyNet } from "../src/server/safety-net";
import { storeAnalysis } from "../src/agents/analyst";
import { weeklyCreativeRequests } from "../src/agents/strategist";
import { readAlerts, sendAlerts } from "../src/jobs/alerts";
import { MetaClient } from "../src/meta/client";
import { writeMode } from "../src/meta/write";
import { metaWriteGate, missingText, requireKeys } from "../src/core/readiness";
import { getSetting } from "../src/server/settings";
import { isEmptyReport } from "../src/core/report-empty";
import { uploadReadyCreatives } from "../src/jobs/creative-upload";
import { driveFromEnv } from "../src/adapters/drive";
import { intakeStudioDrive } from "../src/jobs/studio-intake";
import { syncDriveLibrary } from "../src/jobs/drive-library";
import { processPendingRequests } from "../src/server/studio-launch";
import { syncReplies } from "../src/jobs/replies";
import { repliesFromEnv } from "../src/adapters/replies";
import { sendTelegram, telegramFromEnv } from "../src/adapters/telegram";
import { sweepTimeouts } from "../src/server/step-exec";
import { realDoorDeps, syncWorkspace } from "../src/server/workspace";
import { runScheduled } from "../src/server/scheduler";
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
  // a row left «running» by a process that died (a deploy restarts the worker at any hour) is closed, so its job can be tried again
  await sweepInterrupted(now).catch(() => undefined);
  const t = amman(now);
  const yesterday = iso(new Date(utcDay(t.date).getTime() - DAY));
  const halfHour = `${t.date}T${String(t.hour).padStart(2, "0")}:${t.minute < 30 ? "00" : "30"}`;
  const day = t.hour >= 8;

  if (day || t.hour % 2 === 0) {
    await runOnce("meta.sync", day ? halfHour : `${t.date}T${t.hour}`, async () => {
      // the token may be the environment's or the encrypted connection in the database
      if (!(await metaToken())) requireKeys("meta");
      return syncMeta({ since: yesterday, until: t.date });
    });
  }
  if (t.hour > 2 || (t.hour === 2 && t.minute >= 30)) await runOnce("db.backup", t.date, () => dailyBackup(db, now), { retries: JOB_RETRIES["db.backup"] });
  if (t.hour >= 3) await runOnce("meta.final", t.date, () => syncMeta({ since: iso(new Date(utcDay(t.date).getTime() - 8 * DAY)), until: yesterday }));
  {
    // R-26: saving the OMS address or token pulls at the very next turn (its own slot), not at the next hour
    const linkedIso = await getSetting("oms.linkedAt").catch(() => null);
    const linkedAt = linkedIso ? new Date(linkedIso) : null;
    const lslot = linkSlot(linkedAt && !Number.isNaN(linkedAt.getTime()) ? linkedAt : null);
    const linkRan = lslot ? await db.jobRun.findUnique({ where: { job_slot: { job: "oms.sync", slot: lslot } } }) : true;
    const pullNow = !!lslot && !linkRan && !!omsOptions();
    if (pullNow || t.minute >= 5) {
      await runOnce("oms.sync", pullNow ? lslot! : `${t.date}T${t.hour}`, async () => {
        const o = omsOptions();
        // R-26: «not linked» is a skip with the sentence, not a failure — a failure counts against the OMS
        if (!o) return { skipped: missingText("oms") ?? "OMS not linked" };
        // After failures, leave the OMS alone for 1 h, 2 h, 4 h, then 8 h (src/jobs/oms-health.ts) — except the pull that follows a new link.
        if (!pullNow) {
          const runs = await db.jobRun.findMany({ where: { job: "oms.sync" }, orderBy: { startedAt: "desc" }, take: 48 });
          const back = omsBackoff(runs, now, linkedAt);
          if (back.wait) return { skipped: "backoff", backoff: true, failures: back.failures, until: back.until?.toISOString() };
        }
        return syncOms(o, new Date(now.getTime() - 3 * DAY));
      });
    }
  }
  if (t.minute >= 10) await runOnce("truth.compute", `${t.date}T${t.hour}`, () => computeTruthDays(utcDay(yesterday), utcDay(t.date), now));
  if (t.minute >= 15) await runOnce("rules", `${t.date}T${t.hour}`, () => runRules(now));
  const quarter = `${t.date}T${String(t.hour).padStart(2, "0")}:${String(Math.floor(t.minute / 15) * 15).padStart(2, "0")}`;
  await runOnce("creative.intake", quarter, async () => {
    const drive = driveFromEnv();
    const root = process.env.DRIVE_PRODUCTS_FOLDER_ID?.trim();
    requireKeys("drive");
    return drive && root ? intakeDrive(drive, root) : { skipped: "Drive not linked (demo)" };
  });
  await runOnce("creative.intake.studio", quarter, async () => {
    const drive = driveFromEnv();
    const root = process.env.DRIVE_STUDIO_FOLDER_ID?.trim();
    requireKeys("studioDrive");
    return drive && root ? intakeStudioDrive(drive, root) : { skipped: "Studio Drive not linked (demo)" };
  });
  await runOnce("drive.library", `${t.date}T${String(t.hour).padStart(2, "0")}:${t.minute >= 30 ? "30" : "00"}`, async () => {
    const drive = driveFromEnv();
    const root = process.env.DRIVE_PRODUCTION_FOLDER_ID?.trim();
    requireKeys("driveLibrary");
    return drive && root ? syncDriveLibrary(drive, root, process.env.DRIVE_REGISTER_FILE_ID?.trim() || null) : { skipped: "Production Drive not linked (demo)" };
  });
  await runOnce("studio.launch", quarter, () => processPendingRequests());
  await runOnce("replies.sync", quarter, async () => {
    requireKeys("replies");
    return syncReplies(repliesFromEnv(), now);
  });
  await runOnce("meta.upload", quarter, () => uploadReadyCreatives());
  await runOnce("alerts.read", quarter, () => readAlerts(now));
  const five = `${t.date}T${String(t.hour).padStart(2, "0")}:${String(Math.floor(t.minute / 5) * 5).padStart(2, "0")}`;
  await runOnce("alerts.send", five, async () => {
    requireKeys("telegram");
    return sendAlerts(telegramFromEnv(), now);
  });
  await runOnce("workflow.timeouts", five, () => sweepTimeouts(now));
  await runOnce("workspace.sync", five, async () => {
    requireKeys("workspace");
    return syncWorkspace(realDoorDeps(), now);
  });
  // the site's own clock for workflows with a schedule (off unless SITE_SCHEDULER=1): every minute
  await runOnce("workflow.schedule", `${t.date}T${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`, () => runScheduled(now));
  await runOnce("capi.send", quarter, async () => {
    // R-11: the OMS is the only sender of conversion events (owner, 17/11): off unless CAPI_SEND=1
    if (!capiSendOn()) return { skipped: "CAPI_SEND is off — the OMS sends the conversion events" };
    const queued = await enqueueCapi(now);
    const gate = metaWriteGate(process.env, !!(await metaToken()));
    if (gate.error) throw new Error(gate.error);
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
          await db.alert.create({ data: { kind: "safety.month", tone: "warn", text: `شهر جديد: سقف حساب ${a.name} عند ميتا بدو تصفير — وافق عليه بـ «القرارات»`, href: "/tasks" } });
        }
      }
      return { proposed: done };
    });
  }
  if (t.hour > 7 || (t.hour === 7 && t.minute >= 30)) await runOnce("creatives.fatigue", t.date, () => runFatigue(now));
  if (t.minute >= 17) await runOnce("rules.scale", `${t.date}T${t.hour}`, () => runScale(now));
  if (t.saturday && (t.hour > 9 || (t.hour === 9 && t.minute >= 30))) await runOnce("plan.week", t.date, () => storePlan(now), { retries: JOB_RETRIES["plan.week"] });
  for (const kind of ["weekly", "monthly"] as const) {
    if ((kind === "weekly" ? t.saturday : t.firstOfMonth) && t.hour >= 10) {
      await runOnce(`report.${kind}`, t.date, async () => {
        const r = await storePeriodReport(kind, now);
        const tg = telegramFromEnv();
        if (!tg) {
          requireKeys("telegram");
          return { ...r, skipped: "Telegram not linked (demo)" };
        }
        const report = await db.report.findUniqueOrThrow({ where: { kind_forDate: { kind, forDate: r.forDate } } });
        await sendTelegram(tg, report.text);
        await db.report.update({ where: { id: report.id }, data: { sentAt: new Date() } });
        return { ...r, sent: true };
      }, { retries: kind === "weekly" ? JOB_RETRIES["report.weekly"] : 0 });
    }
  }
  if (t.minute >= 20) await runOnce("account.safety", `${t.date}T${t.hour}`, () => checkAccounts(now));
  if (t.hour >= 8) await runOnce("analysis", t.date, () => storeAnalysis(now));
  if (t.saturday && (t.hour > 9 || (t.hour === 9 && t.minute >= 45))) await runOnce("creatives.week", t.date, () => weeklyCreativeRequests(now));
  if (t.hour >= 8) await runOnce("attribution.health", t.date, () => storeAttributionHealth(now));
  if (t.hour >= 7) await runOnce("truth.week", t.date, () => computeTruthDays(new Date(utcDay(t.date).getTime() - 7 * DAY), utcDay(t.date), now));
  if (t.hour >= 9) {
    await runOnce("report.morning", t.date, async () => {
      const text = await buildMorningReport(utcDay(yesterday));
      // U-07: a report with nothing in it is kept (marked) but never sent — it only covered the real ones
      const empty = isEmptyReport("morning", text);
      await db.report.upsert({ where: { kind_forDate: { kind: "morning", forDate: utcDay(yesterday) } }, create: { kind: "morning", forDate: utcDay(yesterday), text, empty }, update: { text, empty } });
      if (empty) return { empty: true, chars: text.length };
      const tg = telegramFromEnv();
      if (!tg) {
        requireKeys("telegram");
        return { skipped: "Telegram not linked (demo)", chars: text.length };
      }
      await sendTelegram(tg, text);
      await db.report.update({ where: { kind_forDate: { kind: "morning", forDate: utcDay(yesterday) } }, data: { sentAt: new Date() } });
      return { sent: true, chars: text.length };
    }, { retries: JOB_RETRIES["report.morning"] });
  }
}

if (process.argv[1]?.includes("worker")) {
  console.log("worker started (Asia/Amman)");
  let inflight: Promise<void> = Promise.resolve();
  const loop = () => {
    inflight = (async () => {
      try {
        // the heartbeat: /api/health says «worker ok» only while this is newer than 3 minutes (src/core/health.ts)
        const at = new Date().toISOString();
        await db.setting.upsert({ where: { key: WORKER_TICK_KEY }, create: { key: WORKER_TICK_KEY, value: { at } }, update: { value: { at } } });
      } catch (e) {
        console.error("heartbeat failed:", e instanceof Error ? e.message : e);
      }
      try {
        await tick();
      } catch (e) {
        console.error("tick failed:", e instanceof Error ? e.message : e);
      }
    })();
    return inflight;
  };
  // SIGTERM (a deploy): no new job starts, the one running gets a few seconds to finish; a row it leaves «running» is closed as interrupted later
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.once(sig, () => {
      stopStarting();
      void Promise.race([inflight, new Promise((r) => setTimeout(r, 8_000))]).then(() => process.exit(0));
    });
  }
  // the site's own values (D62) go over the environment before the first tick, and again every 30 s — a save made on the site reaches this process within 30 s
  void startOverlay().catch(() => undefined).then(() => loop());
  setInterval(loop, 60_000);
}
