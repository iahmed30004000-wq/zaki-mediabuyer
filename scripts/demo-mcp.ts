/**
 * Claude's link to the app (v4 · A), end to end on the local database — through the real route handler, with a real
 * token: auth, the nineteen tools, the numbers landing where the screens and the truth job read them, the privacy net,
 * idempotency, approvals and the owner's answer, the switch, the rules, workflows, stock, videos, tasks.
 * `npx tsx --env-file=.env scripts/demo-mcp.ts`  (the database from `docker compose up -d`, migrated)
 */
process.env.MOCK_MODE = "0";
process.env.APP_URL = "http://localhost:3140";
process.env.TELEGRAM_BOT_TOKEN = "";
process.env.TELEGRAM_OWNER_CHAT_ID = "";

import { generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { db } from "../src/server/db";
import { hashToken, newToken } from "../src/server/api-token";
import { POST as mcp, GET as mcpGet } from "../src/app/mcp/route";
import { computeTruthDays } from "../src/jobs/truth";
import { loadDataset } from "../src/lib/source";
import { ApprovalInput, decideApproval, requestApproval } from "../src/server/approvals";
import { loadJobs } from "../src/lib/jobs-view";
import { runsOf } from "../src/server/workflows";
import { countInbox, getInboxItem, loadInbox, loadInboxDone, loadInboxLater } from "../src/server/inbox";
import { GET as inboxGet } from "../src/app/api/inbox/route";
import { setMode, setWakeKinds } from "../src/server/mode";
import { saveRules } from "../src/server/rules";
import { DEFAULT_RULES } from "../src/core/rules-v2";
import { loadNumbers } from "../src/lib/numbers-view";
import { loadAdsTable } from "../src/lib/ads-table";
import { loadColumns, saveColumns } from "../src/server/ads-prefs";
import { proposeRaise } from "../src/server/ads-actions";
import { cancelHandoff, createHandoff, listHandoffs, reassignHandoff, requestRun } from "../src/server/handoffs";
import { duplicateGroups } from "../src/core/tasks";
import { addDays, ammanKey } from "../src/core/dates";
import { summaryOfDay } from "../src/core/day";
import { loadDay, readDay } from "../src/lib/day-view";
import { bulkUpdateTasks, createTask, listTasks, mergeTasks, quickAddTask, updateTask } from "../src/server/tasks";
import { GET as hoList, POST as hoCreate } from "../src/app/api/v1/handoffs/route";
import { POST as hoClaim } from "../src/app/api/v1/handoffs/[id]/claim/route";
import { GET as vrList } from "../src/app/api/v1/video-requests/route";
import { POST as vrClaim } from "../src/app/api/v1/video-requests/[id]/claim/route";
import { POST as vrComplete } from "../src/app/api/v1/video-requests/[id]/complete/route";
import { loadBoard } from "../src/lib/videos-board";
import { approve, propose } from "../src/server/changes";
import { loadReadiness } from "../src/lib/readiness-view";
import { runScheduled } from "../src/server/scheduler";
import { clearChat, loadChat, saveChat } from "../src/server/assistant/chat";
import { syncDriveLibrary } from "../src/jobs/drive-library";
import { WorkflowPatch, createWorkflow, listVersions, logRun, updateWorkflow } from "../src/server/workflows";
import { ExecRefused, executeWorkflow, sweepTimeouts, type ExecDeps } from "../src/server/step-exec";
import { siteConfigFrom, verifySignature } from "../src/core/step-exec";
import type { WfGraph } from "../src/core/workflow";
import { addAfter, ensureLayout, isPlaced, setNode } from "../src/core/workflow-edit";
import { getSetting, restoreSetting, setSetting } from "../src/server/settings";
import { createVideoRequest, moveVideoRequest } from "../src/server/video-requests";
import { askAssistant } from "../src/server/assistant";
import { AssistantError, type Llm, type LlmRequest, type LlmResponse } from "../src/server/assistant/loop";
import { GET as assistantGet, POST as assistantPost } from "../src/app/api/assistant/route";
import { GET as connectionGet, POST as connectionPost } from "../src/app/api/assistant/connection/route";
import { connectionStatus, recheckKey, removeKey, saveKey, verifyAnthropicKey } from "../src/server/assistant/connection";
import { HttpError } from "../src/server/auth";
import { forgetKeyCache, resolveKey } from "../src/server/assistant/key";
import { assistantConfigured } from "../src/server/assistant/config";
import { PrivacyRefusal } from "../src/gateway/privacy";
import { realDoorDeps, syncWorkspace } from "../src/server/workspace";
import { loadToday } from "../src/lib/today-view";
import { dayBounds } from "../src/core/day";
import { STATS, formatStat } from "../src/core/numbers";
import { applyOp, getValues, panelData, runButton, setValues } from "../src/server/customize";
import { getUiConfig } from "../src/server/ui-config";
import { buttonsFor, effectiveBoards, effectivePages, fieldsFor, type UiOp } from "../src/core/customize";
import { BUILTIN_PAGES } from "../src/lib/nav";
import { GET as uiGet_, POST as uiPost } from "../src/app/api/ui/route";

const check = (ok: boolean, label: string, extra?: unknown) => {
  console.log(`${ok ? "✓" : "✗"} ${label}${ok || extra === undefined ? "" : `  → ${JSON.stringify(extra)}`}`);
  if (!ok) process.exitCode = 1;
};

const TOKEN = newToken("mbm_");
let id = 0;
const call = async (body: unknown, token: string | null = TOKEN, headers: Record<string, string> = {}) => {
  const r = await mcp(new Request("http://localhost:3140/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body) }));
  const text = await r.text();
  return { status: r.status, json: text ? (JSON.parse(text) as Record<string, any>) : null, headers: r.headers };
};
const rpc = (method: string, params?: unknown) => ({ jsonrpc: "2.0", id: ++id, method, params });
const tool = async (name: string, args: unknown = {}) => {
  const r = await call(rpc("tools/call", { name, arguments: args }));
  const res = r.json?.result as { content: { text: string }[]; structuredContent?: Record<string, any>; isError?: boolean } | undefined;
  return { text: res?.content?.[0]?.text ?? JSON.stringify(r.json), data: res?.structuredContent, isError: !!res?.isError, status: r.status };
};

const day = (back: number) => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
const Y = day(1);
const owner = { id: "demo-owner", role: "OWNER" as const };

async function clean() {
  await db.attributedOrder.deleteMany({ where: { omsOrderId: { startsWith: "mcp:" } } });
  await db.insightDaily.deleteMany({ where: { objectId: { startsWith: "DEMO_MCP" } } });
  await db.truthDaily.deleteMany({ where: { objectId: { startsWith: "DEMO_MCP" } } });
  await db.ad.deleteMany({ where: { metaId: { startsWith: "DEMO_MCP" } } });
  await db.adSet.deleteMany({ where: { metaId: { startsWith: "DEMO_MCP" } } });
  await db.campaign.deleteMany({ where: { metaId: { startsWith: "DEMO_MCP" } } });
  await db.approval.deleteMany({ where: { OR: [{ ref: { startsWith: "demo-mcp" } }, { title: { startsWith: "DEMO" } }] } });
  await db.notification.deleteMany({ where: { OR: [{ key: { startsWith: "demo-mcp" } }, { key: { startsWith: "stock:DEMO_STK" } }] } });
  await db.workflowRun.deleteMany({ where: { OR: [{ ref: { startsWith: "demo-mcp" } }, { workflow: { name: { startsWith: "DEMO" } } }] } });
  await db.workflow.deleteMany({ where: { key: "demo-mcp-flow" } });
  const drawn = await db.workflow.findMany({ where: { key: { startsWith: "wf-" }, name: { startsWith: "DEMO" } }, select: { id: true, key: true } });
  await db.handoff.deleteMany({ where: { workflowKey: { in: drawn.map((w) => w.key) } } });
  await db.workflowVersion.deleteMany({ where: { workflowId: { in: drawn.map((w) => w.id) } } });
  await db.workflow.deleteMany({ where: { id: { in: drawn.map((w) => w.id) } } });
  await db.stockSnapshot.deleteMany({ where: { productCode: "DEMO_STK" } });
  await db.videoBankItem.deleteMany({ where: { job: { startsWith: "DEMO-JOB" } } });
  const asks = await db.videoRequest.findMany({ where: { job: { startsWith: "DEMO-JOB" } }, select: { id: true, taskId: true } });
  await db.task.deleteMany({ where: { id: { in: asks.map((r) => r.taskId).filter((t): t is string => !!t) } } });
  await db.videoRequest.deleteMany({ where: { id: { in: asks.map((r) => r.id) } } });
  await db.alert.deleteMany({ where: { kind: "drive.library_unmapped" } });
  await db.task.deleteMany({ where: { title: { startsWith: "DEMO" } } });
  await db.productEconomics.deleteMany({ where: { productCode: { in: ["DEMO_STK", "DEMO_NUM", "VID01"] } } });
  await db.productDay.deleteMany({ where: { productCode: "DEMO_NUM" } });
  await db.setting.deleteMany({ where: { key: { startsWith: "ads.columns:demo-mcp" } } });
  const mine = await db.handoff.findMany({ where: { OR: [{ createdBy: { startsWith: "user:demo-mcp" } }, { createdBy: { startsWith: "agent:mcp:demo-mcp" } }, { createdBy: { startsWith: "agent:api:demo-mcp" } }] }, select: { runRef: true } });
  await db.workflowRun.deleteMany({ where: { ref: { in: mine.map((h) => h.runRef).filter((r): r is string => !!r) } } });
  await db.handoff.deleteMany({ where: { OR: [{ createdBy: { startsWith: "user:demo-mcp" } }, { createdBy: { startsWith: "agent:mcp:demo-mcp" } }, { createdBy: { startsWith: "agent:api:demo-mcp" } }] } });
  await db.changeItem.deleteMany({ where: { changeSet: { sourceRef: "demo-mcp-user" } } });
  await db.changeSet.deleteMany({ where: { sourceRef: "demo-mcp-user" } });
  await db.apiToken.deleteMany({ where: { name: { startsWith: "demo-mcp" } } });
  await db.changeItem.deleteMany({ where: { changeSet: { sourceRef: "assistant:demo-mcp-user" } } });
  await db.changeSet.deleteMany({ where: { sourceRef: "assistant:demo-mcp-user" } });
  await db.agentRun.deleteMany({ where: { agent: "M12", model: "demo-model" } });
  await db.customValue.deleteMany({ where: { updatedBy: "demo-mcp-user" } });
  await db.setting.deleteMany({ where: { key: { in: ["owner.mode", "owner.wake_kinds", "campaign.rules", "videos.min_spend", "agents.daily_caps", "agents.monthly_cap", "ui.config"] } } });
}

(async () => {
  await clean();
  const row = await db.apiToken.create({ data: { name: "demo-mcp", scopes: ["mcp"], tokenHash: hashToken(TOKEN), prefix: TOKEN.slice(0, 10) } });

  // ── who may call ──
  check((await call(rpc("ping"), null)).status === 401, "no token → 401");
  const bad = await call(rpc("ping"), "mbm_wrong");
  check(bad.status === 401 && !!bad.headers.get("www-authenticate"), "a wrong token → 401 with WWW-Authenticate");
  const studio = newToken("mbs_");
  await db.apiToken.create({ data: { name: "demo-mcp-studio", scopes: ["vp:read"], tokenHash: hashToken(studio), prefix: studio.slice(0, 10) } });
  check((await call(rpc("ping"), studio)).status === 403, "a studio token (vp:read) may not use /mcp → 403");
  check((await call(rpc("ping"), TOKEN, { origin: "https://evil.example" })).status === 403, "a foreign Origin → 403");
  check((await call(rpc("ping"), TOKEN, { origin: "https://claude.ai" })).status === 200, "claude.ai as Origin is fine");
  check((await mcpGet()).status === 405, "GET → 405 (no server stream)");

  // ── the protocol ──
  const init = await call(rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude", version: "1" } }));
  check(init.json?.result?.protocolVersion === "2025-06-18" && !!init.json?.result?.instructions, "initialize answers with the version and the instructions");
  check((await call({ jsonrpc: "2.0", method: "notifications/initialized" })).status === 202, "notifications/initialized → 202");
  const list = await call(rpc("tools/list"));
  const names = (list.json?.result?.tools as { name: string; inputSchema: { required?: string[] } }[]).map((t) => t.name);
  check(names.length === 19 && ["push_metrics", "log_run", "request_approval", "get_approvals", "get_mode", "get_rules", "get_handoffs", "claim_handoff", "complete_handoff", "create_handoff", "get_video_requests", "claim_video_request", "complete_video_request"].every((n) => names.includes(n)), "tools/list: nineteen tools (twelve + the handoff queue + the video requests)", names);
  const pm = (list.json?.result?.tools as { name: string; inputSchema: any }[]).find((t) => t.name === "push_metrics")!;
  check(pm.inputSchema.properties.rows.items.required.join() === "date,level,id", "push_metrics advertises the row schema (date, level, id required)");
  check(!names.some((n) => /delete|remove|execute|approve$|spend/.test(n)), "no delete / execute / spend tool exists");

  // ── numbers in: structure, delivery, real orders ──
  const rows = [
    { date: Y, level: "campaign", id: "DEMO_MCP_C1", name: "SY_TRF01_WEB_SCALE_261010_C03", status: "active", budget_daily: 40, start_time: `${day(5)}T08:00:00+0200`, account_id: "act_demo_mcp", spend: 52.5, impressions: 20000, link_clicks: 400, pixel_purchases: 7 },
    { date: Y, level: "adset", id: "DEMO_MCP_S1", parent_id: "DEMO_MCP_C1", name: "BROAD_ADV_SP_CPT0050_v1", status: "ACTIVE", budget_daily: 40, spend: 52.5, impressions: 20000, link_clicks: 400 },
    { date: Y, level: "ad", id: "DEMO_MCP_A1", parent_id: "DEMO_MCP_S1", name: "CR09500_H07_HER_LP1", status: "ACTIVE", spend: 52.5, impressions: 20000, reach: 9000, link_clicks: 400, pixel_purchases: 7, real_orders: 6, confirmed: 4, shipped: 3, delivered: 2, returned: 1, collected: 40 },
  ];
  const first = await tool("push_metrics", { rows });
  check(!first.isError && first.data?.applied === 3 && first.data?.rejected.length === 0, "push_metrics: 3 rows applied", first.data);
  const camp = await db.campaign.findUnique({ where: { metaId: "DEMO_MCP_C1" }, include: { account: true } });
  check(camp?.productCode === "TRF01" && camp.namingOk && camp.status === "ACTIVE" && Number(camp.dailyBudget) === 40 && !!camp.startTime, "the campaign: name parsed (TRF01), status normalised, budget and start_time stored", camp);
  check(camp?.account.metaId === "act_demo_mcp" && camp.account.autonomyLevel === 0, "its account was made, and as an advisor (level 0)");
  check((await db.adSet.count({ where: { metaId: "DEMO_MCP_S1" } })) === 1 && (await db.ad.count({ where: { metaId: "DEMO_MCP_A1" } })) === 1, "the ad set and the ad were made under it");
  const ins = await db.insightDaily.findUnique({ where: { level_objectId_date: { level: "ad", objectId: "DEMO_MCP_A1", date: new Date(`${Y}T00:00:00Z`) } } });
  check(!!ins && Number(ins.spend) === 52.5 && ins.impressions === 20000 && ins.purchases === 7 && Number(ins.frequency) > 2.2 && ins.source === "mcp", "InsightDaily: spend, impressions, purchases, frequency = impressions ÷ reach, source mcp", ins);
  const orders = await db.attributedOrder.findMany({ where: { omsOrderId: { startsWith: "mcp:ad:DEMO_MCP_A1:" } } });
  const by = (s: string) => orders.filter((o) => o.status === s).length;
  check(orders.length === 6 && by("returned") === 1 && by("delivered") === 2 && by("confirmed") === 1 && by("new") === 2, "six real orders as plain rows (1 returned · 2 delivered · 1 confirmed · 2 new)", orders.map((o) => o.status));
  check(orders.every((o) => o.method === "mcp" && o.adId === "DEMO_MCP_A1" && o.productCode === "TRF01" && o.campaignId === "DEMO_MCP_C1" && !o.isFake), "…each tied to its ad, ad set, campaign and product, marked method «mcp»");
  check(orders.filter((o) => o.status === "delivered").every((o) => Number(o.collected) === 20), "…the 40$ collected is spread over the 2 delivered");

  // ── idempotent, and a smaller tally replaces ──
  await tool("push_metrics", { rows });
  check((await db.attributedOrder.count({ where: { omsOrderId: { startsWith: "mcp:ad:DEMO_MCP_A1:" } } })) === 6 && (await db.insightDaily.count({ where: { objectId: "DEMO_MCP_A1" } })) === 1, "the same push twice changes nothing");
  await tool("push_metrics", { rows: [{ date: Y, level: "ad", id: "DEMO_MCP_A1", real_orders: 3, confirmed: 2 }] });
  const after = await db.attributedOrder.findMany({ where: { omsOrderId: { startsWith: "mcp:ad:DEMO_MCP_A1:" } } });
  check(after.length === 3 && after.filter((o) => o.status === "confirmed").length === 2, "a later tally of 3 replaces the 6 (the extra rows are gone)");
  check(Number((await db.insightDaily.findFirst({ where: { objectId: "DEMO_MCP_A1" } }))?.spend) === 52.5, "…and a row with no spend leaves the spend as it was");
  await tool("push_metrics", { rows });

  // ── the privacy net ──
  const dirty = await tool("push_metrics", { rows: [{ date: Y, level: "ad", id: "DEMO_MCP_A1", name: "اتصل 0912345678" }, { date: Y, level: "ad", id: "DEMO_MCP_A1", customer_phone: "0912345678" }, { date: Y, level: "ad", id: "DEMO_MCP_A1", spend: 52.5 }] });
  check(dirty.data?.applied === 1 && dirty.data?.rejected.length === 2, "a phone in a text, and a customer key, are refused — the good row still lands", dirty.data?.rejected);
  check((await db.ad.findUnique({ where: { metaId: "DEMO_MCP_A1" } }))?.name === "CR09500_H07_HER_LP1", "…and the refused row changed nothing");
  const orphan = await tool("push_metrics", { rows: [{ date: Y, level: "adset", id: "DEMO_MCP_S9", parent_id: "NOPE", name: "x" }] });
  check(orphan.data?.rejected?.[0]?.error.includes("الحملة"), "an ad set whose campaign is unknown is refused, in words", orphan.data?.rejected);

  // ── the same numbers, read by the screens and by the truth job ──
  await computeTruthDays(new Date(`${Y}T00:00:00Z`), new Date(`${Y}T00:00:00Z`));
  const truth = await db.truthDaily.findFirst({ where: { level: "ad", objectId: "DEMO_MCP_A1", date: new Date(`${Y}T00:00:00Z`) } });
  check(truth?.orders === 6 && truth.confirmed === 4 && truth.shipments === 3 && truth.delivered === 2 && truth.returned === 1 && Number(truth.spendWithFee) === 53.03, "truth.compute reads them: 6 orders · 4 confirmed · 3 shipped · 2 delivered · 1 returned, spend + 1% fee", truth);
  const ds = await loadDataset(7);
  const c = ds.campaigns.find((x) => x.id === "DEMO_MCP_C1");
  const ad = c?.adsets[0]?.ads[0];
  check(ds.demo === false && ad?.counts.orders === 6 && ad.counts.confirmed === 4 && ad.counts.delivered === 2 && ad.counts.spend === 52.5, "loadDataset (MOCK_MODE=0) shows the campaign with those counts", ad?.counts);
  const capiRows = await db.attributedOrder.count({ where: { omsOrderId: { startsWith: "mcp:" }, method: { not: "mcp" } } });
  check(capiRows === 0, "every pushed order row is method «mcp» (CAPI skips them)");

  // ── v3 C: the ads table reads the same rows (and a person's columns / raise proposal go through the same services) ──
  {
    const t = await loadAdsTable({ d: "custom", from: Y, to: Y });
    const cmp = t.rows.find((r) => r.id === "DEMO_MCP_C1");
    const set = cmp?.children.find((r) => r.id === "DEMO_MCP_S1");
    const adRow = set?.children.find((r) => r.id === "DEMO_MCP_A1");
    check(t.demo === false && !!cmp && !!set && !!adRow, "ads table (MOCK_MODE=0): the pushed campaign → ad set → ad are rows", t.rows.map((r) => r.id));
    check(cmp?.m.spend === 53.03 && cmp.m.orders === 6 && cmp.m.pixel === 7 && cmp.m.costPerOrder === 8.84, "…the campaign: spend + 1% fee 53.03 · 6 real orders · 8.84 a real order · 7 pixel purchases (its own rows win — nothing counted twice)", cmp?.m);
    check(adRow?.m.orders === 6 && adRow.m.frequency !== null && Math.abs(adRow.m.frequency - 2.22) < 0.01 && adRow.m.cpm === 2.63 && adRow.m.ctr === 2, "…the ad: orders by its id · frequency = impressions ÷ reach · CPM and CTR from Meta's own spend", adRow?.m);
    check(cmp?.budget === 40 && cmp.days !== null && cmp.days >= 5 && cmp.days <= 7 && cmp.pages.length === 1 && cmp.isTest === false, "…budget 40 · days running from start_time · the page from the ad set name · SCALE is not a test", { budget: cmp?.budget, days: cmp?.days, pages: cmp?.pages });
    check(cmp?.prev.spend === null && cmp.prev.orders === null && t.share.total >= 53.03, "…«قارن»: the day before has no numbers (dashes, not zeros) · the test-share gauge counts the spend", { prev: cmp?.prev.spend, share: t.share });

    await saveColumns("demo-mcp-user", ["orders", "zzz", "spend"]);
    check(JSON.stringify(await loadColumns("demo-mcp-user")) === JSON.stringify(["name", "orders", "spend"]), "a person's columns are saved for them and read back clean (unknown keys dropped, the name first)");
    check((await loadColumns("demo-mcp-someone-else")).length === 16 && (await loadColumns(null)).length === 16, "…everybody else still has the 16 default columns");

    // «اقترح زيادة»: one step of the ladder on the ad set's own budget — recorded as a suggestion on an advisor account, waiting for a yes on level 1
    const advisor = await proposeRaise({ objectType: "adset", objectId: "DEMO_MCP_S1" }, { id: "demo-mcp-user" });
    const stored = await db.changeSet.findUnique({ where: { id: advisor.id }, include: { items: true } });
    check(advisor.before === 40 && advisor.after === 48 && advisor.state === "simulated" && stored?.kind === "raise_step" && Number(stored.spendDeltaDaily) === 8 && stored.items[0]?.op === "set_budget", "«اقترح زيادة»: 40$ ← 48$ (+20%) is a proposal on the ad set; an advisor account (level 0) only records it", advisor);
    await db.adAccount.update({ where: { metaId: "act_demo_mcp" }, data: { autonomyLevel: 1 } });
    const guard = await proposeRaise({ objectType: "campaign", objectId: "DEMO_MCP_C1" }, { id: "demo-mcp-user" });
    await db.adAccount.update({ where: { metaId: "act_demo_mcp" }, data: { autonomyLevel: 0 } });
    check(guard.state === "pending_approval", "…on a level-1 account it waits in «بانتظار موافقتك» — nothing executes without a person's yes", guard);
    let noBudget = "";
    await proposeRaise({ objectType: "adset", objectId: "NO_SUCH_ADSET" }, { id: "demo-mcp-user" }).catch((e) => (noBudget = e.message));
    check(noBudget.includes("مش موجود"), "…an object that does not exist is refused in words");
  }

  // ── workflows ──
  const r1 = await tool("log_run", { job: "daily-check", ref: "demo-mcp-1", status: "running", summary: "بدأ" });
  const st1 = r1.data?.run.nodeStates as Record<string, { status: string }>;
  check(!r1.isError && r1.data?.run.status === "running" && st1.start?.status === "done" && st1.read?.status === "running", "log_run (running) moves the workflow: trigger done, first step running", st1);
  const r2 = await tool("log_run", { job: "daily-check", ref: "demo-mcp-1", node: { id: "read", status: "done", note: "قريت" } });
  check(r2.data?.run.nodeStates.read.status === "done" && r2.data?.run.nodeStates.read.note === "قريت" && r2.data?.run.status === "running", "…a node update keeps the run running");
  const r3 = await tool("log_run", { job: "daily-check", ref: "demo-mcp-1", status: "ok", summary: "خلص: 3 تنبيهات", metrics: { alerts: 3 } });
  check(r3.data?.run.status === "ok" && !!r3.data?.run.finishedAt && Object.values(r3.data?.run.nodeStates as Record<string, { status: string }>).every((s) => s.status === "done"), "…ok ends it with every node done");
  check((await db.workflowRun.count({ where: { ref: "demo-mcp-1" } })) === 1, "…all three calls were one run");
  check((await tool("log_run", { job: "no-such-job" })).text.includes("daily-check"), "an unknown job answers with the known keys");
  check((await tool("log_run", { job: "daily-check", ref: "demo-mcp-2", node: { id: "ghost", status: "done" } })).isError, "a node the workflow does not have is refused");
  const made = await tool("log_run", { job: "demo-mcp-flow", ref: "demo-mcp-3", create_if_missing: true });
  check(!made.isError && (await db.workflow.count({ where: { key: "demo-mcp-flow" } })) === 1, "create_if_missing makes a new workflow");
  await db.workflow.update({ where: { key: "daily-check" }, data: { enabled: false } });
  check((await tool("log_run", { job: "daily-check", ref: "demo-mcp-4" })).text.includes("enabled=false"), "a workflow the owner switched off says so in the answer");
  await db.workflow.update({ where: { key: "daily-check" }, data: { enabled: true } });
  await db.workflowRun.deleteMany({ where: { ref: "demo-mcp-4" } });

  // ── handoffs (v3 F): the owner's «شغّل هلق» and a stuck step — Claude takes them, does them, answers ──
  {
    const owner = { type: "user" as const, id: "demo-mcp-user" };
    const asked = await requestRun("daily-check", owner);
    const h0 = asked.handoff;
    check(asked.created && h0.kind === "manual_run" && h0.status === "open" && h0.assignee === "claude" && !!h0.runRef && (h0.context.steps?.length ?? 0) > 1 && !!h0.nodeId, "«شغّل هلق»: a handoff for Claude with the run ref and the steps of the job", h0);
    const again = await requestRun("daily-check", owner);
    check(!again.created && again.handoff.id === h0.id, "…asking again returns the open one (one request at a time per workflow)");
    const waiting = await db.workflowRun.findFirst({ where: { ref: h0.runRef! } });
    const ns = (waiting?.nodeStates ?? {}) as Record<string, { status: string }>;
    check(waiting?.status === "waiting" && waiting.trigger === "manual" && ns[h0.nodeId!]?.status === "handoff", "…the workflow's run is «waiting» and its first step shows «handoff»", { status: waiting?.status, node: ns[h0.nodeId!] });

    const seen = await tool("get_handoffs");
    check(seen.data?.handoffs.some((h: { id: string }) => h.id === h0.id) && seen.data?.handoffs.every((h: { assignee: string }) => h.assignee.startsWith("claude")), "get_handoffs (MCP): Claude sees it — and only what is for Claude");
    const took = await tool("claim_handoff", { id: h0.id });
    const running = await db.workflowRun.findFirst({ where: { ref: h0.runRef! } });
    check(!took.isError && took.data?.handoff.status === "claimed" && took.data.handoff.claimedBy === "demo-mcp" && running?.status === "running", "claim_handoff: it is Claude's now and the run is «running»", took.data?.handoff);
    check(!(await tool("claim_handoff", { id: h0.id })).isError, "…claiming twice by the same taker is fine");

    // the REST face, with a token made only for the queue
    const hoTok = newToken("mbh_");
    await db.apiToken.create({ data: { name: "demo-mcp-handoff", scopes: ["handoff"], tokenHash: hashToken(hoTok), prefix: hoTok.slice(0, 10) } });
    const rest = (route: (r: Request, c: { params: { id: string } }) => Promise<Response>, path: string, body: unknown = undefined, token: string | null = hoTok, id = "") =>
      route(new Request(`http://localhost:3140/api/v1/handoffs${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), { params: { id } });
    check((await rest(hoList as never, "", undefined, null)).status === 401 && (await rest(hoList as never, "", undefined, studio)).status === 403, "REST /api/v1/handoffs: no token → 401, a studio token → 403");
    const listed = await rest(hoList as never, "?status=open,claimed");
    const listedJson = (await listed.json()) as { handoffs: { id: string }[] };
    check(listed.status === 200 && listedJson.handoffs.some((h) => h.id === h0.id), "…a «handoff» token lists the queue");
    check((await rest(hoList as never, "", undefined, TOKEN)).status === 200, "…and Claude's MCP token may read it too");
    const second = await rest(hoClaim as never, "/x/claim", {}, hoTok, h0.id);
    check(second.status === 409, "a second taker is refused (409) — somebody has it", second.status);
    check((await rest(hoClaim as never, "/x/claim", {}, hoTok, "no-such-id")).status === 404, "…an unknown handoff is 404");

    // a step that failed hands itself over, with what is needed
    const made = await rest(hoCreate as never, "", { workflow: "daily-check", kind: "missing_connection", node: h0.nodeId, title: "ما في ربط بالـ OMS", need: "اقرا الطلبات من متصفح المالك", last_error: "401 من الـ OMS", inputs: { day: "2026-11-14" }, assignee: "claude_desktop" });
    const madeJson = (await made.json()) as { handoff: { id: string; kind: string; assignee: string; context: { lastError?: string } }; created: boolean };
    check(made.status === 201 && madeJson.created && madeJson.handoff.assignee === "claude_desktop" && madeJson.handoff.context.lastError === "401 من الـ OMS", "POST a handoff: a missing connection goes to Claude Desktop with the last error", madeJson);
    check((await tool("get_handoffs")).data?.handoffs.some((h: { id: string }) => h.id === madeJson.handoff.id), "…Claude's queue includes Claude Desktop's (every kind of Claude reads the same one)");
    const bad = await rest(hoCreate as never, "", { workflow: "daily-check", title: "اتصل 0912345678" });
    const unknownFlow = await rest(hoCreate as never, "", { workflow: "no-such-flow", title: "x" });
    const unknownNode = await rest(hoCreate as never, "", { workflow: "daily-check", node: "ghost", title: "x" });
    const invalidBody = await rest(hoCreate as never, "", { workflow: "daily-check" });
    check(bad.status === 400 && unknownFlow.status === 404 && unknownNode.status === 400 && invalidBody.status === 422, "…a phone number is refused, an unknown job is 404, an unknown step is 400, a bad body is 422", [bad.status, unknownFlow.status, unknownNode.status, invalidBody.status]);

    // the owner moves one to somebody else, and drops another
    const moved = await reassignHandoff(madeJson.handoff.id, "hermes", owner);
    check(moved.assignee === "hermes" && moved.status === "open", "the owner gives it to Hermes: back to «open», for Hermes", moved);
    check(!(await tool("get_handoffs")).data?.handoffs.some((h: { id: string }) => h.id === madeJson.handoff.id) && (await listHandoffs({ assignee: "hermes" })).some((h) => h.id === madeJson.handoff.id), "…Claude no longer sees it; Hermes' queue does");
    const dropped = await cancelHandoff(madeJson.handoff.id, owner);
    check(dropped.status === "cancelled", "…and he can drop it");

    // the answer: a run the owner asked for ends with it; the numbers it carries are filtered like every other
    const dirty = await tool("complete_handoff", { id: h0.id, note: "كلّم 0912345678" });
    check(dirty.isError && (await db.handoff.findUnique({ where: { id: h0.id } }))?.status === "claimed", "complete_handoff: a phone number in the answer is refused and the handoff stays open for its taker");
    const answered = await tool("complete_handoff", { id: h0.id, note: "خلص الفحص: 3 تنبيهات", result: { alerts: 3, day: "2026-11-14" } });
    const ended = await db.workflowRun.findFirst({ where: { ref: h0.runRef! } });
    const endStates = Object.values((ended?.nodeStates ?? {}) as Record<string, { status: string }>);
    check(!answered.isError && answered.data?.handoff.status === "done" && ended?.status === "ok" && !!ended.finishedAt && ended.summary === "خلص الفحص: 3 تنبيهات" && endStates.every((s) => s.status === "done"), "…answered: the run ends «ok» with every step done, the note as its summary", { run: ended?.status, summary: ended?.summary });
    check((await tool("complete_handoff", { id: h0.id, note: "تاني" })).isError, "…an answered handoff cannot be answered again");

    // a stuck step is unblocked, not ended: the answerer goes on and reports the rest with log_run
    const stuck = await createHandoff({ workflow: "night-round", kind: "node_failed", title: "فشلت خطوة القراءة", last_error: "timeout" }, owner);
    const unblocked = await tool("complete_handoff", { id: stuck.handoff.id, note: "قريت من المتصفح" });
    const goes = await db.workflowRun.findFirst({ where: { ref: stuck.handoff.runRef! } });
    check(!unblocked.isError && goes?.status === "running" && !goes.finishedAt, "a stuck step: the answer unblocks the run («running») and does not end it");
    const failedEnd = await createHandoff({ workflow: "night-round", kind: "node_failed", title: "ثانية" }, owner);
    await tool("complete_handoff", { id: failedEnd.handoff.id, note: "ما قدرت", run_status: "failed" });
    check((await db.workflowRun.findFirst({ where: { ref: failedEnd.handoff.runRef! } }))?.status === "failed", "…unless the answer says it failed");
    const dropRun = await requestRun("night-round", owner);
    await cancelHandoff(dropRun.handoff.id, owner);
    check((await db.workflowRun.findFirst({ where: { ref: dropRun.handoff.runRef! } }))?.status === "skipped", "a cancelled «شغّل هلق» marks its run «skipped» — nothing is deleted");
    await db.workflow.update({ where: { key: "night-round" }, data: { enabled: false } });
    let off = "";
    await requestRun("night-round", owner).catch((e) => (off = e.message));
    await db.workflow.update({ where: { key: "night-round" }, data: { enabled: true } });
    check(off.includes("مطفي"), "a workflow the owner switched off cannot be run from «شغّل هلق»");
  }

  // ── approvals: ask, answer, read ──
  const ask = { ref: "demo-mcp-ap-1", title: "DEMO رفع السقف", why: "3 أيام ورا بعض ضمن الهدف", urgency: "red", kind: "cap_raise", amount: 100, numbers: [{ label: "تكلفة", value: 2.9 }], expires_in_min: 60 };
  const a1 = await tool("request_approval", ask);
  check(!a1.isError && a1.data?.delivery === "ring" && a1.data?.approval.status === "pending", "request_approval (🔴, owner awake) → ring", a1.data?.delivery);
  const a2 = await tool("request_approval", ask);
  check(a2.data?.approval.id === a1.data?.approval.id && a2.data?.delivery === "already", "the same ref twice is one request");
  check((await tool("request_approval", { ...ask, ref: "demo-mcp-ap-x", why: "كلّم 0912345678" })).isError, "a request with a phone in it is refused");
  const open = await tool("get_approvals", { ids: [a1.data?.approval.id] });
  check(open.data?.approvals[0]?.status === "pending" && open.data?.approvals[0]?.numbers[0]?.value === "2.9", "get_approvals: pending, with its numbers");
  let analystTried = "";
  await decideApproval(a1.data?.approval.id, { action: "approve" }, { id: "u2", role: "ANALYST" }).catch((e) => (analystTried = e.message));
  check(analystTried.includes("للمالك"), "only the owner may answer (an analyst is refused)");
  await decideApproval(a1.data?.approval.id, { action: "postpone", until: "1h", note: "بعد الظهر" }, owner);
  const post = await tool("get_approvals", { ids: [a1.data?.approval.id] });
  check(post.data?.approvals[0]?.status === "postponed" && !!post.data?.approvals[0]?.postponedUntil, "postponed: Claude reads «postponed» with the time");
  await decideApproval(a1.data?.approval.id, { action: "approve", note: "ماشي" }, owner);
  const done = (await tool("get_approvals", { ids: [a1.data?.approval.id] })).data?.approvals[0];
  check(done?.status === "approved" && done.decisionNote === "ماشي" && done.decidedBy === "demo-owner", "approved: Claude reads the answer, the note, and who gave it");
  let again = "";
  await decideApproval(a1.data?.approval.id, { action: "reject" }, owner).catch((e) => (again = e.message));
  check(again.includes("مش مفتوح"), "an answered request cannot be answered again");
  const exp = await tool("request_approval", { ref: "demo-mcp-ap-2", title: "DEMO ينتهي", why: "اختبار الانتهاء", urgency: "yellow", expires_in_min: 1 });
  await db.approval.update({ where: { id: exp.data?.approval.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  check((await tool("get_approvals", { ids: [exp.data?.approval.id] })).data?.approvals[0]?.status === "expired", "a request past its expiry reads «expired»");

  // ── awake / asleep ──
  check((await tool("get_mode")).data?.mode === "awake", "get_mode: awake by default");
  await setMode({ mode: "asleep" }, "demo-owner");
  const asleep = await tool("get_mode");
  check(asleep.data?.mode === "asleep" && !!asleep.data?.since, "…the owner flips to asleep");
  const q = await tool("request_approval", { ref: "demo-mcp-ap-3", title: "DEMO أحمر وهو نايم", why: "اختبار", urgency: "red", kind: "manufacturing" });
  check(q.data?.delivery === "queue", "🔴 while he sleeps → queue (does not ring)");
  await setWakeKinds(["manufacturing"], "demo-owner");
  const w = await tool("request_approval", { ref: "demo-mcp-ap-4", title: "DEMO أحمر يصحّيه", why: "اختبار", urgency: "red", kind: "manufacturing" });
  check(w.data?.delivery === "ring", "…unless its kind is one he marked «يصحّيني» → ring");
  check((await tool("request_approval", { ref: "demo-mcp-ap-5", title: "DEMO أصفر", why: "اختبار", urgency: "yellow" })).data?.delivery === "silent", "🟡 is silent either way");
  await setMode({ mode: "awake" }, "demo-owner");

  // ── notify ──
  const n1 = await tool("notify", { title: "🔴 DEMO ما في تسليم", urgency: "red", key: "demo-mcp-n1" });
  const n2 = await tool("notify", { title: "🔴 DEMO ما في تسليم", urgency: "red", key: "demo-mcp-n1" });
  check(n1.data?.created === true && n2.data?.created === false, "notify: the same key twice is one alert");
  check((await tool("notify", { title: "كلّم 0912345678", urgency: "red" })).isError, "notify refuses a phone number");

  // ── rules ──
  const rules0 = await tool("get_rules");
  check(rules0.data?.rules.nightRound === "00:35" && rules0.data?.rules.targetCost === null && rules0.data?.missing.some((m: { key: string }) => m.key === "breakeven") && rules0.data?.text.length === 14, "get_rules: the 14 sentences, and what is still missing (the owner's numbers)", rules0.data?.missing?.length);
  await saveRules({ ...DEFAULT_RULES, targetCost: 3, breakeven: { TRF01: 5 } }, "demo-owner");
  const rules1 = await tool("get_rules");
  check(rules1.data?.rules.targetCost === 3 && rules1.data?.version > rules0.data?.version && rules1.data?.text[2].includes("TRF01 5$") && !rules1.data?.missing.some((m: { key: string }) => m.key === "breakeven"), "an edit is a new version, and get_rules returns it at once");

  // ── stock ──
  await db.productEconomics.create({ data: { productCode: "DEMO_STK", name: "منتج تجريبي", market: "SY", price: 20, unitCost: 5, deliveryFee: 2, returnFee: 1, codFeePct: 0.02, confirmCost: 0.3, stockDays: 30 } });
  const stk = await tool("push_stock", { rows: [{ product: "DEMO_STK", units: 80, days_cover: 4.2 }, { product: "DEMO_STK", days_cover: -1 }] });
  check(stk.data?.applied === 1 && stk.data?.alerts === 3 && stk.data?.rejected.length === 1, "push_stock: one row applied, one refused, a 🔴 alert for each of owner / abdullah / mohammad", stk.data);
  check((await db.productEconomics.findUnique({ where: { productCode: "DEMO_STK" } }))?.stockDays === 4, "…and the product's days of cover were updated");
  check((await tool("push_stock", { rows: [{ product: "DEMO_STK", units: 70, days_cover: 4.0 }] })).data?.alerts === 0, "…the same reading again the same day raises nothing new");
  check((await tool("push_stock", { rows: [{ product: "NO_SUCH_PRODUCT", days_cover: 3 }] })).data?.applied === 1 && (await db.productEconomics.count({ where: { productCode: "NO_SUCH_PRODUCT" } })) === 0, "…a product that is not in the system is never created by a stock push");
  await db.stockSnapshot.deleteMany({ where: { productCode: "NO_SUCH_PRODUCT" } });
  await db.notification.deleteMany({ where: { key: { startsWith: "stock:NO_SUCH_PRODUCT" } } });

  // ── videos ──
  await tool("push_videos", { rows: [{ job: "DEMO-JOB-1", v_name: "V45", product: "TRF01", status: "ready", drive_file_id: "drive123" }, { job: "DEMO-JOB-1", v_name: "V46", product: "TRF01" }] });
  await tool("push_videos", { rows: [{ job: "DEMO-JOB-1", v_name: "V45", product: "TRF01", status: "uploaded", meta_video_id: "999" }] });
  const v = await db.videoBankItem.findMany({ where: { job: "DEMO-JOB-1" }, orderBy: { vName: "asc" } });
  check(v.length === 2 && v[0]!.status === "uploaded" && v[0]!.driveFileId === "drive123" && v[0]!.metaVideoId === "999" && v[1]!.status === "bank", "push_videos: upserted by (JOB, V name), what was not sent stays", v.map((x) => [x.vName, x.status]));

  // ── tasks ──
  const t1 = await tool("create_task", { title: "DEMO طلب 4 هوكات", assignee: "hermes", executor: "hermes", board: "main", link_type: "video", link_id: "V45", priority: "high", due_at: day(-1) });
  check(!t1.isError && t1.data?.task.status === "new" && t1.data?.task.assignee === "hermes", "create_task");
  const tid = t1.data?.task.id;
  check((await tool("list_tasks", { assignee: "hermes", status: ["new"] })).data?.tasks.some((t: { id: string }) => t.id === tid), "list_tasks finds it by assignee and status");
  check((await tool("update_task", { id: tid, status: "doing", note: "عند هيرمز" })).data?.task.status === "doing", "update_task moves it");
  await tool("update_task", { id: tid, archived: true });
  check(!(await tool("list_tasks", { assignee: "hermes" })).data?.tasks.some((t: { id: string }) => t.id === tid) && (await db.task.count({ where: { id: tid } })) === 1, "archived: gone from the list, still in the table (nothing is deleted)");
  check((await tool("create_task", { title: "DEMO اتصل 0912345678" })).isError, "a task with a phone number is refused");
  check((await tool("update_task", { id: "nope", status: "done" })).isError, "an unknown task is an error in words");

  // ── v4.1 «الأرقام»: a product's whole day, pushed and read back by the screen ──
  {
  await db.productEconomics.create({ data: { productCode: "DEMO_NUM", name: "منتج أرقام تجريبي", market: "SY", price: 20, unitCost: 5, deliveryFee: 2, returnFee: 1, codFeePct: 0.02, confirmCost: 0.3, stockDays: 30 } });
  const D0 = day(2);
  const prow = (date: string, x: Record<string, unknown>) => ({ date, level: "product", id: "DEMO_NUM", ...x });
  const dayBefore = { spend: 30, impressions: 9000, link_clicks: 180, pixel_purchases: 11, orders_in: 10, unique_customers: 10, confirmed: 7, rejected: 1, cancelled: 0, waiting: 2, shipped_orders: 5, shipped_pieces: 9, out_for_delivery: 3, stuck: 0, delivered: 3, returned: 1, revenue_shipped: 100, aov: 20, offer_breakdown: [{ offer: "قطعة", orders: 10, pieces: 1, revenue: 200 }], stock_units: 108 };
  const theDay = { spend: 40, impressions: 10000, link_clicks: 200, pixel_purchases: 14, orders_in: 12, unique_customers: 11, confirmed: 8, rejected: 2, cancelled: 1, waiting: 3, reject_reasons: [{ reason: "رقم غلط", count: 2 }], shipped_orders: 6, shipped_pieces: 9, out_for_delivery: 4, stuck: 1, delivered: 3, returned: 1, revenue_shipped: 120, offer_breakdown: [{ offer: "قطعة", orders: 8, pieces: 1, revenue: 160 }, { offer: "2 + هدية", orders: 4, pieces: 3, revenue: 104 }], aov: 22, stock_units: 90 };
  const key = (date: string) => ({ productCode_date: { productCode: "DEMO_NUM", date: new Date(`${date}T00:00:00Z`) } });
  const pday = await tool("push_metrics", { rows: [prow(D0, dayBefore), prow(Y, theDay)] });
  check(!pday.isError && pday.data?.applied === 2 && pday.data?.productDays === 2 && pday.data?.orderRows === 0 && pday.data?.tallies === 0, "product rows: two days stored as product-days — no order rows, no tallies", pday.data);
  check((await db.productDay.count({ where: { productCode: "DEMO_NUM" } })) === 2 && (await db.attributedOrder.count({ where: { omsOrderId: { startsWith: "mcp:product:" } } })) === 0, "…in ProductDay, and not one AttributedOrder was made (the product's orders are never counted twice)");
  const stored = await db.productDay.findUnique({ where: key(Y) });
  check(stored?.ordersIn === 12 && stored.uniqueCustomers === 11 && stored.stuck === 1 && Number(stored.revenueShipped) === 120 && stored.source === "mcp" && Array.isArray(stored.offerBreakdown), "the day's columns hold what was sent (orders, customers, stuck, revenue shipped, offers), source mcp", stored);
  await tool("push_metrics", { rows: [prow(Y, { waiting: 1, stock_units: 85 })] });
  const part = await db.productDay.findUnique({ where: key(Y) });
  check(part?.waiting === 1 && part.stockUnits === 85 && part.ordersIn === 12 && Number(part.spend) === 40, "a later push of only the states (waiting, stock) updates those and leaves the rest of the day as it was");
  await tool("push_metrics", { rows: [prow(D0, dayBefore), prow(Y, theDay)] });
  check((await db.productDay.count({ where: { productCode: "DEMO_NUM" } })) === 2 && (await db.productDay.findUnique({ where: key(Y) }))?.waiting === 3, "the same push again is still two rows (and puts the day back)");
  const misplaced = await tool("push_metrics", { rows: [{ date: Y, level: "ad", id: "DEMO_MCP_A1", orders_in: 5 }, prow(Y, { reject_reasons: [{ reason: "اتصل 0912345678", count: 1 }] }), prow(Y, { real_orders: 12 })] });
  check(misplaced.data?.applied === 1 && misplaced.data?.rejected.map((r: { index: number }) => r.index).join() === "0,1" && misplaced.data?.rejected[0]?.error.includes("product") && misplaced.data?.rejected[1]?.error.includes("رقم هاتف"), "a product-day field on an ad row is refused, a phone inside a reject reason is refused — the good row (real_orders = orders_in) still lands", misplaced.data?.rejected);

  const near = (a: number | null | undefined, b: number) => a !== null && a !== undefined && Math.abs(a - b) < 0.011;
  const nums = await loadNumbers({ d: "custom", from: Y, to: Y });
  const mine = nums.products.find((p) => p.code === "DEMO_NUM");
  const c = mine!.current;
  check(nums.demo === false && mine?.name === "منتج أرقام تجريبي", "loadNumbers (MOCK_MODE=0): the product is on the screen, by its name", mine?.name);
  check(near(c.spend, 40.4) && c.ordersIn === 12 && near(c.costPerOrder, 3.37) && near(c.cpm, 4) && near(c.ctr, 2) && near(c.gapPct, 16.7) && c.duplicates === 1, "ads + site: spend with the 1% card fee, cost per real order, CPM and CTR from Meta's own spend, pixel-vs-real gap, duplicates removed", c);
  check(c.confirmed === 8 && near(c.confirmRate, 80) && c.waiting === 3 && c.rejected === 2 && c.cancelled === 1 && near(c.costPerConfirmed, 5.05) && near(c.costPerDelivered, 13.47), "confirmation: rate = confirmed ÷ (confirmed + rejected) — the waiting are left out; cost per confirmed and per delivered", c);
  check(near(c.upsellRate, 33.3) && near(c.aov, 22) && mine!.offers.length === 2 && mine!.rejectReasons[0]?.reason === "رقم غلط", "offers: upsell rate from the offers of 2+ pieces, AOV, the offers, the top reject reason", { upsell: c.upsellRate, aov: c.aov });
  check(c.shippedOrders === 6 && c.shippedPieces === 9 && c.outForDelivery === 4 && c.stuck === 1 && c.delivered === 3 && c.returned === 1 && near(c.deliveryRate30, 75), "shipping: the counts as pushed; delivery rate over 30 days = delivered ÷ (delivered + returned) = 75%", c);
  check(near(c.expectedRevenue, 90) && near(c.expectedShipping, 13.5) && near(c.expectedProfit, 2.35), "money: revenue 120 × 75% = 90 · shipping 6×2 + 6×25%×1 = 13.5 · profit = 90 − goods 33.75 − shipping 13.5 − ads 40.4 = 2.35", c);
  check(c.stockUnits === 90 && near(c.stockCover, 35) && mine!.stockUrgency === null, "stock: 90 units ÷ 2.57 pieces a day (18 over the last 7 days) = 35 days — no urgency", { cover: c.stockCover, urgency: mine!.stockUrgency });
  check(mine!.prev.ordersIn === 10 && near(mine!.prev.spend, 30.3) && near(mine!.prev.costPerOrder, 3.03), "«قارن»: the day before is the previous product-day (10 orders, 30.3$, 3.03$ a real order)", mine!.prev);
  check(near(mine!.avg7.ordersIn, 10 / 7), "…and the 7-day average is the seven days before, scaled to one day (10 orders in 7 days)", mine!.avg7.ordersIn);
  const tot = nums.totals.current;
  const sumOf = (k: "ordersIn" | "shippedPieces" | "expectedProfit") => nums.products.reduce((s, p) => s + (p.current[k] ?? 0), 0);
  check(tot.ordersIn === sumOf("ordersIn") && tot.shippedPieces === sumOf("shippedPieces") && near(tot.expectedProfit, sumOf("expectedProfit")), "the totals row is the sum of the products (orders, pieces, expected profit)", tot);

  }


  // ── the tasks board (v3 E): the one-line quick add, duplicates, merge, bulk ──
  {
    const actor = { type: "user" as const, id: "demo-mcp-user" };
    const a = await quickAddTask("بكرا لميوز: DEMO اعمل 4 هوكات للطنين #stock !عاجل", actor);
    check(a.assignee === "muse" && a.priority === "urgent" && a.board === "stock" && a.title === "DEMO اعمل 4 هوكات للطنين" && !!a.dueAt, "quick add «بكرا لميوز: … #stock !عاجل» → Muse, tomorrow, the stock board, urgent", a);
    const b = await quickAddTask("DEMO اعمل 4 هوكات للطنين", actor, { board: "stock" });
    check(b.board === "stock" && b.assignee === null && b.status === "new", "…a line with no words that count is only a title, on the board the person is looking at");
    let empty = "";
    await quickAddTask("بكرا لميوز:", actor).catch((e) => (empty = e.message));
    let phone = "";
    await quickAddTask("DEMO كلّم 0912345678", actor).catch((e) => (phone = e.message));
    check(empty.includes("اكتب") && phone.includes("انرفض"), "…an empty line is asked again, a phone number in a task is refused");
    const groups = duplicateGroups((await listTasks({ board: "stock" })).filter((t) => t.title.startsWith("DEMO")));
    check(groups.length === 1 && groups[0]!.length === 2, "the same job written twice is found as a duplicate group", groups.map((g) => g.map((t) => t.title)));
    await updateTask({ id: b.id, note: "ملاحظة من النسخة التانية", due_at: "2026-11-01" }, actor);
    const merged = await mergeTasks(a.id, [b.id], actor);
    const dropped = await db.task.findUnique({ where: { id: b.id } });
    check(merged.priority === "urgent" && merged.note === "ملاحظة من النسخة التانية" && merged.dueAt?.startsWith("2026-11-01") === true && !!dropped?.archivedAt && dropped.note?.startsWith("مكرّرة") === true, "merge: the kept card takes the notes, the earliest date and the most urgent priority; the other is archived with a pointer (nothing deleted)", { merged, dropped: dropped?.note });
    check(!(await listTasks({ board: "stock" })).some((t) => t.id === b.id) && (await listTasks({ board: "stock", includeArchived: true })).some((t) => t.id === b.id), "…the archived one is off the board and still in the table");
    const c = await quickAddTask("DEMO تانية", actor);
    const bulk = await bulkUpdateTasks({ ids: [a.id, c.id], status: "doing", assignee: "hermes" }, actor);
    const after = await db.task.findMany({ where: { id: { in: [a.id, c.id] } } });
    check(bulk.updated === 2 && after.every((t) => t.status === "doing" && t.assignee === "hermes"), "bulk: two cards moved to «شغّال» and handed to Hermes in one call");
    await bulkUpdateTasks({ ids: [c.id], status: "done" }, actor);
    const old = await db.task.create({ data: { title: "DEMO قديمة", status: "done", updatedAt: new Date(Date.now() - 30 * 86_400_000) } });
    await db.$executeRaw`UPDATE "Task" SET "updatedAt" = ${new Date(Date.now() - 30 * 86_400_000)} WHERE id = ${old.id}`;
    const recent = (await listTasks({ doneWithinDays: 14, limit: 300 })).filter((t) => t.title.startsWith("DEMO"));
    check(recent.some((t) => t.id === c.id) && !recent.some((t) => t.id === old.id), "a finished task shows for two weeks, then leaves the board (it stays in the table)");
  }


  // ── الإنجاز (v3 G): the day, written from rows that already exist ──
  {
    const actor = { type: "user" as const, id: "demo-mcp-user" };
    await quickAddTask("بكرا لميوز: DEMO مهمة بكرا", actor);
    const now = new Date();
    const today = ammanKey(now);
    const t = await loadDay(today, now);
    const group = (d: typeof t, key: string) => d.done.find((g) => g.key === key);
    check(t.demo === false && t.state === "today" && t.done[0]?.key === "owner", "الإنجاز (MOCK_MODE=0): today's groups start with the owner", t.done.map((g) => g.key));
    check(group(t, "owner")?.items.some((i) => i.kind === "approval" && i.text.includes("وافق على: DEMO رفع السقف")) === true, "…the owner's answer to Claude's request is his line");
    check(group(t, "claude")?.items.some((i) => i.kind === "run" && i.text.includes("خلص ✓") && i.numbers?.includes("alerts 3")) === true, "…Claude's finished run, with the numbers it reported");
    check(group(t, "claude")?.items.some((i) => i.kind === "handoff" && i.text.includes("خلص الفحص")) === true, "…the handover Claude answered");
    check(group(t, "hermes")?.items.some((i) => i.kind === "task" && i.text.includes("DEMO تانية")) === true, "…a closed task is its assignee's (Hermes)");
    check(t.counts.done === t.done.reduce((n, g) => n + g.items.length, 0) && t.counts.done >= 4, "…the count is the lines", t.counts);
    const text = summaryOfDay(t.title, t.done, t.planned);
    check(text.includes("اللي انعمل") && text.includes("— المالك") && text.includes("DEMO رفع السقف"), "the Telegram summary reads the same lines");

    const tomorrow = await loadDay(addDays(today, 1), now);
    check(tomorrow.state === "future" && tomorrow.done.length === 0 && tomorrow.planned.some((g) => g.items.some((i) => i.kind === "scheduled")), "tomorrow: nothing done yet, the scheduled runs are planned");
    check(tomorrow.planned.find((g) => g.key === "muse")?.items.some((i) => i.kind === "due" && i.text.includes("DEMO مهمة بكرا")) === true, "…and a task due tomorrow is in its person's group (Muse)");
    const yesterday = await loadDay(addDays(today, -1), now);
    check(yesterday.state === "past" && yesterday.planned.length === 0, "a past day plans nothing");
    check(readDay("2026-02-30", now) === today && readDay("nonsense", now) === today && readDay("2026-11-20", now) === "2026-11-20" && readDay(undefined, now) === today, "a day in the address that is not a date is today");
  }

  // ── الفيديوهات (v3 D): the board per product, the four buttons, and Hermes ──
  {
    const actor = { type: "user" as const, id: "demo-mcp-user" };
    const now = new Date();
    const today = ammanKey(now);
    const d = (back: number) => addDays(today, -back);
    await db.productEconomics.create({ data: { productCode: "VID01", name: "منتج فيديوهات تجريبي", market: "SY", price: 20, unitCost: 5, deliveryFee: 2, returnFee: 1, codFeePct: 0.02, confirmCost: 0.3, stockDays: 30 } });

    // the bank as Claude pushes it: the owner's numbering, the Drive file of the video and of its scenario
    const bank = await tool("push_videos", {
      rows: [
        { job: "DEMO-JOB-V1", v_name: "V101", product: "VID01", status: "testing", drive_file_id: "DemoVideoFile101", scenario_file_id: "DemoScenarioFile101" },
        { job: "DEMO-JOB-V2", v_name: "V102", product: "VID01", status: "testing", drive_file_id: "DemoVideoFile102" },
        { job: "DEMO-JOB-V3", v_name: "V103", product: "VID01", status: "testing" },
        { job: "DEMO-JOB-V4", v_name: "V104", product: "VID01", status: "ready" },
      ],
    });
    check(!bank.isError && bank.data?.applied === 4 && (await db.videoBankItem.findFirst({ where: { job: "DEMO-JOB-V1" } }))?.scenarioFileId === "DemoScenarioFile101", "push_videos carries the scenario file too (scenario_file_id)", bank.data);

    // nine days of three ads whose names carry the video's V name — V101 doubles its cost over the last two days, V102 holds steady, V103 barely spends
    const plan: Record<string, (back: number) => { spend: number; orders: number }> = {
      VA1: (b) => ({ spend: 10, orders: b >= 3 ? 2 : 1 }),
      VA2: () => ({ spend: 10, orders: 1 }),
      VA3: (b) => ({ spend: 1.5, orders: b === 3 ? 1 : 0 }),
    };
    const names: Record<string, string> = { VA1: "SY|VID01|V101_H1", VA2: "SY|VID01|V102", VA3: "SY|VID01|V103" };
    const adRows = Object.keys(plan).flatMap((k) =>
      Array.from({ length: 9 }, (_, i) => {
        const back = i + 1;
        const x = plan[k]!(back);
        return { date: d(back), level: "ad", id: `DEMO_MCP_${k}`, parent_id: "DEMO_MCP_VS1", name: names[k], status: "ACTIVE", spend: x.spend, impressions: 1000, reach: 900, link_clicks: 20, video_3s: 300, thruplays: 100, real_orders: x.orders };
      }),
    );
    const pushed = await tool("push_metrics", {
      rows: [
        { date: d(1), level: "campaign", id: "DEMO_MCP_VC1", name: "SY_VID01_WEB_SCALE_261010_C07", status: "ACTIVE", budget_daily: 40, start_time: `${d(12)}T08:00:00+0200`, account_id: "act_demo_mcp" },
        { date: d(1), level: "adset", id: "DEMO_MCP_VS1", parent_id: "DEMO_MCP_VC1", name: "BROAD_ADV_SP_CPT0070_v1", status: "ACTIVE", budget_daily: 40 },
        ...adRows,
      ],
    });
    check(!pushed.isError && pushed.data?.applied === 2 + 27 && pushed.data?.rejected.length === 0, "the ads and their nine days land through push_metrics", pushed.data);

    await setSetting("videos.min_spend", 20, "demo-mcp");
    const board = await loadBoard(now);
    const p = board.products.find((x) => x.code === "VID01")!;
    check(board.demo === false && p?.name === "منتج فيديوهات تجريبي" && p.bank.count === 4 && p.bank.target === 50 && p.bank.short === 46, "الفيديوهات (MOCK_MODE=0): the product is on the board by its name, 4 of 50 in the bank", p?.bank);
    check(p.winners.map((v) => v.vName).join() === "V101,V102" && p.winners[0]!.costPerOrder === 6.06 && p.winners[1]!.costPerOrder === 10.1 && p.winners[0]!.orders === 10 && p.winners[0]!.spend === 60.6, "the winners are ranked by the cost of a real order: V101 (60.6$ ÷ 10 orders = 6.06$), then V102 (10.1$)", p.winners.map((v) => [v.vName, v.costPerOrder]));
    check(p.minSpend === 20 && p.minSpendFrom === "typed" && p.learning.map((v) => v.vName).join() === "V103" && p.learning[0]!.spend! < 20, "V103 spent less than the minimum the owner typed (20$): still being judged, not ranked", p.learning.map((v) => [v.vName, v.spend]));
    check(p.rest.map((v) => v.vName).join() === "V104" && p.rest[0]!.status === "ready", "V104 has no ad: it waits in the bank");
    check(p.winners[0]!.fatigue.state === "tired" && p.winners[0]!.fatigue.rise === 1 && p.winners[1]!.fatigue.state === "ok" && p.learning[0]!.fatigue.state === "unknown" && p.tiredCount === 1, "tired = the cost of a real order over the last two days is +100% over its own 7-day average (V101); V102 holds; V103 has no base yet", p.winners.map((v) => v.fatigue));
    check(p.winners[0]!.hook === 30 && p.winners[0]!.hold === 33.33 && p.winners[0]!.ctr === 2 && p.winners[0]!.days === 13, "hook, hold, CTR and days live are the ads table's numbers (30% · 33.33% · 2% · 13 days: the campaign started 12 days ago, and the first day counts)", p.winners[0]);
    check(p.winners[0]!.previewUrl === "https://drive.google.com/file/d/DemoVideoFile101/preview" && p.winners[0]!.scenarioUrl === "https://drive.google.com/file/d/DemoScenarioFile101/view" && p.winners[1]!.scenarioUrl === null, "the card links to its Drive preview and to its scenario file (and says so when there is none)");

    // the four buttons: one request each, a card on المهام, and what it carries
    const r1 = await createVideoRequest({ key: "DEMO-JOB-V1|V101", kind: "new_hooks", note: "نفس الجسم" }, actor, now);
    check(r1.created && r1.request.status === "asked" && r1.request.via === "none" && r1.request.job === "DEMO-JOB-V1" && r1.request.scenarioFileId === "DemoScenarioFile101", "«بدو هوكات جديدة»: a request with the JOB and the scenario file — no channel to Hermes yet, so it stays «طلب»", r1.request);
    const nums = r1.request.numbers as { costPerOrder: number; orders: number; fatigue: string };
    check(nums.costPerOrder === 6.06 && nums.orders === 10 && nums.fatigue === "tired", "…the numbers it carries are the ones the code computed (6.06$ a real order, 10 orders, tired)", nums);
    const t1 = await db.task.findUnique({ where: { id: r1.request.taskId! } });
    check(t1?.title === "هوكات جديدة على V101 · JOB DEMO-JOB-V1" && t1.assignee === "hermes" && t1.executor === "hermes" && t1.status === "new" && t1.linkType === "video" && t1.linkId === r1.request.id && t1.note!.includes("DemoScenarioFile101") && t1.note!.includes("تكلفة الطلب 6.1$"), "…and a card on المهام for Hermes, with the JOB, the scenario link and the numbers in it", t1);
    const again = await createVideoRequest({ key: "DEMO-JOB-V1|V101", kind: "new_hooks" }, actor, now);
    check(!again.created && again.request.id === r1.request.id && (await db.videoRequest.count({ where: { job: "DEMO-JOB-V1" } })) === 1, "asking the same thing about the same video while it is open returns the open request (nothing is asked twice)");
    const board2 = await loadBoard(now);
    const p2 = board2.products.find((x) => x.code === "VID01")!;
    check(p2.winners[0]!.request?.id === r1.request.id && p2.winners[0]!.request?.statusLabel === "طلب" && p2.requests.length === 1 && board2.totals.openRequests >= 1, "the open request shows on the video's card and on the product");

    // delivery to Hermes: its API (a local stand-in here), and what happens when it is down
    const got: { path: string; auth?: string; body: any }[] = [];
    let down = false;
    const hermes = createServer((req, res) => {
      let s = "";
      req.on("data", (c) => (s += c)).on("end", () => {
        got.push({ path: req.url ?? "", auth: req.headers.authorization, body: s ? JSON.parse(s) : null });
        res.statusCode = down ? 500 : 200;
        res.end("{}");
      });
    });
    await new Promise<void>((ok) => hermes.listen(0, "127.0.0.1", ok));
    process.env.HERMES_BASE_URL = `http://127.0.0.1:${(hermes.address() as { port: number }).port}`;
    process.env.HERMES_TOKEN = "demo-hermes-token";
    const r2 = await createVideoRequest({ key: "DEMO-JOB-V2|V102", kind: "to_test" }, actor, now);
    const sent = got[0];
    check(r2.request.via === "api" && r2.request.status === "with_hermes" && !!r2.request.deliveredAt && sent?.path === "/requests" && sent.auth === "Bearer demo-hermes-token", "«ارفعه للتيست» with HERMES_BASE_URL set: it reaches Hermes by the API (Bearer token) and the request is «عند هيرمز»", { via: r2.request.via, sent: sent && { path: sent.path } });
    check(sent?.body.job === "DEMO-JOB-V2" && sent.body.kind === "to_test" && sent.body.product === "VID01" && sent.body.numbers.orders === 6 && sent.body.reply.claim.endsWith(`/api/v1/video-requests/${r2.request.id}/claim`) && !JSON.stringify(sent.body).includes("demo-hermes-token"), "…the payload carries the JOB, the numbers and where to answer — and never the token", sent?.body);
    check((await db.task.findUnique({ where: { id: r2.request.taskId! } }))?.status === "doing", "…and its card on المهام is «شغّال»");
    down = true;
    const r3 = await createVideoRequest({ key: "DEMO-JOB-V3|V103", kind: "new_script" }, actor, now);
    check(r3.request.status === "asked" && r3.request.via === "none" && r3.request.deliveryError === "Hermes answered 500", "Hermes down (500): the request stays «طلب» and says why — it is not lost, Hermes can still pull it", r3.request);
    down = false;
    const r4 = await createVideoRequest({ key: "DEMO-JOB-V1|V101", kind: "tired" }, actor, now);
    const flagged = await db.videoBankItem.findFirst({ where: { job: "DEMO-JOB-V1" } });
    check(r4.created && r4.request.via === "api" && flagged?.status === "fatigued", "«تعب»: a request too, and the video's own flag in the bank turns «تعبان» (nothing else about it changes)");
    check((await createVideoRequest({ key: "DEMO-JOB-V1|V101", kind: "new_script", note: "كلّم 0912345678" }, actor, now).catch((e: Error) => e.message)).toString().includes("انرفض"), "a note with a phone number is refused");
    check((await createVideoRequest({ key: "no|such", kind: "tired" }, actor, now).catch((e: Error & { status?: number }) => e.status)) === 404, "a video that is not in the bank is 404");

    // Hermes pulls the queue over REST, takes one, answers it
    const hermesTok = newToken("mbh_");
    await db.apiToken.create({ data: { name: "demo-mcp-hermes", scopes: ["handoff"], tokenHash: hashToken(hermesTok), prefix: hermesTok.slice(0, 10) } });
    const other = newToken("mbh_");
    await db.apiToken.create({ data: { name: "demo-mcp-other", scopes: ["handoff"], tokenHash: hashToken(other), prefix: other.slice(0, 10) } });
    const vr = (route: (r: Request, c: { params: { id: string } }) => Promise<Response>, path: string, body: unknown = undefined, token: string | null = hermesTok, id = "") =>
      route(new Request(`http://localhost:3140/api/v1/video-requests${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), { params: { id } });
    check((await vr(vrList as never, "", undefined, null)).status === 401 && (await vr(vrList as never, "", undefined, studio)).status === 403, "REST /api/v1/video-requests: no token → 401, a studio token → 403");
    const queue = (await (await vr(vrList as never, "?status=asked,with_hermes&product=VID01")).json()) as { requests: { id: string; job: string; status: string; numbers: { orders: number } }[] };
    check(queue.requests.length === 4 && queue.requests.some((q) => q.id === r3.request.id && q.status === "asked") && queue.requests.every((q) => q.job.startsWith("DEMO-JOB")), "…a «handoff» token lists the open requests, each with its JOB and numbers", queue.requests.map((q) => [q.job, q.status]));
    const claimed = await vr(vrClaim as never, "/x/claim", {}, hermesTok, r3.request.id);
    const claimedJson = (await claimed.json()) as { request: { status: string; claimedBy: string } };
    check(claimed.status === 200 && claimedJson.request.status === "with_hermes" && claimedJson.request.claimedBy === "demo-mcp-hermes", "claim: «عند هيرمز», with the taker's name", claimedJson);
    check((await vr(vrClaim as never, "/x/claim", {}, other, r3.request.id)).status === 409 && (await vr(vrClaim as never, "/x/claim", {}, hermesTok, r3.request.id)).status === 200 && (await vr(vrClaim as never, "/x/claim", {}, hermesTok, "no-such-id")).status === 404, "…a second taker is refused (409), the same taker is fine, an unknown request is 404");
    const done = await vr(vrComplete as never, "/x/complete", { note: "4 سيناريوهات جاهزة", new_videos: [{ job: "DEMO-JOB-V9", v_name: "V109", drive_file_id: "DemoVideoFile109", scenario_file_id: "DemoScenarioFile109" }] }, hermesTok, r3.request.id);
    const doneJson = (await done.json()) as { request: { status: string; resultNote: string; readyAt: string | null } };
    const made = await db.videoBankItem.findFirst({ where: { job: "DEMO-JOB-V9" } });
    check(done.status === 200 && doneJson.request.status === "ready" && doneJson.request.resultNote === "4 سيناريوهات جاهزة" && !!doneJson.request.readyAt, "complete: the request is «جاهز»", doneJson);
    check(made?.productCode === "VID01" && made.status === "ready" && made.scenarioFileId === "DemoScenarioFile109", "…and what Hermes made lands in the bank as «جاهز», for the same product, with its scenario");
    check((await db.task.findUnique({ where: { id: r3.request.taskId! } }))?.status === "waiting_approval", "…its card on المهام moves to «بانتظار موافقة» (the owner has to look)");
    check((await vr(vrComplete as never, "/x/complete", { note: "تاني" }, hermesTok, r3.request.id)).status === 409 && (await vr(vrComplete as never, "/x/complete", { note: "كلّم 0912345678" }, hermesTok, r2.request.id)).status === 400 && (await vr(vrComplete as never, "/x/complete", { nonsense: 1 }, hermesTok, r2.request.id)).status === 422, "…answering twice is 409, a phone number in the answer is refused, a bad body is 422");

    // the owner closes it: uploaded; and cancels another — nothing is deleted
    const up = await moveVideoRequest(r3.request.id, "uploaded", actor, now);
    check(up.status === "uploaded" && !!up.uploadedAt && (await db.task.findUnique({ where: { id: r3.request.taskId! } }))?.status === "done", "the owner marks it «مرفوع»: the card on المهام is «خلص»");
    check((await moveVideoRequest(r3.request.id, "asked", actor, now).catch((e: Error & { status?: number }) => e.status)) === 409, "a finished request does not go back (409)");

    // …and over MCP: the same queue for a client that speaks MCP and not REST
    const r5 = await createVideoRequest({ key: "DEMO-JOB-V9|V109", kind: "new_hooks" }, actor, now);
    const lst = await tool("get_video_requests", { product: "VID01" });
    check(!lst.isError && ((lst.data?.requests as { id: string }[]) ?? []).some((q) => q.id === r5.request.id), "MCP get_video_requests lists the open request", lst.text);
    const cl = await tool("claim_video_request", { id: r5.request.id });
    check(!cl.isError && (cl.data?.request as { claimedBy: string } | undefined)?.claimedBy === "demo-mcp", "MCP claim_video_request takes it under the token's name", cl.text);
    check((await tool("claim_video_request", { id: "no-such-id" })).isError, "…an unknown request is an error in words, not a crash");
    const cp = await tool("complete_video_request", { id: r5.request.id, note: "3 هوكات جاهزة" });
    check(!cp.isError && (cp.data?.request as { status: string } | undefined)?.status === "ready", "MCP complete_video_request closes it «جاهز»", cp.text);
    check((await tool("complete_video_request", { id: r5.request.id, note: "تاني" })).isError, "…and a finished request cannot be answered twice");
    await moveVideoRequest(r5.request.id, "uploaded", actor, now); // off the board again, so the checks below see what they saw before
    const cancelled = await moveVideoRequest(r2.request.id, "cancelled", actor, now);
    const cancelTask = await db.task.findUnique({ where: { id: r2.request.taskId! } });
    check(cancelled.status === "cancelled" && !!cancelTask?.archivedAt && (await db.videoRequest.count({ where: { id: r2.request.id } })) === 1, "cancelled: the request stays (as cancelled) and its card is archived — nothing is deleted");
    const board3 = await loadBoard(now);
    const open3 = board3.products.find((x) => x.code === "VID01")!.requests.map((r) => r.id).sort();
    check(open3.join() === [r1.request.id, r4.request.id].sort().join(), "the board lists only the open ones (the uploaded and the cancelled are off it)", open3);
    const bank3 = board3.products.find((x) => x.code === "VID01")!;
    check(bank3.bank.count === 5 && bank3.rest.some((v) => v.vName === "V109"), "the new video is in the bank: 5 of 50, waiting its turn");

    hermes.close();
    delete process.env.HERMES_BASE_URL;
    delete process.env.HERMES_TOKEN;
  }

  // ── درايف (v3 I): the owner's «Zaki Production» tree, read only — files, scenarios and his register ──
  {
    const now = new Date();
    // the bank as it stands: V301 has no file, V302 already points at one of his own, V303 has nothing
    await db.videoBankItem.createMany({
      data: [
        { job: "DEMO-JOB-D1", vName: "V301", productCode: "VID01", status: "bank", source: "mcp" },
        { job: "DEMO-JOB-D2", vName: "V302", productCode: "VID01", status: "bank", source: "mcp", driveFileId: "MINEfileabc" },
        { job: "DEMO-JOB-D3", vName: "V303", productCode: "VID01", status: "bank", source: "mcp" },
      ],
    });
    // a stand-in Drive: a tree of folders and files, and a register as CSV
    const FOLDER = "application/vnd.google-apps.folder";
    const reg = [
      "JOB,اسم الفيديو,المنتج,الحالة,رابط الفيديو",
      "DEMO-JOB-D1,V301,VID01,,https://drive.google.com/file/d/RegisterDriveD1abc/view",
      "DEMO-JOB-D2,V302,VID01,,",
      "DEMO-JOB-D4,V304,VID01,جاهز,",
      "DEMO-JOB-D5,V305,منتج بلا اسم معروف,,",
      ",,,,",
    ].join("\n");
    const tree: Record<string, { name: string; mimeType: string; parent: string }> = {
      F06: { name: "06_الفيديوهات النهائية", mimeType: FOLDER, parent: "ROOT" },
      F03: { name: "03_السيناريوهات", mimeType: FOLDER, parent: "ROOT" },
      REG: { name: "سجل الفيديوهات.csv", mimeType: "text/csv", parent: "ROOT" },
      P1: { name: "VID01", mimeType: FOLDER, parent: "F06" },
      P2: { name: "منتج مجهول", mimeType: FOLDER, parent: "F06" },
      V1: { name: "V301.mp4", mimeType: "video/mp4", parent: "P1" },
      V2: { name: "V302.mp4", mimeType: "video/mp4", parent: "P1" },
      V3: { name: "V303_v2.mp4", mimeType: "video/mp4", parent: "P1" },
      V4: { name: "random clip.mp4", mimeType: "video/mp4", parent: "P1" },
      V5: { name: "V999.mp4", mimeType: "video/mp4", parent: "P2" },
      S1: { name: "V303 سيناريو.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", parent: "F03" },
      S2: { name: "JOB DEMO-JOB-D4 سيناريو.docx", mimeType: "application/vnd.google-apps.document", parent: "F03" },
    };
    const ids: Record<string, string> = { V1: "FolderFileV301abc", V2: "FolderFileV302abc", V3: "FolderFileV303abc", S1: "ScenFileV303abc", S2: "ScenFileD4abc" };
    const idOf = (k: string) => ids[k] ?? k;
    const seen: { method: string; url: string }[] = [];
    const drive = (async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      seen.push({ method, url });
      if (url.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "ya29.demo", expires_in: 3600 }));
      const q = new URL(url).searchParams.get("q");
      if (q) {
        const parent = /'([^']+)' in parents/.exec(q)![1]!;
        const onlyFolders = q.includes("mimeType = 'application/vnd.google-apps.folder'");
        const kids = Object.entries(tree).filter(([, f]) => f.parent === parent && (!onlyFolders || f.mimeType === FOLDER)).map(([k, f]) => ({ id: idOf(k), name: f.name, mimeType: f.mimeType }));
        return new Response(JSON.stringify({ files: kids }));
      }
      if (url.includes("alt=media")) return new Response(reg);
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    // folders keep their keys as ids (F06, P1…), files get the long ids above
    for (const [k, f] of Object.entries(tree)) if (f.mimeType === FOLDER) ids[k] = k;
    ids.REG = "RegisterFileDemoabc";
    const o = { account: { client_email: "demo-library@test.iam.gserviceaccount.com", private_key: privateKey }, fetch: drive };

    const run1 = await syncDriveLibrary(o, "ROOT");
    check(run1.folders.finals && run1.folders.scenarios && run1.register === "read" && run1.registerRows === 4, "drive.library: finds the two folders by name and reads the register (4 rows; the empty line is skipped)", run1);
    check(run1.created === 1 && (await db.videoBankItem.findFirst({ where: { job: "DEMO-JOB-D4" } }))?.status === "ready" && (await db.videoBankItem.findFirst({ where: { job: "DEMO-JOB-D4" } }))?.source === "drive", "a video the register has and the bank lacks is added, as the register says («جاهز»), source drive");
    check(run1.problems.some((p) => p.includes("منتج بلا اسم معروف")) && (await db.videoBankItem.count({ where: { job: "DEMO-JOB-D5" } })) === 0, "a product the app does not know creates nothing, and is named");
    const bankNow = Object.fromEntries((await db.videoBankItem.findMany({ where: { job: { startsWith: "DEMO-JOB-D" } } })).map((b) => [b.vName, b]));
    check(bankNow.V301?.driveFileId === "RegisterDriveD1abc", "the register fills a video's EMPTY file (V301) — and the file the folder holds for it is a conflict, not an overwrite", { drive: bankNow.V301?.driveFileId, conflicts: run1.conflicts });
    check(bankNow.V302?.driveFileId === "MINEfileabc" && run1.conflicts.some((c) => c.includes("V302.mp4")), "V302 keeps the file it already had; the folder's file is listed as a conflict");
    check(bankNow.V303?.driveFileId === "FolderFileV303abc" && run1.linkedVideos === 1, "V303 had nothing: the folder's «V303_v2.mp4» becomes its file (a version tail still names V303)");
    check(bankNow.V303?.scenarioFileId === "ScenFileV303abc" && bankNow.V304?.scenarioFileId === "ScenFileD4abc" && run1.linkedScenarios === 2, "scenarios: by the V name (V303) and, with none, by the JOB number (V304)");
    check(run1.unmatched.includes("random clip.mp4") && run1.unmatched.includes("V999.mp4") && run1.unmappedFolders.join() === "منتج مجهول", "a file that fits no video is listed, and a product folder the app does not know is named", { unmatched: run1.unmatched, unmapped: run1.unmappedFolders });
    check((await db.alert.count({ where: { kind: "drive.library_unmapped" } })) === 1, "…said once as an alert");
    check(seen.every((s) => s.method === "GET" || s.url.startsWith("https://oauth2.googleapis.com/token")) && !seen.some((s) => /alt=media/.test(s.url) && !s.url.includes("RegisterFileDemoabc")), "READ ONLY: Drive saw only sign-in and GETs, and only the register's content was read");

    const run2 = await syncDriveLibrary(o, "ROOT");
    check(run2.created === 0 && run2.linkedVideos === 0 && run2.linkedScenarios === 0 && run2.already >= 3 && (await db.alert.count({ where: { kind: "drive.library_unmapped" } })) === 1, "a second pass changes nothing: no new rows, no new links, the alert is not repeated", run2);

    const board = await loadBoard(now);
    const rest = board.products.find((x) => x.code === "VID01")!.rest.find((v) => v.vName === "V303");
    check(rest?.previewUrl === "https://drive.google.com/file/d/FolderFileV303abc/preview" && rest.scenarioUrl === "https://drive.google.com/file/d/ScenFileV303abc/view", "…and the board's card for V303 now has its Drive preview and its scenario link", rest);

    // a folder with no register and no scenarios is not an error: it says what is missing
    const bare = await syncDriveLibrary({ ...o, fetch: (async (url: string) => (String(url).startsWith("https://oauth2.googleapis.com/token") ? new Response(JSON.stringify({ access_token: "ya29.demo", expires_in: 3600 })) : new Response(JSON.stringify({ files: [] })))) as unknown as typeof fetch }, "EMPTYROOT");
    check(!bare.folders.finals && !bare.folders.scenarios && bare.register === "none" && bare.problems.length === 2, "an empty shared folder: nothing is read, both missing folders are named", bare.problems);
  }

  // ── الورك فلو: الرسم والنسخ (v3 F) — a workflow made from a template, edited, versioned, copied ──
  {
    const actor = { type: "user" as const, id: "demo-mcp-user" };
    const okg = (e: { ok: boolean; graph?: WfGraph; error?: string }): WfGraph => {
      if (!e.ok || !e.graph) throw new Error(e.error ?? "edit refused");
      return e.graph;
    };
    const made = await createWorkflow({ name: "DEMO رسم بموافقة", template: "approval" }, actor);
    check(/^wf-[0-9a-f]{6}$/.test(made.key) && made.version === 1 && made.graph.nodes.every((n) => typeof n.x === "number" && typeof n.y === "number"), "a workflow from the «بموافقتك» template: its own key, version 1, every step already placed on the board", { key: made.key, version: made.version });
    check(made.graph.nodes.some((n) => n.type === "approval" && n.permission === "red") && made.enabled, "…with its approval gate red, and switched on (Claude can log_run against its key at once)");
    const v1 = await listVersions(made.key);
    check(v1?.length === 1 && v1[0]!.version === 1 && v1[0]!.current && v1[0]!.note === "من قالب «بموافقتك»", "its first version is in the history, with where it came from", v1?.map((v) => [v.version, v.note]));

    // the owner renames a step and saves: version 2, and the one it replaced is kept
    const g1 = made.graph;
    const g2 = okg(setNode(g1, "prepare", { label: "DEMO تحضير الاقتراح", prompt: "اقرا {{product}} وجهّز الاقتراح" }));
    const saved2 = await updateWorkflow(made.key, { graph: g2 }, actor);
    check(saved2?.version === 2 && saved2.graph.nodes.find((n) => n.id === "prepare")?.label === "DEMO تحضير الاقتراح", "saving an edited drawing is a new version (2)");
    const again = await updateWorkflow(made.key, { graph: g2 }, actor);
    check(again?.version === 2 && (await db.workflowVersion.count({ where: { workflow: { key: made.key } } })) === 2, "…saving the same drawing again is not another version");

    // a line, a step and the owner's own note
    const g3 = okg(addAfter(g2, "notify", "wait"));
    const saved3 = await updateWorkflow(made.key, { graph: g3, note: "DEMO أضفت انتظار بالآخر" }, actor);
    check(saved3?.version === 3 && saved3.graph.nodes.length === g2.nodes.length + 1, "a step added: version 3, with the owner's note");
    const hist = (await listVersions(made.key))!;
    check(hist.map((v) => v.version).join() === "3,2,1" && hist[0]!.current && !hist[1]!.current && hist[0]!.note === "DEMO أضفت انتظار بالآخر" && hist[1]!.note === "1 تعديل", "the history lists 3, 2, 1 — the note is the owner's, or what the code counted («1 تعديل»)", hist.map((v) => [v.version, v.note]));
    check(hist[2]!.graph.nodes.find((n) => n.id === "prepare")?.label === g1.nodes.find((n) => n.id === "prepare")?.label && hist[2]!.graph.nodes.length === g1.nodes.length, "…and version 1 still holds the drawing as it was (nothing is rewritten, nothing is deleted)");

    // going back is a new version made of an old one
    const back = await updateWorkflow(made.key, { graph: hist[2]!.graph, note: "رجوع لنسخة 1" }, actor);
    check(back?.version === 4 && back.graph.nodes.length === g1.nodes.length && (await listVersions(made.key))!.length === 4, "going back to version 1 makes version 4 (history only grows)");

    // what is refused
    const phone = await updateWorkflow(made.key, { graph: okg(setNode(g3, "prepare", { prompt: "كلّم الزبون 0912345678" })) }, actor).catch((e: Error) => e.message);
    const phoneName = await updateWorkflow(made.key, { name: "DEMO اتصل 0912345678" }, actor).catch((e: Error) => e.message);
    check(String(phone).includes("انرفض") && String(phoneName).includes("انرفض"), "a customer's number in a step's text (or in the name) is refused — the drawing is read by Claude");
    check(!WorkflowPatch.safeParse({ graph: { nodes: [g3.nodes[0]], edges: [{ from: g3.nodes[0]!.id, to: "ghost" }] } }).success, "a drawing with a line to a step that does not exist is refused by the schema");
    check((await db.workflow.findUnique({ where: { key: made.key } }))?.version === 4, "…and none of those changed the workflow");

    // a copy, and what cannot be made
    const copy = await createWorkflow({ name: "DEMO نسخة", copy_of: made.key }, actor);
    const cv = (await listVersions(copy.key))!;
    check(copy.key !== made.key && copy.version === 1 && copy.graph.nodes.length === g1.nodes.length && cv[0]!.note?.startsWith("نسخة من") === true, "a copy of another workflow: a new key, its drawing, version 1 saying where it came from", cv[0]?.note);
    const badTpl = await createWorkflow({ name: "DEMO x", template: "nope" }, actor).catch((e: Error) => e.message);
    const badCopy = await createWorkflow({ name: "DEMO x", copy_of: "no-such" }, actor).catch((e: Error) => e.message);
    check(String(badTpl).includes("مش معروف") && String(badCopy).includes("مش موجود") && (await db.workflow.count({ where: { name: "DEMO x" } })) === 0, "an unknown template or an unknown workflow to copy is said, and nothing is made");

    // a seeded workflow nobody edited still shows its first version
    const seeded = await listVersions("daily-check");
    check(seeded?.length === 1 && seeded[0]!.current && seeded[0]!.note === "النسخة الأولى" && (await listVersions("no-such")) === null, "a seeded workflow nobody edited lists its one (current) version; an unknown key is null");

    // the board's layout is the editor's: a seeded drawing without places comes out placed and without overlaps
    const placed = ensureLayout(seeded![0]!.graph);
    check(isPlaced(placed) && placed.nodes.length === seeded![0]!.graph.nodes.length, "the editor lays a seeded drawing out on first open (the same layout every time)");
  }


  // ── المساعد الذكي (v3 H): the assistant over the real loaders and the real database, with a scripted stand-in for the model ──
  {
    const caller = { id: "demo-mcp-user", role: "OWNER" as const, demo: false };
    const now = new Date();
    const wasPrivacy = process.env.PRIVACY_MODE;
    const wasKey = process.env.ANTHROPIC_API_KEY;
    process.env.PRIVACY_MODE = "off";
    const modelName = "demo-model";
    const usage = { input_tokens: 4200, output_tokens: 310 };
    const toolUse = (name: string, input: unknown): LlmResponse => ({ content: [{ type: "tool_use", id: `tu_${name}`, name, input }], stop_reason: "tool_use", usage });
    const said = (text: string): LlmResponse => ({ content: [{ type: "text", text }], stop_reason: "end_turn", usage });
    const lastResults = (req: LlmRequest) => ((req.messages[req.messages.length - 1]!.content as { tool_use_id: string; content: string; is_error?: boolean }[]).map((b) => ({ id: b.tool_use_id, error: !!b.is_error, data: JSON.parse(b.content) })));
    const scripted = (...steps: ((req: LlmRequest) => LlmResponse)[]): Llm & { calls: number } => {
      const m = { calls: 0, create: async (req: LlmRequest) => steps[Math.min(m.calls++, steps.length - 1)]!(req) };
      return m;
    };
    const ask = (question: string, llm: Llm) => askAssistant({ question, history: [], place: { key: "today", label: "اليوم" } }, caller, { llm, model: modelName, now });

    // the question that is the quality gate: the answer is the dashboard's number
    const dash = await loadNumbers({ d: "custom", from: Y, to: Y }, now);
    const mineN = dash.products.find((p) => p.code === "DEMO_NUM")!;
    const expected = formatStat(STATS.find((s) => s.key === "costPerOrder")!, mineN.current.costPerOrder);
    const q1 = scripted(
      () => toolUse("get_numbers", { range: "custom", from: Y, to: Y, product: "أرقام تجريبي", stats: ["costPerOrder", "ordersIn"] }),
      (req) => said(`تكلفة الطلب الحقيقي لمنتج الأرقام التجريبي ${lastResults(req)[0]!.data.scopes[0].stats[0].display} (حقيقي).`),
    );
    const a1 = await ask("كم كلفة الطلب الحقيقي لمنتج أرقام تجريبي؟", q1);
    check(expected === "3.37$" && a1.answer.includes(expected) && a1.verified && a1.unsupported.length === 0, "assistant — the quality gate: «كم كلفة الطلب الحقيقي؟» is the number «الأرقام» shows (3.37$), on the real database", { expected, answer: a1.answer });
    check(a1.facts[0]?.raw === mineN.current.costPerOrder && a1.facts[0]?.cited === true && a1.sources[0]?.href === `/?tab=numbers&d=custom&from=${Y}&to=${Y}`, "…its «الأرقام اللي جاوبت منها» is the code's line (raw value, cited) and links to the screen that holds it", a1.facts[0]);
    const runs = await db.agentRun.findMany({ where: { agent: "M12", model: modelName }, orderBy: { createdAt: "asc" } });
    check(runs.length === 2 && runs.every((r) => r.ok && r.provider === "anthropic" && r.tokensIn === 4200 && r.tokensOut === 310 && Number(r.costUsd) > 0), "every call to the model is an AgentRun row (M12): tokens, cost, ok", runs.map((r) => [r.tokensIn, r.tokensOut, Number(r.costUsd)]));

    // a number the model makes up is caught
    const lie = await ask("كم الصرف؟", scripted(() => said("الصرف 999.99$ امبارح."), () => said("الصرف 999.99$ (متأكد).")));
    check(!lie.verified && lie.unsupported.join() === "999.99$", "a number no tool returned is named, and the answer goes out marked", lie.unsupported);

    // tasks: made at once, by the owner's word; a customer's number is refused
    const t1 = await ask("اعملي مهمة", scripted(() => toolUse("create_task", { title: "DEMO متابعة الكرتون", assignee: "muse", due_at: day(-1) }), (req) => said(`عملت «${lastResults(req)[0]!.data.title}».`)));
    const taskRow = await db.task.findFirst({ where: { title: "DEMO متابعة الكرتون" } });
    check(taskRow?.source === "assistant" && taskRow.assignee === "muse" && t1.artifacts[0]?.kind === "task_created" && (await db.auditLog.count({ where: { action: "assistant.tool", targetId: "demo-mcp-user" } })) >= 1, "create_task makes the task (source «assistant»), shows a card, and leaves a trail in the audit log");
    const t2 = await ask("اعملي مهمة", scripted(() => toolUse("create_task", { title: "DEMO كلّم 0944123456" }), (req) => said(lastResults(req)[0]!.error ? "انرفضت" : "انعملت")));
    check(t2.answer === "انرفضت" && (await db.task.count({ where: { title: { contains: "0944123456" } } })) === 0, "a task with a customer's number is refused by the task service itself");

    // a change: proposed, checked by the code, and it WAITS — nothing executed, nothing changed on the campaign
    const before = await db.campaign.findUnique({ where: { metaId: "DEMO_MCP_C1" } });
    const p1 = await ask("وقّف الحملة", scripted(() => toolUse("propose_change", { sentence: "DEMO إيقاف حملة تكلفة طلبها فوق الحد", items: [{ op: "pause", object_type: "campaign", object_id: "DEMO_MCP_C1" }] }), (req) => said(`اقترحت (${lastResults(req)[0]!.data.state})`)));
    const cs = await db.changeSet.findFirst({ where: { sourceRef: "assistant:demo-mcp-user" }, include: { items: true } });
    const after = await db.campaign.findUnique({ where: { metaId: "DEMO_MCP_C1" } });
    check(cs?.source === "agent" && (cs.state === "pending_approval" || cs.state === "simulated") && cs.items.length === 1 && cs.items[0]!.op === "pause" && !cs.executedAt && p1.artifacts[0]?.kind === "change_proposed", "propose_change: a ChangeSet from source «agent» — waiting for the owner's yes (or only recorded, when the account runs as an advisor) — never executed, with its card", cs?.state);
    check(before?.status === after?.status && before?.dailyBudget?.toString() === after?.dailyBudget?.toString(), "…and the campaign itself did not change");
    const sets = await db.changeSet.count({ where: { sourceRef: "assistant:demo-mcp-user" } });
    const bad = await ask("زوّد", scripted(() => toolUse("propose_change", { sentence: "DEMO زيادة كبيرة", items: [{ op: "set_budget", object_type: "campaign", object_id: "DEMO_MCP_C1", daily_budget: 400 }, { op: "pause", object_type: "campaign", object_id: "NO_SUCH_ID" }] }), (req) => said(lastResults(req)[0]!.error ? lastResults(req)[0]!.data.error : "انعمل")));
    check(bad.answer.includes("±50%") && (await db.changeSet.count({ where: { sourceRef: "assistant:demo-mcp-user" } })) === sets, "a budget ten times the current one, and an object that is not there, are refused by the code's own check — nothing is proposed", bad.answer);

    // drafts are not saved; the owner's click saves one, switched off
    const g = await ask("ارسم", scripted(() => toolUse("draft_workflow", { name: "DEMO مسودة المساعد", nodes: [{ id: "start", type: "trigger", label: "كل صباح", executor: "system" }, { id: "read", type: "step", label: "اقرا الأرقام", executor: "claude_mcp" }], edges: [{ from: "start", to: "read" }] }), () => said("جهّزت مسودة")));
    const draft = g.artifacts[0];
    check(draft?.kind === "workflow_draft" && (await db.workflow.count({ where: { name: "DEMO مسودة المساعد" } })) === 0, "draft_workflow: a card with the laid-out drawing — and nothing saved");
    const savedDraft = draft?.kind === "workflow_draft" ? await createWorkflow({ name: draft.name, graph: draft.graph, enabled: false, note: "مسودة من المساعد" }, { type: "user", id: "demo-mcp-user" }) : null;
    check(savedDraft?.enabled === false && savedDraft.version === 1 && (await listVersions(savedDraft.key))?.[0]?.note === "مسودة من المساعد", "the owner opens it: a workflow made SWITCHED OFF, version 1 «مسودة من المساعد»");
    const both = await createWorkflow({ name: "DEMO x", template: "blank", graph: savedDraft!.graph }, { type: "user", id: "demo-mcp-user" }).catch((e: Error) => e.message);
    check(String(both).includes("واحد منهم بس"), "a ready drawing together with a template is refused");

    // privacy: a phone number never leaves; the refusal is logged; PRIVACY_MODE=internal_only keeps the assistant off
    const spy = scripted(() => said("ما لازم أوصل هون"));
    const refused = await ask("اتصل بالزبون 0912345678", spy).then(() => null, (e) => e);
    check(refused instanceof PrivacyRefusal && spy.calls === 0 && (await db.agentRun.count({ where: { agent: "M12", model: modelName, blocked: "phone" } })) === 1, "a question with a phone number is refused before anything is sent, and the refusal is logged");
    process.env.PRIVACY_MODE = "internal_only";
    const off = await ask("كم الصرف؟", spy).then(() => null, (e) => e);
    check(off instanceof AssistantError && off.code === "off" && spy.calls === 0, "PRIVACY_MODE=internal_only: the assistant (an external model) stays off — no call");
    process.env.PRIVACY_MODE = "off";

    // the caps: at a cap it stops, in words, without calling the model
    const caps = (await getSetting("agents.daily_caps")) as Record<string, number>;
    await setSetting("agents.daily_caps", { ...caps, M12: 0.0001 }, "demo-mcp-user");
    const capped = await ask("كم الصرف؟", spy);
    check(spy.calls === 0 && capped.answer.includes("للحد اليومي") && capped.steps === 1, "a daily cap that is reached stops it with a sentence — the model is not asked", capped.answer);
    await setSetting("agents.daily_caps", { ...caps, M12: 0 }, "demo-mcp-user");
    const monthly = Number(await getSetting("agents.monthly_cap"));
    await setSetting("agents.monthly_cap", 0.0001, "demo-mcp-user");
    const cappedM = await ask("كم الصرف؟", spy);
    check(spy.calls === 0 && cappedM.answer.includes("للحد الشهري"), "…and so does the monthly cap (all agents together); a daily cap of 0 means «no cap»", cappedM.answer);
    await setSetting("agents.monthly_cap", monthly, "demo-mcp-user");
    await setSetting("agents.daily_caps", caps, "demo-mcp-user");

    // the route: with no key (or with PRIVACY_MODE keeping it off) it falls back to the consultant and says why
    delete process.env.ANTHROPIC_API_KEY;
    const info = await (await assistantGet()).json();
    check(info.mode === "consultant" && String(info.notice).includes("ANTHROPIC_API_KEY") && info.canDraft === false, "GET /api/assistant without a key: mode «consultant», and it says which variable is missing", info);
    const fb = await (await assistantPost(new Request("http://localhost:3140/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "كيف الوضع؟", place: { key: "today", label: "اليوم" } }) }))).json();
    check(fb.mode === "consultant" && fb.verified === true && Array.isArray(fb.facts) && String(fb.notice).includes("ANTHROPIC_API_KEY"), "POST /api/assistant without a key: the consultant's answer from the code's facts, with the reason", { mode: fb.mode, notice: fb.notice });
    const bigQ = await assistantPost(new Request("http://localhost:3140/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "x".repeat(1200) }) }));
    check(bigQ.status === 400, "a question over 1000 characters is a 400");
    process.env.ANTHROPIC_API_KEY = "local-test-key";
    process.env.PRIVACY_MODE = "internal_only";
    const infoOff = await (await assistantGet()).json();
    check(infoOff.mode === "consultant" && String(infoOff.notice).includes("PRIVACY_MODE"), "with a key but PRIVACY_MODE=internal_only: still the consultant, and the notice names PRIVACY_MODE", infoOff);

    if (wasPrivacy === undefined) delete process.env.PRIVACY_MODE;
    else process.env.PRIVACY_MODE = wasPrivacy;
    if (wasKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = wasKey;
  }


  // ── خريطة المهام (V5 · P5): numbers, badges, branch numbers, and the full report of a run ──
  {
    const { jobs, counters, demo } = await loadJobs();
    const night = jobs.find((j) => j.key === "night-round");
    check(!demo && jobs.length >= 16 && night?.number === 1 && night.domain === "ads" && night.kind === "recurring", "the seeded jobs sit on the map with their numbers (night round is 1, ads)", night && { n: night.number, d: night.domain });
    check(jobs.find((j) => j.key === "team-round")?.domain === "ops" && jobs.find((j) => j.key === "basha-parcels")?.kind === "manual", "the team round is ops, the parcels job is on request");
    const nums = jobs.filter((j) => j.number !== null && j.number <= 16).map((j) => j.number);
    check(new Set(nums).size === nums.length && nums.length >= 16, "the numbers 1..16 are each used once");
    check(night!.branches.length > 0 && night!.branches[0]!.number === "1.1" && night!.branches.every((b, i) => b.number === `1.${i + 1}`), "the branches of job 1 are 1.1, 1.2 …", night!.branches.map((b) => b.number));
    check(counters.total === jobs.length && counters.running + counters.problem + counters.upcoming + counters.manual + counters.off === counters.total, "the five counters add up to the jobs", counters);
    check(jobs.find((j) => j.key === "basha-parcels")!.badge.key === "manual", "a job on request has the «عند الطلب» badge");

    // a run with a full report, and one with a phone number in it
    const ok = await tool("log_run", { job: "stock-alerts", ref: "demo-p5-report", status: "ok", summary: "خلص", report: "التقرير الكامل: 3 منتجات، واحد ناقص مخزون." });
    check(!ok.isError, "log_run takes a full report");
    const runs = await runsOf("stock-alerts", { limit: 5 });
    check(runs.some((r) => r.ref === "demo-p5-report" && r.report === "التقرير الكامل: 3 منتجات، واحد ناقص مخزون."), "…and the run keeps it");
    const bad = await tool("log_run", { job: "stock-alerts", ref: "demo-p5-bad", status: "ok", report: "كلّم الزبون 0791234567" });
    check(bad.isError === true, "a report with a phone number is refused");
    check((await tool("log_run", { job: "stock-alerts", ref: "demo-p5-long", report: "x".repeat(6001) })).isError === true, "a report over 6000 characters is refused");
    await db.workflowRun.deleteMany({ where: { ref: { in: ["demo-p5-report", "demo-p5-bad", "demo-p5-long"] } } });
  }


  // ── بانتظارك (V5 · P3): one list over the three tables, the same decision card, the same count ──
  {
    const owner = { id: "demo-mcp-user", role: "OWNER" as const, demo: false };
    const mark = "demo-inbox:";
    const cs = await db.changeSet.create({ data: { state: "pending_approval", source: "rule", sourceRef: "scale", reasonCode: "S12", sentence: mark + " زيادة ميزانية", kind: "scale", spendDeltaDaily: 8 } });
    const red = await requestApproval(ApprovalInput.parse({ title: mark + " قرار أحمر", why: "سبب", urgency: "red", amount: 25 }), { type: "agent", id: "claude" });
    const yellow = await requestApproval(ApprovalInput.parse({ title: mark + " قرار عادي", why: "سبب", urgency: "yellow" }), { type: "agent", id: "claude" });
    const ho = (await createHandoff({ workflow: "night-round", kind: "needs_input", title: mark + " واقفة", assignee: "ahmad" }, { type: "user", id: "demo-mcp-user" })).handoff;
    const mine = async () => (await loadInbox(owner)).filter((i) => i.title.startsWith(mark));

    const open = await mine();
    check(open.length === 4, "the inbox has the change, the two requests and the handoff that waits for a person", open.map((i) => i.id));
    check(open[0]!.id === "approval:" + red.approval.id, "the red request is first");
    check(open.find((i) => i.id === "change:" + cs.id)?.actions.map((a) => a.key).join() === "approve,reject,open" && open.find((i) => i.id === "handoff:" + ho.id)?.kind === "stuck", "a change has yes / no / «try first», a handoff is «stuck»");
    check((await loadInbox(owner, { domain: "work" })).some((i) => i.id === "handoff:" + ho.id) && !(await loadInbox(owner, { domain: "work" })).some((i) => i.id === "change:" + cs.id), "the domain filter keeps only that domain");
    const count = await countInbox();
    check(count === (await loadInbox(owner)).length, "the red number is the length of the list", { count });
    const api = await (await inboxGet(new Request("http://localhost:3140/api/inbox"))).json();
    check(api.count === count && Array.isArray(api.items), "GET /api/inbox answers the count and the items");

    await decideApproval(red.approval.id, { action: "approve" }, owner);
    check(!(await mine()).some((i) => i.id === "approval:" + red.approval.id), "an approved request leaves the inbox");
    check((await loadInboxDone(owner)).some((d) => d.id === "approval:" + red.approval.id && d.outcome === "وافقت"), "…and shows in «قررتها» as «وافقت»");
    const decided = await getInboxItem(owner, "approval:" + red.approval.id);
    check(decided.state === "done" && decided.outcome === "وافقت", "its page says it is decided", decided.state);

    await decideApproval(yellow.approval.id, { action: "postpone", until: "1h" }, owner);
    check(!(await mine()).some((i) => i.id === "approval:" + yellow.approval.id) && (await loadInboxLater(owner)).some((i) => i.id === "approval:" + yellow.approval.id), "a postponed request moves to «مؤجّلة»");
    check((await getInboxItem(owner, "approval:" + yellow.approval.id)).state === "later", "…and its page says so");
    check((await getInboxItem(owner, "nonsense")).state === "missing" && (await getInboxItem(owner, "change:nope")).state === "missing", "an unknown id is «missing»");

    await db.changeSet.deleteMany({ where: { id: cs.id } });
    await db.approval.deleteMany({ where: { id: { in: [red.approval.id, yellow.approval.id] } } });
    await db.handoff.deleteMany({ where: { id: ho.id } });
    await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: [red.approval.id, yellow.approval.id, ho.id] } }, { targetId: cs.id }] } });
  }


  // ── ربط مفتاح Claude من الموقع: the key is tested, stored encrypted, shown as its last four, and the Coolify variable wins ──
  {
    const owner = { id: "demo-mcp-user", role: "OWNER" as const, demo: false };
    const was = { key: process.env.ANTHROPIC_API_KEY, claude: process.env.CLAUDE_API_KEY, privacy: process.env.PRIVACY_MODE, enc: process.env.ENCRYPTION_KEY };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_API_KEY;
    process.env.PRIVACY_MODE = "off";
    process.env.ENCRYPTION_KEY = "demo-mcp-encryption-key-0123456789abcdef";
    await db.modelConnection.deleteMany({});
    forgetKeyCache();
    // built piece by piece so no key-looking literal sits in the repo
    const fake = "sk-ant-" + "api03-" + "q".repeat(36) + "WXYZ";
    const refuse = async (f: () => Promise<unknown>) => f().then(() => null, (e: { status?: number; message?: string }) => ({ status: e.status, message: String(e.message) }));

    check((await assistantConfigured()) === false && (await resolveKey()) === null, "no key anywhere: the assistant is not configured");

    const bad = await refuse(() => saveKey(owner, fake, { verify: async () => { throw new HttpError(400, "رفض"); } }));
    check(bad?.status === 400 && (await db.modelConnection.count()) === 0, "a key Anthropic refuses is not stored", bad);
    check((await refuse(() => saveKey(owner, "not-a-key")))?.status === 400 && (await refuse(() => saveKey({ ...owner, demo: true }, fake)))?.status === 403, "a wrong shape is a 400, and a demo caller cannot link (403)");
    delete process.env.ENCRYPTION_KEY;
    check((await refuse(() => saveKey(owner, fake, { verify: async () => undefined })))?.status === 409, "without ENCRYPTION_KEY it refuses to store a key (409)");
    process.env.ENCRYPTION_KEY = "demo-mcp-encryption-key-0123456789abcdef";

    const st = await saveKey(owner, "  " + fake + "\n", { verify: async () => undefined });
    check(st.source === "site" && st.hint === "…WXYZ" && st.canStore && !!st.checkedAt, "link: the status says «from the site», shows only the last four", st);
    const row = await db.modelConnection.findUnique({ where: { provider: "anthropic" } });
    check(!!row && row.status === "active" && row.keyEnc.startsWith("v2:") && !JSON.stringify(row).includes(fake) && !JSON.stringify(row).includes("q".repeat(20)), "the row holds the encrypted blob — not the key, not a piece of it");
    check((await resolveKey())?.key === fake && (await resolveKey())?.source === "site" && (await assistantConfigured()) === true, "the assistant now resolves the key from the database");
    const logs = JSON.stringify(await db.auditLog.findMany({ where: { action: { startsWith: "assistant.key_" } } }));
    check(logs.includes("assistant.key_link") && logs.includes("WXYZ") && !logs.includes("q".repeat(20)), "the audit records who linked it and the last four — never the key");

    const g = await connectionGet();
    const gt = await g.text();
    check(g.status === 200 && gt.includes("…WXYZ") && !gt.includes("q".repeat(20)), "GET /api/assistant/connection: status without the key", gt.slice(0, 160));
    const demoLink = await connectionPost(new Request("http://localhost:3140/api/assistant/connection", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "link", apiKey: fake }) }));
    check([400, 401, 403].includes(demoLink.status), "POST link without a real owner login is refused", demoLink.status);
    check((await connectionPost(new Request("http://localhost:3140/api/assistant/connection", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }))).status === 400, "an unknown action is a 400");

    const ready = await loadReadiness();
    const arow = ready.rows.find((r) => r.key === "assistant");
    check(!!arow && arow.linked && arow.missing.length === 0, "the readiness panel counts the site key as linked", arow);

    // the Coolify variable wins, and a second link is refused while it is there
    process.env.ANTHROPIC_API_KEY = "env-key-not-a-real-one";
    forgetKeyCache();
    check((await resolveKey())?.source === "env" && (await connectionStatus()).source === "env", "ANTHROPIC_API_KEY (Coolify) wins over the site key");
    check((await refuse(() => saveKey(owner, fake, { verify: async () => undefined })))?.status === 409, "linking while the Coolify variable is set is refused (409)");
    delete process.env.ANTHROPIC_API_KEY;
    forgetKeyCache();

    // PRIVACY_MODE=internal_only keeps every external model off — linking included
    process.env.PRIVACY_MODE = "internal_only";
    check((await refuse(() => saveKey(owner, fake, { verify: async () => undefined })))?.status === 403, "PRIVACY_MODE=internal_only refuses to link (403)");
    process.env.PRIVACY_MODE = "off";

    // «check» asks Anthropic again; «unlink» erases the secret and keeps the row as history
    let asked = "";
    await recheckKey(owner, { verify: async (k) => { asked = k; } });
    check(asked === fake, "check: asks Anthropic with the stored key");
    const gone = await removeKey(owner);
    const row2 = await db.modelConnection.findUnique({ where: { provider: "anthropic" } });
    check(gone.source === "none" && row2?.status === "removed" && row2.keyEnc === "" && (await resolveKey()) === null && (await assistantConfigured()) === false, "unlink: secret erased, row kept as history, assistant off again");
    check((await refuse(() => removeKey(owner)))?.status === 404, "unlinking twice is a 404");
    const again = await saveKey(owner, fake, { verify: async () => undefined });
    check(again.source === "site", "it can be linked again after an unlink");

    // the real SDK call, against a local stand-in for Anthropic
    let code = 200;
    const stand = createServer((_q, r) => {
      r.writeHead(code, { "content-type": "application/json" });
      r.end(code === 200 ? JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }) : JSON.stringify({ type: "error", error: { type: "authentication_error", message: "bad" } }));
    });
    await new Promise<void>((ok) => stand.listen(0, "127.0.0.1", ok));
    const base = `http://127.0.0.1:${(stand.address() as { port: number }).port}`;
    check((await refuse(() => verifyAnthropicKey(fake, base))) === null, "verify: a 200 from the stand-in is a good key");
    code = 401;
    check((await refuse(() => verifyAnthropicKey(fake, base)))?.status === 400, "verify: a 401 is «Anthropic refused the key» (400)");
    await new Promise<void>((ok) => stand.close(() => ok()));

    await db.modelConnection.deleteMany({});
    await db.auditLog.deleteMany({ where: { action: { startsWith: "assistant.key_" } } });
    forgetKeyCache();
    for (const [k, v] of [["ANTHROPIC_API_KEY", was.key], ["CLAUDE_API_KEY", was.claude], ["PRIVACY_MODE", was.privacy], ["ENCRYPTION_KEY", was.enc]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }


  // ── وضع التعديل (v3 K): the owner's pages, boards, fields and buttons over the real database ──
  {
    const owner = { id: "demo-mcp-user", role: "OWNER" as const, demo: false };
    const actor = { type: "user" as const, id: "demo-mcp-user" };
    const op = (o: UiOp) => applyOp(o, owner);
    const refused = (o: UiOp) => op(o).then(() => "", (e: Error) => e.message);
    const find = <T,>(list: T[], f: (x: T) => boolean) => list.find(f)!;

    // a board from a template brings its fields; a field for every board; a button that runs a workflow
    const mk = await op({ op: "board.add", label: "DEMO شحنات", template: "shipments" });
    const ship = find(mk.config.boards, (b) => b.label === "DEMO شحنات").key;
    const shipFields = mk.config.fields.filter((f) => f.boards?.includes(ship));
    check(/^bd-[0-9a-f]{6}$/.test(ship) && shipFields.map((f) => f.type).join() === "text,text,date" && mk.version >= 1, "a board from the «متابعة شحنات» template: its own key, and its three fields (text · text · date) on that board only", { ship, fields: shipFields.map((f) => f.label) });
    const mk2 = await op({ op: "board.add", label: "DEMO توصيل" });
    const deliv = find(mk2.config.boards, (b) => b.label === "DEMO توصيل").key;
    const fNo = shipFields[0]!.id;
    const fDate = shipFields[2]!.id;
    const everywhere = await op({ op: "field.add", entity: "task", label: "DEMO ملاحظة", type: "text" });
    const fNote = find(everywhere.config.fields, (f) => f.label === "DEMO ملاحظة").id;
    const btn = await op({ op: "button.add", entity: "task", label: "DEMO ابعت للتأكيد", workflow: "daily-check" });
    const btnId = btn.config.buttons[0]!.id;
    check(btn.config.buttons[0]!.confirm === true && (await refused({ op: "button.add", entity: "task", label: "DEMO س", workflow: "no-such-flow" })).includes("الورك فلو"), "a button runs a workflow that exists (and asks «متأكد؟» by default); one for a workflow that does not is refused");

    // cards on the boards, and what is typed into their fields
    const t = [await createTask({ title: "DEMO شحنة 1", board: ship }, actor, "ui"), await createTask({ title: "DEMO شحنة 2", board: ship }, actor, "ui"), await createTask({ title: "DEMO شحنة 3", board: ship }, actor, "ui"), await createTask({ title: "DEMO توصيل 1", board: deliv }, actor, "ui"), await createTask({ title: "DEMO توصيل 2", board: deliv }, actor, "ui")];
    await setValues("task", t[0]!.id, { [fNo]: "AB-123", [fDate]: "2026-11-20", [fNote]: "ممتازة" }, owner);
    await setValues("task", t[1]!.id, { [fNo]: "AB-124" }, owner);
    const badDate = await setValues("task", t[0]!.id, { [fDate]: "2026-13-40" }, owner).then(() => "", (e: Error) => e.message);
    const phone = await setValues("task", t[0]!.id, { [fNote]: "كلّمه 0944123456" }, owner).then(() => "", (e: Error) => e.message);
    const offBoard = await setValues("task", t[3]!.id, { [fNo]: "XX" }, owner).then(() => "", (e: Error) => e.message);
    check(badDate.includes("YYYY-MM-DD") && phone.includes("رقم هاتف") && offBoard.includes("مش على هاللوحة"), "a value is checked against its field: an impossible date, a customer's number, and a field that is not on that card's board are all refused", { badDate, phone, offBoard });

    // reload: it was all written to the database, not kept in a page
    const fresh = await getUiConfig();
    const vals = await getValues("task", t.map((x) => x.id));
    check(fresh.fields.some((f) => f.id === fNote) && fresh.buttons.some((b) => b.id === btnId) && vals[t[0]!.id]![fNo] === "AB-123" && vals[t[0]!.id]![fDate] === "2026-11-20" && vals[t[1]!.id]![fNo] === "AB-124", "reload: the field, the button and the values are all still there (read back from the database)");
    check(fieldsFor(fresh, "task", ship).map((f) => f.id).includes(fNote) && !fieldsFor(fresh, "task", deliv).map((f) => f.id).includes(fNo) && buttonsFor(fresh, "task", deliv).length === 1, "…a template field shows on its own board only, a field for every board on all of them, a button everywhere");

    // what is used cannot be put away — it is merged or hidden
    const a1 = await refused({ op: "board.archive", key: ship });
    const a2 = await refused({ op: "field.archive", id: fNo });
    check(a1.includes("3 مهمة") && a2.includes("2 قيمة"), "a board with 3 tasks and a field with 2 values cannot be archived — the reason says how many", { a1, a2 });

    // THE GATE: merge two boards with no data loss
    const mine = () => db.task.count({ where: { board: { in: [ship, deliv] } } });
    const before = { tasks: await mine(), values: await db.customValue.count({ where: { updatedBy: "demo-mcp-user" } }) };
    const merged = await op({ op: "board.merge", from: ship, into: deliv });
    const after = { tasks: await mine(), values: await db.customValue.count({ where: { updatedBy: "demo-mcp-user" } }) };
    check(merged.moved === 3 && (await db.task.count({ where: { board: deliv } })) === 5 && (await db.task.count({ where: { board: ship } })) === 0 && before.tasks === after.tasks && before.values === after.values && before.tasks === 5, "merging two boards moves all 3 tasks and loses nothing: 5 tasks and every value before = 5 and every value after", { before, after, merged: merged.moved });
    const post = await getUiConfig();
    const shipCfg = effectiveBoards(post).find((b) => b.key === ship)!;
    check(shipCfg.archived && shipCfg.mergedInto === deliv && shipCfg.movedCount === 3 && shipCfg.canMoveBack && fieldsFor(post, "task", deliv).map((f) => f.id).includes(fNo), "…the old board is put away with a pointer (and the 3 ids), and its fields now show on the board it went into");
    const later = await createTask({ title: "DEMO بعد الدمج", board: ship }, actor, "mcp");
    check(later.board === deliv, "a task made later for the old board's key (by Claude, say) lands on the board it was merged into");
    const hashtag = await quickAddTask("بكرا: DEMO مهمة بالهاشتاق #DEMO_توصيل", actor);
    check(hashtag.board === deliv && hashtag.title === "DEMO مهمة بالهاشتاق", "«#DEMO_توصيل» in the quick add finds the board the owner made, by its name");
    const undone = await op({ op: "board.restore", key: ship });
    const back = await getUiConfig();
    check(undone.movedBack === 3 && (await db.task.count({ where: { board: ship } })) === 3 && !effectiveBoards(back).find((b) => b.key === ship)!.archived && fieldsFor(back, "task", ship).map((f) => f.id).includes(fNo) && !fieldsFor(back, "task", deliv).map((f) => f.id).includes(fNo), "undoing the merge brings the board back, moves ITS 3 tasks back (not the ones made since) and puts its template fields back on it alone", undone.movedBack);

    // two fields merged: the values are copied, the first keeps its own, and where both had one it says so
    const fa = (await op({ op: "field.add", entity: "task", label: "DEMO رقم أ", type: "text" })).config.fields.find((f) => f.label === "DEMO رقم أ")!.id;
    const fb = (await op({ op: "field.add", entity: "task", label: "DEMO رقم ب", type: "text" })).config.fields.find((f) => f.label === "DEMO رقم ب")!.id;
    await setValues("task", t[0]!.id, { [fa]: "A0", [fb]: "B0" }, owner);
    await setValues("task", t[1]!.id, { [fa]: "A1" }, owner);
    const fm = await op({ op: "field.merge", from: fa, into: fb });
    const mv = await getValues("task", [t[0]!.id, t[1]!.id]);
    check(fm.copied === 1 && fm.conflicts === 1 && mv[t[0]!.id]![fb] === "B0" && mv[t[1]!.id]![fb] === "A1" && mv[t[0]!.id]![fa] === "A0", "merging two fields: the value only the first had is copied (A1), where both had one the second wins (B0) and the first's stays in the put-away field — nothing lost", { copied: fm.copied, conflicts: fm.conflicts });
    check((await refused({ op: "field.merge", from: fNo, into: fDate })).includes("النوعين مختلفين"), "two fields of different types are not merged");

    // a button is one hand-over per card, with the card's own words
    const run1 = await runButton(btnId, "task", t[0]!.id, owner);
    const run1b = await runButton(btnId, "task", t[0]!.id, owner);
    const run2 = await runButton(btnId, "task", t[1]!.id, owner);
    const inp = run1.handoff.context.inputs ?? {};
    check(run1.created && !run1b.created && run1b.handoff.id === run1.handoff.id && run2.created && run2.handoff.id !== run1.handoff.id, "a button asks Claude to run the workflow on THAT card: pressing again returns the open request, another card gets its own");
    check(inp.card_title === "DEMO شحنة 1" && inp.board === "DEMO شحنات" && inp.button === "DEMO ابعت للتأكيد" && inp["رقم الشحنة"] === "AB-123" && inp["موعد التسليم"] === "2026-11-20" && JSON.stringify(inp).indexOf("0944") < 0, "…carrying the card's title, board, button and its fields (no customer data exists in any of them)", inp);

    // the sidebar: rename, hide, add (never past seven), reorder — and two edits at the same moment both land
    await op({ op: "page.hide", key: "done", hidden: true });
    const added = await op({ op: "page.add", kind: "link", label: "DEMO درايف", href: "https://drive.google.com/drive/folders/abc" });
    const vis = effectivePages(added.config, BUILTIN_PAGES).filter((p) => !p.hidden && !p.archived);
    check(vis.length === 7 && vis.at(-1)!.key === "settings" && vis.at(-2)!.label === "DEMO درايف", "a page of the owner's is added before «الإعدادات» — the sidebar holds seven");
    check((await refused({ op: "page.add", kind: "link", label: "DEMO تاني", href: "/ads" })).includes("أقصى شي 7") && (await refused({ op: "page.hide", key: "settings", hidden: true })).includes("الإعدادات"), "an eighth is refused, and «الإعدادات» cannot be hidden");
    await Promise.all([op({ op: "page.rename", key: "ads", label: "DEMO حملاتي" }), op({ op: "page.rename", key: "videos", label: "DEMO فيديوهاتي" })]);
    const both = effectivePages(await getUiConfig(), BUILTIN_PAGES);
    check(both.find((p) => p.key === "ads")!.label === "DEMO حملاتي" && both.find((p) => p.key === "videos")!.label === "DEMO فيديوهاتي", "two edits at the same moment both land (the setting is changed under a lock, one after the other)");

    // history: every edit is a version of the setting, and one can be put back
    const versions = await db.settingVersion.count({ where: { key: "ui.config" } });
    const cur = (await db.setting.findUnique({ where: { key: "ui.config" } }))!.version;
    await restoreSetting("ui.config", cur - 1, "demo-mcp-user");
    check(versions >= 12 && effectivePages(await getUiConfig(), BUILTIN_PAGES).filter((p) => p.label.startsWith("DEMO ") && (p.key === "ads" || p.key === "videos")).length === 1, "every edit is a version of the setting, and putting the one before back works", { versions });

    // the duplicates it suggests merging (two boards with one name; tasks that look alike)
    const dupCfg = await getUiConfig();
    await setSetting("ui.config", { ...dupCfg, boards: [...dupCfg.boards, { key: "bd-dup001", custom: true, label: "DEMO توصيل " }, { key: "bd-dup002", custom: true, label: "DEMO التوصيل" }] }, "demo-mcp-user");
    const sug = (await panelData()).suggestions;
    check(sug.some((s) => s.kind === "board" && s.op?.op === "board.merge"), "the detector suggests merging two boards named alike", sug.map((s) => s.text));

    // fields and buttons on videos and workflows, a field changing type, and a row dropped onto another
    const board = await loadBoard();
    const vid = board.products.flatMap((p) => [...p.winners, ...p.learning, ...p.rest])[0];
    check(!!vid, "the video board has a video to hang a field on (the demo bank's)");
    if (vid) {
      const fv = (await op({ op: "field.add", entity: "video", label: "DEMO ملاحظة فيديو", type: "text" })).config.fields.find((f) => f.label === "DEMO ملاحظة فيديو")!.id;
      const fw = (await op({ op: "field.add", entity: "workflow", label: "DEMO مسؤول", type: "person" })).config.fields.find((f) => f.label === "DEMO مسؤول")!.id;
      await setValues("video", vid.key, { [fv]: "هوك أقوى بالثانية 3" }, owner);
      await setValues("workflow", "daily-check", { [fw]: "laith" }, owner);
      const got = { v: (await getValues("video", [vid.key]))[vid.key]?.[fv], w: (await getValues("workflow", ["daily-check"]))["daily-check"]?.[fw] };
      check(got.v === "هوك أقوى بالثانية 3" && got.w === "laith", "a video and a workflow keep what is typed into their fields", got);
      check((await setValues("video", "no-such-video", { [fv]: "x" }, owner).then(() => "", (e: Error) => e.message)).includes("مش موجود") && (await setValues("workflow", "no-such-flow", { [fw]: "laith" }, owner).then(() => "", (e: Error) => e.message)).includes("مش موجود"), "a card that does not exist takes no value");
      check((await setValues("video", vid.key, { [fw]: "laith" }, owner).then(() => "", (e: Error) => e.message)).includes("مش معروف"), "a field of one kind of card is not written on another");
      const bv = (await op({ op: "button.add", entity: "video", label: "DEMO اسأل عن الفيديو", workflow: "daily-check" })).config.buttons.find((b) => b.label === "DEMO اسأل عن الفيديو")!.id;
      const bw = (await op({ op: "button.add", entity: "workflow", label: "DEMO راجعه", workflow: "daily-check" })).config.buttons.find((b) => b.label === "DEMO راجعه")!.id;
      const rv = await runButton(bv, "video", vid.key, owner);
      const rw = await runButton(bw, "workflow", "daily-check", owner);
      const ivp = rv.handoff.context.inputs ?? {};
      const iwp = rw.handoff.context.inputs ?? {};
      check(rv.created && ivp.card === "video" && ivp.card_id === vid.key && ivp.card_title === vid.label && ivp["DEMO ملاحظة فيديو"] === "هوك أقوى بالثانية 3", "a button on a video hands Claude that video's own words and fields", ivp);
      check(rw.created && iwp.card === "workflow" && iwp.card_id === "daily-check" && iwp["DEMO مسؤول"] === "laith", "a button on a workflow hands Claude that workflow's words and fields", iwp);
      check((await runButton(bv, "workflow", "daily-check", owner).then(() => "", (e: Error) => e.message)).includes("الزر مش موجود"), "a video's button does not run on a workflow card");
      await db.handoff.updateMany({ where: { workflowKey: "daily-check", status: "open" }, data: { status: "cancelled" } });
    }

    // a text field whose values are all numbers becomes a number: each stored value is rewritten as one
    const fq = (await op({ op: "field.add", entity: "task", label: "DEMO كمية", type: "text" })).config.fields.find((f) => f.label === "DEMO كمية")!.id;
    await setValues("task", t[0]!.id, { [fq]: "12" }, owner);
    await setValues("task", t[1]!.id, { [fq]: " 7.5 " }, owner);
    const cv = await op({ op: "field.convert", id: fq, to: "number" });
    const qv = await getValues("task", [t[0]!.id, t[1]!.id]);
    check(cv.converted === 2 && qv[t[0]!.id]![fq] === 12 && qv[t[1]!.id]![fq] === 7.5 && (await getUiConfig()).fields.find((f) => f.id === fq)!.type === "number", "changing a field's type rewrites every stored value for the new type («12» → 12)", { converted: cv.converted, qv });
    const bad = await refused({ op: "field.convert", id: fq, to: "date" });
    const still = await getValues("task", [t[0]!.id]);
    check(bad.includes("قيمة من 2") && still[t[0]!.id]![fq] === 12 && (await getUiConfig()).fields.find((f) => f.id === fq)!.type === "number", "…and one whose values do not fit stops, saying how many; nothing changed", bad);

    // dropping a field onto another puts it in its place
    const d1 = (await op({ op: "field.add", entity: "task", label: "DEMO سحب 1", type: "text" })).config.fields.find((f) => f.label === "DEMO سحب 1")!.id;
    const d2 = (await op({ op: "field.add", entity: "task", label: "DEMO سحب 2", type: "text" })).config.fields.find((f) => f.label === "DEMO سحب 2")!.id;
    await op({ op: "field.drop", id: d2, onto: d1 });
    const ord = (await getUiConfig()).fields.filter((f) => f.entity === "task" && [d1, d2].includes(f.id)).map((f) => f.id);
    check(ord[0] === d2 && ord[1] === d1, "a field dropped onto another takes its place", ord);

    // the routes: the owner only, and on the demo nothing is written
    const uiGet = await (await uiGet_()).json();
    const uiPostDemo = await (await uiPost(new Request("http://localhost:3140/api/ui", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "page.hide", key: "ads", hidden: true }) }))).json();
    const uiBad = await uiPost(new Request("http://localhost:3140/api/ui", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "page.delete", key: "ads" }) }));
    check(uiGet.demo === true && uiPostDemo.demo === true && uiBad.status === 400, "GET/POST /api/ui: with sign-in off (the demo caller) nothing is read or written; an op that does not exist is a 400");
  }

  // ── what the model gets when it is wrong ──
  const wrong = await tool("push_metrics", { rows: [] });
  check(wrong.isError && wrong.text.includes("المدخلات"), "empty rows → «المدخلات مش صحيحة» (isError, not a crash)");
  check((await call(rpc("tools/call", { name: "delete_everything" }))).json?.error?.code === -32602, "an unknown tool is a JSON-RPC error");

  // ── the audit trail ──
  const log = await db.auditLog.count({ where: { actorId: "mcp:demo-mcp", action: "mcp.call" } });
  check(log >= 20, `every tool call is in the audit log (${log} entries)`);
  check((await db.auditLog.count({ where: { action: "mcp.push_metrics" } })) >= 3, "…and the pushes say what they changed");
  const leak = await db.auditLog.count({ where: { OR: [{ before: { string_contains: TOKEN } }, { after: { string_contains: TOKEN } }] } });
  check(leak === 0, "the token never appears in the audit log");
  check((await db.apiToken.findUnique({ where: { id: row.id } }))?.tokenHash !== TOKEN && !!(await db.apiToken.findUnique({ where: { id: row.id } }))?.lastUsedAt, "only the hash is stored, and last use is recorded");

  // ── v3 F: steps the site runs itself (n8n signed · Telegram · HTTP), and steps that ran out of time ──
  {
    const me = { type: "user" as const, id: "demo-mcp-user" };
    const cfg = siteConfigFrom({ N8N_BASE_URL: "https://n8n.example.com", N8N_WEBHOOK_SECRET: "demo-secret-value", N8N_ALLOWED_PATHS: "daily-ops", STEP_HTTP_ALLOW: "api.example.com", TELEGRAM_BOT_TOKEN: "x", TELEGRAM_OWNER_CHAT_ID: "1" });
    const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
    const told: string[] = [];
    let status = 200;
    const deps = (over: Partial<ExecDeps> = {}): ExecDeps => ({
      cfg,
      fetch: (async (u: URL | string, init?: RequestInit) => {
        sent.push({ url: String(u), headers: init?.headers as Record<string, string>, body: String(init?.body) });
        return new Response('{"ok":true}', { status });
      }) as typeof fetch,
      resolve: async () => ["93.184.216.34"],
      sleep: async () => undefined,
      now: () => new Date(),
      telegram: async (t) => {
        told.push(t);
      },
      ...over,
    });
    const g = (extra: Record<string, unknown> = {}) => ({
      nodes: [
        { id: "t", type: "trigger" as const, label: "بداية" },
        { id: "a", type: "step" as const, label: "نداء n8n", executor: "n8n" as const, permission: "green" as const, target: "daily-ops", prompt: "اقرا أرقام الطنين", timeoutS: 60, ...extra },
        { id: "b", type: "notify" as const, label: "تبليغ", executor: "telegram" as const, permission: "green" as const, prompt: "خلص الفحص" },
        { id: "c", type: "step" as const, label: "تحليل Claude", executor: "claude_mcp" as const, permission: "green" as const },
      ],
      edges: [{ from: "t", to: "a" }, { from: "a", to: "b" }, { from: "b", to: "c" }],
    });
    const wf1 = await createWorkflow({ name: "DEMO محوّلات", graph: g() }, me);
    const r1 = await executeWorkflow(wf1.key, me, deps());
    check(r1.status === "waiting" && r1.ran.map((x) => `${x.id}:${x.status}`).join() === "a:done,b:done" && r1.handedOver?.id === "c", "the site ran n8n and Telegram, and handed Claude's step over", r1);
    const s1 = sent[0];
    check(!!s1 && s1.url === "https://n8n.example.com/webhook/daily-ops" && verifySignature("demo-secret-value", s1.headers["x-mb-timestamp"]!, s1.body, s1.headers["x-mb-signature"]!, Date.now()), "n8n got the body signed (HMAC over timestamp.body) at the listed webhook");
    check(told.length === 1 && told[0]!.includes("خلص الفحص"), "Telegram got the step's words");
    const run1 = await db.workflowRun.findFirst({ where: { workflowId: (await db.workflow.findUnique({ where: { key: wf1.key } }))!.id, ref: r1.ref } });
    const st1 = (run1?.nodeStates ?? {}) as Record<string, { status: string }>;
    check(run1?.status === "waiting" && st1.a?.status === "done" && st1.b?.status === "done" && st1.c?.status === "handoff", "the run shows a·b done and c waiting on its handoff", st1);
    const h1 = await db.handoff.findFirst({ where: { workflowKey: wf1.key, status: "open" } });
    check(h1?.kind === "needs_input" && h1.nodeId === "c" && h1.runRef === r1.ref, "c is in the handoff queue on the same run");
    check((await executeWorkflow(wf1.key, me, deps()).catch((e: Error) => e)) instanceof ExecRefused, "a second go while a handoff is open is refused");
    await db.handoff.updateMany({ where: { workflowKey: wf1.key }, data: { status: "cancelled" } });

    // a step that fails: 502 twice (one retry), then it is a failed-step handoff
    sent.length = 0;
    status = 502;
    const wf2 = await createWorkflow({ name: "DEMO محوّلات فشل", graph: g({ retries: 1 }) }, me);
    const r2 = await executeWorkflow(wf2.key, me, deps());
    check(r2.status === "waiting" && r2.ran[0]?.status === "failed" && sent.length === 2, "a 502 is retried once, then the step fails", { ran: r2.ran, tries: sent.length });
    const h2 = await db.handoff.findFirst({ where: { workflowKey: wf2.key, status: "open" } });
    check(h2?.kind === "node_failed" && h2.nodeId === "a" && JSON.stringify(h2.context).includes("502"), "the failed step is in the queue with what failed");
    status = 200;

    // what is refused before anything leaves
    const wf3 = await createWorkflow({ name: "DEMO محوّلات ممنوع", graph: g({ target: "not-listed" }) }, me);
    const r3 = await executeWorkflow(wf3.key, me, deps()).catch((e: Error) => e);
    check(r3 instanceof ExecRefused, "a webhook that is not on the owner's list is not called, and nothing is run", r3 instanceof Error ? r3.message : r3);
    const wf4 = await createWorkflow({ name: "DEMO محوّلات http", graph: { nodes: [{ id: "t", type: "trigger" as const, label: "بداية" }, { id: "h", type: "step" as const, label: "نداء http", executor: "http" as const, permission: "green" as const, target: "https://api.example.com/hook" }], edges: [{ from: "t", to: "h" }] } }, me);
    sent.length = 0;
    const r4 = await executeWorkflow(wf4.key, me, deps({ resolve: async () => ["10.0.0.5"] }));
    check(r4.ran[0]?.status === "failed" && sent.length === 0, "an address that resolves to a private IP is never called", r4.ran);
    await db.handoff.updateMany({ where: { workflowKey: wf4.key }, data: { status: "cancelled" } });
    const r5 = await executeWorkflow(wf4.key, me, deps());
    check(r5.status === "ok" && sent.length === 1 && !sent[0]!.headers["x-mb-signature"], "http to a listed host with a public address goes out, and the run ends ok");
    const run5 = await db.workflowRun.findFirst({ where: { ref: r5.ref } });
    check(run5?.status === "ok" && !!run5.finishedAt, "the run is closed ok with its end time");
    check((await db.auditLog.count({ where: { action: "workflow.execute" } })) >= 3, "every execution is in the audit log");

    // a step past its own timeout goes to the queue once
    const wf6 = await createWorkflow({ name: "DEMO مهلة", graph: g() }, me);
    await logRun({ job: wf6.key, ref: "demo-mcp-timeout", status: "running", node: { id: "a", status: "running" } }, me, "ui", new Date(Date.now() - 10 * 60_000));
    const sw1 = await sweepTimeouts(new Date());
    const hto = await db.handoff.findMany({ where: { workflowKey: wf6.key, kind: "timeout" } });
    check(hto.length === 1 && hto[0]!.nodeId === "a" && sw1.created >= 1, "a step running past its timeout becomes a «timeout» handoff", hto.length);
    const sw2 = await sweepTimeouts(new Date());
    check((await db.handoff.count({ where: { workflowKey: wf6.key, kind: "timeout" } })) === 1 && sw2.created === 0, "…once, not again on the next sweep");
  }

  // ── the home summary counts an order on the Amman day it was made on, not the UTC day ──
  {
    const t0 = await loadToday();
    const todayKey = ammanKey(new Date());
    const startOfToday = dayBounds(todayKey).from.getTime();
    const mk = (id: string, at: number) => db.attributedOrder.create({ data: { omsOrderId: id, productCode: "DEMO_NUM", market: "JO", channel: "website", method: "none", status: "new", createdAtOms: new Date(at), matureAt: new Date(at + 86_400_000), orderValue: 10, currency: "JOD" } });
    await mk("mcp:tz:today", startOfToday + 90 * 60_000); // 01:30 Amman today — still «yesterday» on the UTC clock
    await mk("mcp:tz:yesterday", startOfToday - 30 * 60_000); // 23:30 Amman yesterday
    const t1 = await loadToday();
    check((t1.today.orders ?? 0) === (t0.today.orders ?? 0) + 1, "an order made at 01:30 Amman time counts for today", { before: t0.today.orders, after: t1.today.orders });
    check((t1.yesterday.orders ?? 0) === (t0.yesterday.orders ?? 0) + 1, "…and one made at 23:30 the night before counts for yesterday", { before: t0.yesterday.orders, after: t1.yesterday.orders });
  }

  // ── v3 R: a Meta write asked for live is never a quiet dry-run, and the jobs say what key is missing ──
  {
    const owner = { id: "demo-mcp-user", role: "OWNER" as const, demo: false };
    const wasEnv = { mode: process.env.META_WRITE_MODE, ok: process.env.META_LIVE_VERIFIED, token: process.env.META_SYSTEM_USER_TOKEN };
    const mkChange = async (sentence: string) =>
      propose(
        { source: "user", reasonCode: "S11", sentence, kind: "resume", accountMetaId: "act_demo_mcp", items: [{ op: "resume", objectType: "campaign", objectId: "DEMO_MCP_C1", before: { status: "PAUSED" }, after: { status: "ACTIVE" } }] },
        { type: "user", id: "demo-mcp-user" },
      );
    try {
      delete process.env.META_SYSTEM_USER_TOKEN;
      process.env.META_WRITE_MODE = "live";
      delete process.env.META_LIVE_VERIFIED;
      const c1 = await mkChange("DEMO جاهزية: بدون META_LIVE_VERIFIED");
      const r1 = await approve(c1.id, owner).catch((e: Error) => ({ state: "threw", error: e.message }));
      const i1 = await db.changeItem.findMany({ where: { changeSetId: c1.id } });
      check(r1.state === "failed" && String(r1.error).includes("META_LIVE_VERIFIED=1") && i1.every((i) => i.apiResponse === null), "META_WRITE_MODE=live without META_LIVE_VERIFIED: the change FAILS with the sentence and nothing was recorded as sent", { state: r1.state, error: r1.error });
      process.env.META_LIVE_VERIFIED = "1";
      const c2 = await mkChange("DEMO جاهزية: بدون توكن");
      const r2 = await approve(c2.id, owner).catch((e: Error) => ({ state: "threw", error: e.message }));
      check(r2.state === "failed" && String(r2.error).includes("META_SYSTEM_USER_TOKEN"), "verified but no token: it fails naming META_SYSTEM_USER_TOKEN (no made-up «executed»)", { state: r2.state, error: r2.error });
      delete process.env.META_WRITE_MODE;
      delete process.env.META_LIVE_VERIFIED;
      const c3 = await mkChange("DEMO جاهزية: dry-run");
      const r3 = await approve(c3.id, owner).catch((e: Error) => ({ state: "threw", error: e.message }));
      const i3 = await db.changeItem.findMany({ where: { changeSetId: c3.id } });
      check(r3.state === "executed" && (r3 as { writeMode?: string }).writeMode === "dry_run" && i3.every((i) => (i.apiResponse as { dryRun?: boolean } | null)?.dryRun === true), "dry-run (the default) stays honest: «executed» as dry_run, the item says it only recorded what would be sent", { state: r3.state });
      await db.changeItem.deleteMany({ where: { changeSet: { sentence: { startsWith: "DEMO جاهزية" } } } });
      await db.changeSet.deleteMany({ where: { sentence: { startsWith: "DEMO جاهزية" } } });
    } finally {
      for (const [k, v] of [["META_WRITE_MODE", wasEnv.mode], ["META_LIVE_VERIFIED", wasEnv.ok], ["META_SYSTEM_USER_TOKEN", wasEnv.token]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  // the readiness panel: names of what is missing (never a value), and only a REAL call counts as «the last call»
  {
    const secret = "dummy-test-value-not-a-key"; // scan-secrets:ignore
    const env = { TELEGRAM_BOT_TOKEN: secret, OMS_BASE_URL: "https://oms.example.test", META_WRITE_MODE: "live" } as Record<string, string>;
    await db.jobRun.deleteMany({ where: { slot: { startsWith: "demo-mcp-ready" } } });
    await db.jobRun.create({ data: { job: "replies.sync", slot: "demo-mcp-ready-1", status: "ok", finishedAt: new Date(Date.now() - 600_000), stats: { skipped: "not linked" } } });
    const r0 = await loadReadiness(env);
    const rep0 = r0.rows.find((r) => r.key === "replies")!;
    check(rep0.last.at === null && !rep0.linked && rep0.missing.join() === "REPLIES_BASE_URL,REPLIES_TOKEN", "a job that only said «skipped» is not a real call, and the missing names are listed", rep0);
    await db.jobRun.create({ data: { job: "replies.sync", slot: "demo-mcp-ready-2", status: "failed", finishedAt: new Date(Date.now() - 60_000), error: "الردود ما ردّت (503)" } });
    await db.jobRun.create({ data: { job: "replies.sync", slot: "demo-mcp-ready-0", status: "ok", finishedAt: new Date(Date.now() - 3_600_000), stats: { synced: 4 } } });
    const rep1 = (await loadReadiness(env)).rows.find((r) => r.key === "replies")!;
    check(rep1.last.ok === false && rep1.last.what === "الردود ما ردّت (503)" && !!rep1.last.at, "the last real call is the newest one that did something — here a failure, with its words", rep1.last);
    const tg = r0.rows.find((r) => r.key === "telegram")!;
    check(!tg.linked && tg.missing.join() === "TELEGRAM_OWNER_CHAT_ID" && JSON.stringify(r0).indexOf(secret) < 0 && JSON.stringify(r0).indexOf("oms.example.test") < 0, "a key that is set shows no value anywhere in the data", tg.missing);
    const mw = r0.rows.find((r) => r.key === "metaWrite")!;
    check(!mw.linked && mw.missing.includes("META_LIVE_VERIFIED=1") && r0.metaWrite.mode === "dry_run" && r0.metaWrite.line.includes("META_LIVE_VERIFIED=1"), "Meta writes: asked live, not verified → locked, and the panel says which variable opens it", { missing: mw.missing, line: r0.metaWrite.line });
    check(r0.rows.some((r) => r.key === "firebase" && r.later), "Firebase is marked «بعدين»");
    await db.jobRun.deleteMany({ where: { slot: { startsWith: "demo-mcp-ready" } } });
  }

  // ── v3 S: the site's own clock for scheduled workflows, and the assistant's kept conversation ──
  {
    const me = { type: "user" as const, id: "demo-mcp-user" };
    const cfg = siteConfigFrom({ N8N_BASE_URL: "https://n8n.example.com", N8N_WEBHOOK_SECRET: "demo-secret-value", N8N_ALLOWED_PATHS: "daily-ops" });
    const reached: string[] = [];
    const deps: ExecDeps = { cfg, fetch: (async (u: URL | string) => (reached.push(String(u)), new Response('{"ok":true}', { status: 200 }))) as typeof fetch, resolve: async () => ["93.184.216.34"], sleep: async () => undefined, now: () => new Date(), telegram: null };
    const chain = (executor: "claude_mcp" | "n8n", target?: string) => ({
      nodes: [
        { id: "t", type: "trigger" as const, label: "بداية" },
        { id: "a", type: "step" as const, label: "خطوة", executor, permission: "green" as const, ...(target ? { target, prompt: "اقرا أرقام" } : {}) },
      ],
      edges: [{ from: "t", to: "a" }],
    });
    const wfClaude = await createWorkflow({ name: "DEMO جدولة Claude", graph: chain("claude_mcp") }, me);
    const wfSite = await createWorkflow({ name: "DEMO جدولة موقع", graph: chain("n8n", "daily-ops") }, me);
    const wfOff = await createWorkflow({ name: "DEMO جدولة مطفية", graph: chain("claude_mcp") }, me);
    const mine = [wfClaude.key, wfSite.key, wfOff.key];
    await db.workflow.updateMany({ where: { key: { in: mine } }, data: { schedule: "7 3 * * *", enabled: true } });
    await db.workflow.update({ where: { key: wfOff.key }, data: { enabled: false } });
    const at = new Date(Date.UTC(2026, 10, 16, 0, 7, 30)); // 03:07 in Amman: only these three are due

    const off = await runScheduled(at, deps, {});
    check(!!off.note && !off.fired.length && !(await db.handoff.count({ where: { workflowKey: { in: mine } } })), "SITE_SCHEDULER off: the clock does nothing");
    const on = { SITE_SCHEDULER: "1" };
    const r1 = await runScheduled(at, deps, on);
    const fired = r1.fired.filter((f) => mine.includes(f.key));
    check(fired.find((f) => f.key === wfClaude.key)?.how === "claude" && fired.find((f) => f.key === wfSite.key)?.how === "site" && !fired.some((f) => f.key === wfOff.key), "on: a Claude-only workflow becomes a «run now» request, one with n8n steps runs from the site, a switched-off one is left alone", fired);
    const open = await db.handoff.findFirst({ where: { workflowKey: wfClaude.key, kind: "manual_run", status: "open" } });
    check(!!open && reached.includes("https://n8n.example.com/webhook/daily-ops"), "…the request is in the handoff queue, and the n8n webhook was called, signed");
    const r2 = await runScheduled(new Date(at.getTime() + 60_000), deps, on);
    check(!r2.fired.some((f) => mine.includes(f.key)) && reached.length === 1, "the same due minute is never fired twice (a tick a minute later finds it done)");
    const r3 = await runScheduled(new Date(at.getTime() + 30 * 60_000), deps, on);
    check(!r3.fired.some((f) => mine.includes(f.key)), "a time that was missed long ago is not replayed");
    check((await db.auditLog.count({ where: { action: "workflow.scheduled", targetId: { in: mine } } })) === 2, "each firing is in the audit log");
    await db.jobRun.deleteMany({ where: { job: { in: mine.map((k) => `workflow.fire:${k}`) } } });
    await db.auditLog.deleteMany({ where: { action: "workflow.scheduled", targetId: { in: mine } } });

    // the kept conversation: saved as shown, one per person, and nothing private is kept
    const uid = "demo-mcp-chat";
    await clearChat(uid);
    const saved = await saveChat(uid, [{ me: true, text: "كم الصرف؟" }, { me: false, text: "150$ من «الأرقام»", facts: [{ label: "الصرف", value: "150$" }] }]);
    const back = await loadChat(uid);
    check(saved && back.length === 2 && back[1]!.text.startsWith("150$") && Array.isArray((back[1] as { facts?: unknown }).facts), "the conversation comes back as the panel showed it, with its numbers", back);
    const phone = await saveChat(uid, [{ me: true, text: "كلّم الزبون على 0944123456" }]);
    check(!phone && (await loadChat(uid)).length === 2, "a message with a phone number is not kept, and what was kept stays");
    await clearChat(uid);
    check((await loadChat(uid)).length === 0, "«محادثة جديدة» clears it");
  }

  // ── v3 W: Zaki Workspace's one-way door — tasks go out once, and «done» comes back ──
  {
    const calls: { method: string; path: string; headers: Record<string, string>; body: string | null }[] = [];
    const created = new Map<string, string>(); // idempotency key → remote id
    const finished = new Set<string>();
    let shut: number | null = null;
    const fakeFetch = (async (url: string, init: { method?: string; headers: Record<string, string>; body?: string }) => {
      const path = url.replace("https://ws.example.com", "");
      const method = init.method ?? "GET";
      calls.push({ method, path, headers: init.headers, body: init.body ?? null });
      const reply = (status: number, json: unknown) => new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
      if (shut) return reply(shut, { error: { code: "door.unauthorized" } });
      if (init.headers.authorization !== "Bearer demo-door-token") return reply(401, { error: { code: "door.unauthorized" } });
      if (method === "GET" && path === "/api/v1/boards") return reply(200, { data: [{ id: "demo-board", name: "Board", project: "P" }] });
      if (method === "POST" && path === "/api/v1/tasks") {
        const key = init.headers["idempotency-key"] ?? "";
        if (!created.has(key)) created.set(key, "demo-ws-" + (created.size + 1));
        return reply(201, { data: { id: created.get(key), status: "open" } });
      }
      const m = path.match(/^\/api\/v1\/tasks\/(.+)$/);
      if (method === "GET" && m) return reply(200, { data: { id: m[1], status: finished.has(m[1]!) ? "done" : "open", finishedAt: finished.has(m[1]!) ? "2026-11-16T10:00:00.000Z" : null } });
      return reply(404, { error: { code: "door.not_found" } });
    }) as unknown as typeof fetch;
    const door = realDoorDeps({ WORKSPACE_BASE_URL: "https://ws.example.com", WORKSPACE_API_TOKEN: "demo-door-token" })!;
    door.fetch = fakeFetch;
    check(!!door && (await syncWorkspace(null)).note !== undefined, "not linked → the sync says so and does nothing");

    const a = await db.task.create({ data: { title: "DEMO ws جهّز التقرير", note: "ملاحظة", assignee: "laith", priority: "high", dueAt: new Date("2026-12-01T00:00:00Z") } });
    const b = await db.task.create({ data: { title: "DEMO ws شغل وكيل", assignee: "claude" } });
    const c = await db.task.create({ data: { title: "DEMO ws فيها رقم", note: "كلّمه على 0791234567", assignee: "hassan" } });
    const d1 = await db.task.create({ data: { title: "DEMO ws خلصت", assignee: "laith", status: "done" } });
    const s1 = await syncWorkspace(door);
    const posts = calls.filter((x) => x.method === "POST");
    const mine = (id: string) => db.task.findUnique({ where: { id } });
    const ra = await mine(a.id);
    check(s1.pushed >= 1 && !!ra?.wsId && ra.wsId.startsWith("demo-ws-"), "a person's open task goes out and keeps its Workspace id", s1);
    check(!(await mine(b.id))?.wsId && !(await mine(d1.id))?.wsId, "an agent's task and a finished one stay here");
    const rc = await mine(c.id);
    check(!rc?.wsId && !!rc?.wsError && !posts.some((p) => (p.body ?? "").includes("0791234567")), "a task with a phone number is never sent, and says why");
    const pa = posts.find((p) => (p.body ?? "").includes("DEMO ws جهّز"));
    const body = JSON.parse(pa?.body ?? "{}");
    check(JSON.stringify(Object.keys(body).sort()) === JSON.stringify(["boardId", "description", "dueDate", "externalRef", "priority", "title"]) && body.priority === "HIGH" && body.dueDate === "2026-12-01" && body.externalRef === "mb:task/" + a.id, "the body carries only the fields the contract declares", body);
    check(pa?.headers["idempotency-key"] === "mb-task-" + a.id && pa?.headers.authorization === "Bearer demo-door-token", "one idempotency key per task, and the token is sent as a bearer");
    check(ra?.updatedAt.getTime() === a.updatedAt.getTime(), "being sent is not an edit (updatedAt stays)");
    const before = posts.length;
    await syncWorkspace(door);
    check(calls.filter((x) => x.method === "POST").length === before, "the next run sends nothing again");
    check((await db.auditLog.count({ where: { action: "task.workspace.push", targetId: a.id } })) === 1, "the push is in the audit log");
    check((await db.auditLog.count({ where: { action: "task.workspace.push", after: { string_contains: "Bearer" } } })) === 0, "no token in the audit log");

    // the team finished it there → closed here, once
    finished.add(ra!.wsId!);
    const s2 = await syncWorkspace(door);
    check(s2.closed >= 1 && (await mine(a.id))?.status === "done", "done in Workspace closes the task here", s2);
    check((await db.auditLog.count({ where: { action: "task.workspace.close", targetId: a.id } })) === 1, "…and the close is in the audit log");
    const gets = calls.filter((x) => x.method === "GET" && x.path.includes(ra!.wsId!)).length;
    await syncWorkspace(door);
    check(calls.filter((x) => x.method === "GET" && x.path.includes(ra!.wsId!)).length === gets, "a closed task is not asked about again");

    // a shut door (revoked token) stops the run and does not mark the task as refused
    const e = await db.task.create({ data: { title: "DEMO ws بعد القفل", assignee: "mohammad" } });
    shut = 401;
    const s3 = await syncWorkspace(door);
    const re = await mine(e.id);
    check(!!s3.note && !re?.wsId && !re?.wsError, "a refused token stops the run and leaves the task to be sent later", s3);
    shut = null;
    await syncWorkspace(door);
    check(!!(await mine(e.id))?.wsId, "when the door opens again the task goes out");

    // the fake ids belong to the fake door: put every other task back as it was
    await db.task.updateMany({ where: { wsId: { startsWith: "demo-ws-" }, NOT: { title: { startsWith: "DEMO" } } }, data: { wsId: null, wsSyncedAt: null, wsError: null } });
    await db.task.updateMany({ where: { title: { not: { startsWith: "DEMO" } }, wsError: { not: null } }, data: { wsError: null, wsSyncedAt: null } });
    await db.auditLog.deleteMany({ where: { OR: [{ action: "task.workspace.push" }, { action: "task.workspace.close" }], actorId: "workspace.sync" } });
  }

  await clean();
  await db.$disconnect();
  console.log(process.exitCode ? "\nFAILED" : "\nall checks passed");
})().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
  await clean().catch(() => undefined);
  await db.$disconnect();
});
