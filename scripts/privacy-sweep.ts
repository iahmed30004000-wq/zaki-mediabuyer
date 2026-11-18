/**
 * The privacy sweep (spec 17.4 «ولا توكن أو بيانات زبون بالكود أو السجلات أو البرومبتات أو الشاشات»): every text the
 * system wrote — audit log, agent runs, alerts, reports, decisions, rule runs, conversion events, review issues,
 * lessons, tests — read back through the same filter the model gateway uses. The team's own login e-mails are
 * allowed (they are users, not customers); hashes kept on purpose (token sha256, video md5) are not text.
 * `npx tsx --env-file=.env scripts/privacy-sweep.ts`
 */
import { db } from "../src/server/db";
import { privacyHits } from "../src/gateway/privacy";

(async () => {
  const team = (await db.user.findMany({ select: { email: true } })).map((u) => u.email.toLowerCase());
  // only the team's own e-mails are masked; everything else is checked exactly as stored (keys are case-sensitive)
  const clean = (s: string) => {
    let out = s;
    for (const e of team) out = out.split(e).join("[team]").split(e.toUpperCase()).join("[team]");
    return out;
  };
  const sources: [string, () => Promise<unknown[]>][] = [
    ["AuditLog", () => db.auditLog.findMany()],
    ["AgentRun", () => db.agentRun.findMany({ select: { agent: true, error: true, blocked: true } })],
    ["Alert", () => db.alert.findMany({ select: { text: true } })],
    ["Report", () => db.report.findMany({ select: { kind: true, text: true } })],
    ["ChangeSet", () => db.changeSet.findMany({ select: { sentence: true, error: true, simulation: true } })],
    ["ChangeItem", () => db.changeItem.findMany({ select: { before: true, after: true, apiResponse: true, verifyResult: true } })],
    ["RuleRun", () => db.ruleRun.findMany({ select: { sentence: true } })],
    ["CapiEvent", () => db.capiEvent.findMany()],
    ["ReviewIssue", () => db.reviewIssue.findMany()],
    ["Lesson", () => db.lesson.findMany()],
    ["Experiment", () => db.experiment.findMany()],
    ["AttributedOrder", () => db.attributedOrder.findMany({ select: { adName: true, lpUrl: true, capiRef: true } })],
  ];
  let bad = 0;
  for (const [name, read] of sources) {
    const rows = await read();
    const hits = rows.map((r) => privacyHits(clean(JSON.stringify(r)))).filter((h) => h.length);
    if (hits.length) bad += hits.length;
    console.log(`${hits.length ? "✗" : "✓"} ${name}: ${rows.length} rows${hits.length ? ` — ${hits.length} with ${[...new Set(hits.flat())].join(", ")}` : ", nothing that looks like a token, a phone or an e-mail"}`);
  }
  console.log(bad ? `✗ ${bad} rows to look at` : "✓ the sweep is clean");
  process.exit(bad ? 1 : 0);
})();
