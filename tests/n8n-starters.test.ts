import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { refuseIfPrivate } from "@/core/push-rows";
import { signBody } from "@/core/step-exec";
import { CREDENTIAL_NAME, N8N_CREATOR, N8N_TOKEN_NAME, SECRET_PLACEHOLDER, STARTER_KEYS, buildStarter, starterFile, starterText, starters } from "@/core/n8n-starters";
import { SEED_WORKFLOWS } from "@/core/workflow";

const dir = join(process.cwd(), "n8n", "media-buyer");
const onDisk = (key: string) => readFileSync(join(dir, starterFile(key)), "utf8").replace(/\r\n/g, "\n");

type N = { id: string; name: string; type: string; parameters: Record<string, any>; credentials?: Record<string, { id: string; name: string }> };
const parsed = (key: string) => JSON.parse(onDisk(key)) as { name: string; nodes: N[]; connections: Record<string, { main: { node: string }[][] }>; active: boolean; settings: Record<string, string> };

describe("the eight starters", () => {
  it("are the spec's eight, each a seeded job with a schedule", () => {
    expect(STARTER_KEYS).toHaveLength(8);
    expect(new Set(STARTER_KEYS).size).toBe(8);
    for (const s of starters()) expect(SEED_WORKFLOWS.some((w) => w.key === s.key && w.schedule === s.cron), s.key).toBe(true);
    expect(readdirSync(dir).sort()).toEqual(STARTER_KEYS.map(starterFile).sort());
  });

  it("the files in the repo are exactly what the builder writes (run `npm run n8n:build` after changing a job)", () => {
    for (const s of starters()) expect(onDisk(s.key), s.key).toBe(starterText(s));
  });

  it("building twice gives the same bytes", () => {
    for (const s of starters()) expect(JSON.stringify(buildStarter(s))).toBe(JSON.stringify(buildStarter(s)));
  });
});

describe.each(STARTER_KEYS)("starter %s", (key) => {
  const wf = parsed(key);
  const seed = SEED_WORKFLOWS.find((w) => w.key === key)!;
  const node = (type: string) => wf.nodes.find((n) => n.type === type)!;

  it("is a well-formed n8n workflow, switched off until the owner links it", () => {
    expect(wf.active).toBe(false);
    expect(wf.settings.timezone).toBe("Asia/Amman");
    const names = wf.nodes.map((n) => n.name);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(wf.nodes.map((n) => n.id)).size).toBe(wf.nodes.length);
    for (const [from, c] of Object.entries(wf.connections)) {
      expect(names, from).toContain(from);
      for (const to of c.main.flat()) expect(names, to.node).toContain(to.node);
    }
  });

  it("wakes the queue on the job's own schedule, and through the signed webhook, into one request", () => {
    expect(node("n8n-nodes-base.scheduleTrigger").parameters.rule.interval[0]).toEqual({ field: "cronExpression", expression: seed.schedule });
    expect(node("n8n-nodes-base.webhook").parameters).toMatchObject({ httpMethod: "POST", path: key, responseMode: "lastNode" });
    expect(key).toMatch(/^[a-z0-9-]{1,80}$/);
    const ask = node("n8n-nodes-base.httpRequest");
    expect(ask.parameters.url).toBe("https://mediabuyer.zakiai.io/api/v1/handoffs");
    const body = JSON.parse(ask.parameters.jsonBody) as Record<string, string>;
    expect(body).toMatchObject({ workflow: key, kind: "manual_run", assignee: "claude" });
    expect(body.title!.length).toBeLessThanOrEqual(160);
    expect(body.need!.length).toBeLessThanOrEqual(500);
    // both ways in end at the same request; the webhook goes through the check first
    const into = (to: string) => Object.entries(wf.connections).filter(([, c]) => c.main.flat().some((x) => x.node === to)).map(([from]) => from);
    expect(into(ask.name).sort()).toEqual([node("n8n-nodes-base.scheduleTrigger").name, node("n8n-nodes-base.code").name].sort());
    expect(into(node("n8n-nodes-base.code").name)).toEqual([node("n8n-nodes-base.webhook").name]);
  });

  it("carries no secret and no token: the queue token is a credential to link, the signing secret a placeholder to paste", () => {
    const text = onDisk(key);
    expect(text).not.toMatch(/mb[hms]_[A-Za-z0-9]{8,}/);
    expect(text).not.toMatch(/Bearer\s+[A-Za-z0-9_-]{8,}/);
    expect(text).toContain(SECRET_PLACEHOLDER);
    expect(node("n8n-nodes-base.httpRequest").credentials).toEqual({ httpHeaderAuth: { id: "REPLACE_AFTER_IMPORT", name: CREDENTIAL_NAME } });
    expect(refuseIfPrivate(text.replace(/mb[hms]_\w+/g, ""))).toBeNull();
  });

  it("never names the owner's main n8n workflow", () => {
    expect(onDisk(key)).not.toMatch(/ops[\s_-]*hub/i);
  });
});

describe("the signature check inside the webhook path", () => {
  const code = parsed("daily-check").nodes.find((n) => n.type === "n8n-nodes-base.code")!.parameters.jsCode as string;
  const SECRET = "a-real-shared-secret-123";
  // run it the way n8n does: `require` and `$input` are in scope
  const run = (secret: string, headers: Record<string, string>, body: unknown) => {
    const fn = new Function("require", "$input", code.replace(SECRET_PLACEHOLDER, secret));
    return fn(require, { first: () => ({ json: { headers, body } }), all: () => [{ json: { headers, body } }] });
  };
  const body = { workflow: "daily-check", run_ref: "site-1", node: { id: "a", label: "نداء" }, text: "اقرا", inputs: "", sent_at: "x" };
  const sign = (ts: string, b: unknown, secret = SECRET) => ({ "x-mb-timestamp": ts, "x-mb-signature": signBody(secret, ts, JSON.stringify(b)) });
  const now = () => String(Math.floor(Date.now() / 1000));

  it("lets what the site signs through — the same signature the site's step runner writes", () => {
    const ts = now();
    expect(run(SECRET, sign(ts, body), body)).toHaveLength(1);
  });
  it("refuses an unsigned call, a changed body, a wrong secret and an old one", () => {
    const ts = now();
    expect(() => run(SECRET, {}, body)).toThrow();
    expect(() => run(SECRET, sign(ts, body), { ...body, text: "غير" })).toThrow();
    expect(() => run(SECRET, sign(ts, body, "another-secret-value"), body)).toThrow();
    expect(() => run(SECRET, sign(String(Number(ts) - 3600), body), body)).toThrow();
  });
  it("refuses everything until the secret is pasted", () => {
    const ts = now();
    expect(() => run(SECRET_PLACEHOLDER, sign(ts, body, SECRET_PLACEHOLDER), body)).toThrow();
  });
});

describe("the token's name", () => {
  it("is what the site reads as «n8n» in the handoff's creator", () => {
    expect(N8N_TOKEN_NAME).toBe("n8n");
    expect(N8N_CREATOR).toBe("agent:api:n8n");
  });
});
