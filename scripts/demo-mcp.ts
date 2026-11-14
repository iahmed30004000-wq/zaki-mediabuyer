/**
 * Claude's link to the app (v4 · A), end to end on the local database — through the real route handler, with a real
 * token: auth, the twelve tools, the numbers landing where the screens and the truth job read them, the privacy net,
 * idempotency, approvals and the owner's answer, the switch, the rules, workflows, stock, videos, tasks.
 * `npx tsx --env-file=.env scripts/demo-mcp.ts`  (the database from `docker compose up -d`, migrated)
 */
process.env.MOCK_MODE = "0";
process.env.APP_URL = "http://localhost:3140";
process.env.TELEGRAM_BOT_TOKEN = "";
process.env.TELEGRAM_OWNER_CHAT_ID = "";

import { db } from "../src/server/db";
import { hashToken, newToken } from "../src/server/api-token";
import { POST as mcp, GET as mcpGet } from "../src/app/mcp/route";
import { computeTruthDays } from "../src/jobs/truth";
import { loadDataset } from "../src/lib/source";
import { decideApproval } from "../src/server/approvals";
import { setMode, setWakeKinds } from "../src/server/mode";
import { saveRules } from "../src/server/rules";
import { DEFAULT_RULES } from "../src/core/rules-v2";
import { loadNumbers } from "../src/lib/numbers-view";

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
  await db.workflowRun.deleteMany({ where: { ref: { startsWith: "demo-mcp" } } });
  await db.workflow.deleteMany({ where: { key: "demo-mcp-flow" } });
  await db.stockSnapshot.deleteMany({ where: { productCode: "DEMO_STK" } });
  await db.videoBankItem.deleteMany({ where: { job: { startsWith: "DEMO-JOB" } } });
  await db.task.deleteMany({ where: { title: { startsWith: "DEMO" } } });
  await db.productEconomics.deleteMany({ where: { productCode: { in: ["DEMO_STK", "DEMO_NUM"] } } });
  await db.productDay.deleteMany({ where: { productCode: "DEMO_NUM" } });
  await db.apiToken.deleteMany({ where: { name: { startsWith: "demo-mcp" } } });
  await db.setting.deleteMany({ where: { key: { in: ["owner.mode", "owner.wake_kinds", "campaign.rules"] } } });
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
  check(names.length === 12 && ["push_metrics", "log_run", "request_approval", "get_approvals", "get_mode", "get_rules"].every((n) => names.includes(n)), "tools/list: twelve tools", names);
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

  await clean();
  await db.$disconnect();
  console.log(process.exitCode ? "\nFAILED" : "\nall checks passed");
})().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
  await clean().catch(() => undefined);
  await db.$disconnect();
});
