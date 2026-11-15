/**
 * THE EIGHT n8n STARTER WORKFLOWS (v3 · J), built from the seeded jobs so a file can never drift from what the site knows.
 *
 * n8n is the CLOCK that never sleeps: each starter wakes the handoff queue on its job's own schedule (Asia/Amman) by creating the
 * same «شغّل هلق» request the owner can press (`POST /api/v1/handoffs`, kind manual_run — one open request per workflow, so a
 * double trigger is harmless). Claude takes it from the queue whenever it is up. A starter spends nothing and touches nothing
 * else. A second trigger, a webhook named like the job's key, lets the site's own «من الموقع» button (D35) start the same thing; it
 * verifies the HMAC the site signs with, and refuses what is not signed. No secret and no token is written into a file: the shared
 * secret is a placeholder to paste, and the queue token is an n8n credential the owner links after importing.
 */
import { createHash } from "node:crypto";
import { SEED_WORKFLOWS } from "./workflow";

/** The jobs that get a starter — the spec's eight: daily check, night round, tests, videos, team round, leak plan, stuck parcels, stock alerts. */
export const STARTER_KEYS = ["daily-check", "night-round", "product-tests", "video-collection", "team-round", "leak-plan", "shipments-check", "stock-alerts"] as const;
export type StarterKey = (typeof STARTER_KEYS)[number];

/** The name the queue token must have in the site, so «who woke Claude» reads «n8n» (the handoff's creator is `agent:api:n8n`). */
export const N8N_TOKEN_NAME = "n8n";
export const N8N_CREATOR = `agent:api:${N8N_TOKEN_NAME}`;
export const SECRET_PLACEHOLDER = "PASTE_N8N_WEBHOOK_SECRET_HERE";
export const CREDENTIAL_NAME = "Media Buyer — handoff token";
export const DEFAULT_SITE = "https://mediabuyer.zakiai.io";

const uuid = (seed: string): string => {
  const h = createHash("sha1").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export interface Starter {
  key: StarterKey;
  name: string;
  description: string;
  /** five-field cron on the Amman clock */
  cron: string;
}

export function starters(): Starter[] {
  return STARTER_KEYS.map((key) => {
    const w = SEED_WORKFLOWS.find((s) => s.key === key);
    if (!w) throw new Error(`the seeded job «${key}» is missing — a starter needs it`);
    if (!w.schedule) throw new Error(`the seeded job «${key}» has no schedule — a starter is its clock`);
    return { key, name: w.name, description: w.description, cron: w.schedule };
  });
}

const VERIFY_CODE = `// Checks that the site signed this call: HMAC-SHA256 over "<timestamp>.<body>", not older than 5 minutes.
// Needs n8n to allow the built-in module: NODE_FUNCTION_ALLOW_BUILTIN=crypto
const crypto = require('crypto');
const SECRET = '${SECRET_PLACEHOLDER}';
const item = $input.first().json;
const headers = item.headers || {};
const ts = String(headers['x-mb-timestamp'] || '');
const sig = Buffer.from(String(headers['x-mb-signature'] || ''));
const want = Buffer.from('sha256=' + crypto.createHmac('sha256', SECRET).update(ts + '.' + JSON.stringify(item.body)).digest('hex'));
const fresh = Math.abs(Date.now() / 1000 - Number(ts)) <= 300;
if (SECRET.startsWith('PASTE_') || !fresh || sig.length !== want.length || !crypto.timingSafeEqual(sig, want)) {
  throw new Error('Not signed by the site (or the secret is not pasted yet) - refused');
}
return $input.all();`;

/** One starter as an n8n workflow (importable JSON). Pure and deterministic: the same input is the same bytes. */
export function buildStarter(s: Starter, site = DEFAULT_SITE): Record<string, unknown> {
  const id = (n: string) => uuid(`${s.key}:${n}`);
  const body = JSON.stringify({ workflow: s.key, kind: "manual_run", title: `شغّل «${s.name}» (من n8n)`, need: s.description.slice(0, 480), assignee: "claude" }, null, 2);
  const nodes = [
    {
      parameters: { content: `## ${s.name}\nالساعة حسب الجدول (${s.cron} بتوقيت عمّان) هالفلو بيطلب من Claude يشغّل «${s.name}» عن طريق طابور التسليم. ما بيصرف ولا بيلمس ميتا.\n\n**قبل التفعيل:**\n1. اربط credential «${CREDENTIAL_NAME}» (Header Auth: Authorization = Bearer mbh_… من «الإعدادات ← الربط ← Claude»، اسم التوكن \`${N8N_TOKEN_NAME}\`).\n2. للمسار الموقّع: الصق السر بعقدة «تحقّق من توقيع الموقع» وضيف \`${s.key}\` لـ N8N_ALLOWED_PATHS بالموقع.\n3. فعّل الفلو.`, height: 300, width: 460 },
      id: id("note"),
      name: "اقرأني",
      type: "n8n-nodes-base.stickyNote",
      typeVersion: 1,
      position: [-460, -80],
    },
    {
      parameters: { rule: { interval: [{ field: "cronExpression", expression: s.cron }] } },
      id: id("schedule"),
      name: "الجدول",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [0, 0],
    },
    {
      parameters: { httpMethod: "POST", path: s.key, responseMode: "lastNode", options: {} },
      id: id("webhook"),
      name: "الموقع بيطلب",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 220],
      webhookId: id("webhook-id"),
    },
    { parameters: { jsCode: VERIFY_CODE }, id: id("verify"), name: "تحقّق من توقيع الموقع", type: "n8n-nodes-base.code", typeVersion: 2, position: [260, 220] },
    {
      parameters: {
        method: "POST",
        url: `${site}/api/v1/handoffs`,
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        sendBody: true,
        specifyBody: "json",
        jsonBody: body,
        options: { timeout: 20000 },
      },
      id: id("ask"),
      name: "اطلب من Claude",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [540, 110],
      credentials: { httpHeaderAuth: { id: "REPLACE_AFTER_IMPORT", name: CREDENTIAL_NAME } },
    },
  ];
  return {
    name: `Media Buyer — ${s.name}`,
    nodes,
    connections: {
      الجدول: { main: [[{ node: "اطلب من Claude", type: "main", index: 0 }]] },
      "الموقع بيطلب": { main: [[{ node: "تحقّق من توقيع الموقع", type: "main", index: 0 }]] },
      "تحقّق من توقيع الموقع": { main: [[{ node: "اطلب من Claude", type: "main", index: 0 }]] },
    },
    active: false,
    settings: { executionOrder: "v1", timezone: "Asia/Amman" },
    pinData: {},
  };
}

/** The file each starter is saved as. */
export const starterFile = (key: string): string => `${key}.json`;

/** The whole file's text (two-space JSON and a final newline), so a rebuilt file equals the committed one byte for byte. */
export const starterText = (s: Starter, site = DEFAULT_SITE): string => JSON.stringify(buildStarter(s, site), null, 2) + "\n";
