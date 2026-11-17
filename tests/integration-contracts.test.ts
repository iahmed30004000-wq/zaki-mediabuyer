import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RepliesCapacity } from "@/adapters/replies";
import { toDoorTask } from "@/core/workspace-door";

/**
 * docs/INTEGRATION_CONTRACTS.md and contracts/<system>-mediabuyer.v1.json: every endpoint says what exists and what is ADDed, every schema has an example that
 * passes it, no customer field hides in any of them, the media buyer's own adapters accept the examples written for them, and the worked cost-per-ad example adds up.
 */
const NAMES = ["oms", "pages", "replies", "workspace", "hermes"] as const;
const load = (n: string) => JSON.parse(readFileSync(join(process.cwd(), "contracts", `${n}-mediabuyer.v1.json`), "utf8")) as Contract;

interface Endpoint {
  id: string;
  status: string;
  method: string;
  path: string;
  change?: string;
  size?: string;
  blocking?: boolean;
  request_schema?: Schema;
  example_request?: unknown;
  response_schema?: Schema;
  example_response?: unknown;
  schema_ref?: string;
  example_ref?: string;
  errors?: { status: number; code: string; when: string }[];
}
interface Contract {
  contract: string;
  version: string;
  status: string;
  direction: string;
  auth: unknown;
  rate_limit: string;
  idempotency: string;
  error_envelope: unknown;
  endpoints: Endpoint[];
  env: Record<string, unknown>;
  join?: { worked_example: { meta_spend_usd: string; orders: { status: string }[]; expected: Record<string, number | string> } };
}
type Schema = { anyOf?: Schema[]; type?: string | string[]; enum?: unknown[]; pattern?: string; minimum?: number; maxLength?: number; minLength?: number; maxItems?: number; maxProperties?: number; required?: string[]; properties?: Record<string, Schema>; additionalProperties?: boolean | Schema; items?: Schema };

/** A small draft-07 check for the subset these contracts use (no ajv here). Returns the problems, empty = valid. */
function check(s: Schema, v: unknown, at = "$"): string[] {
  if (s.anyOf) return s.anyOf.some((x) => check(x, v, at).length === 0) ? [] : [`${at}: matches none of anyOf`];
  const out: string[] = [];
  const types = s.type === undefined ? null : Array.isArray(s.type) ? s.type : [s.type];
  const is = (t: string) => (t === "null" ? v === null : t === "array" ? Array.isArray(v) : t === "object" ? typeof v === "object" && v !== null && !Array.isArray(v) : t === "integer" ? Number.isInteger(v) : t === "number" ? typeof v === "number" : typeof v === t);
  if (types && !types.some(is)) return [`${at}: expected ${types.join("|")}`];
  if (s.enum && !s.enum.includes(v)) out.push(`${at}: not in enum`);
  if (typeof v === "string") {
    if (s.pattern && !new RegExp(s.pattern).test(v)) out.push(`${at}: pattern`);
    if (s.maxLength !== undefined && v.length > s.maxLength) out.push(`${at}: too long`);
    if (s.minLength !== undefined && v.length < s.minLength) out.push(`${at}: too short`);
  }
  if (typeof v === "number" && s.minimum !== undefined && v < s.minimum) out.push(`${at}: below minimum`);
  if (Array.isArray(v)) {
    if (s.maxItems !== undefined && v.length > s.maxItems) out.push(`${at}: too many items`);
    if (s.items) v.forEach((x, i) => out.push(...check(s.items!, x, `${at}[${i}]`)));
  }
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const r of s.required ?? []) if (!(r in o)) out.push(`${at}: missing ${r}`);
    if (s.maxProperties !== undefined && Object.keys(o).length > s.maxProperties) out.push(`${at}: too many properties`);
    for (const [k, x] of Object.entries(o)) {
      const sub = s.properties?.[k];
      if (sub) out.push(...check(sub, x, `${at}.${k}`));
      else if (s.additionalProperties === false) out.push(`${at}: unknown field ${k}`);
      else if (typeof s.additionalProperties === "object") out.push(...check(s.additionalProperties, x, `${at}.${k}`));
    }
  }
  return out;
}

const keysOf = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(keysOf) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : []);
/** A name that could hold a customer. («name» of a board, «ad_name», «vName» are not.) */
const CUSTOMER = /(^|_)(customer|phone|mobile|msisdn|address|email|first_?name|last_?name|full_?name|client_?name|buyer)(_|$)/i;

describe("the five contracts", () => {
  for (const n of NAMES) {
    describe(n, () => {
      const c = load(n);

      it("is v1, says its direction, its auth, its limits and its errors", () => {
        expect(c.version).toBe("v1");
        expect(c.contract).toBe(`${n}-mediabuyer`);
        for (const k of ["status", "direction", "rate_limit", "idempotency"] as const) expect(String(c[k]).length, k).toBeGreaterThan(5);
        expect(c.auth).toBeTruthy();
        expect(c.error_envelope).toBeTruthy();
        expect(c.endpoints.length).toBeGreaterThan(0);
      });

      it("every endpoint says if it EXISTS or must be ADDed, and every ADD is small, additive and says if it blocks", () => {
        for (const e of c.endpoints) {
          expect(e.id && e.method && e.path, e.id).toBeTruthy();
          expect(/^(EXISTS|ADD|PROPOSED)/.test(e.status), `${e.id}: ${e.status}`).toBe(true);
          if (e.status.startsWith("ADD")) {
            expect(String(e.change).length, `${e.id} change`).toBeGreaterThan(20);
            expect(String(e.size).startsWith("small") || String(e.size).startsWith("medium but additive"), `${e.id} size`).toBe(true);
            expect(typeof e.blocking, `${e.id} blocking`).toBe("boolean");
          }
        }
      });

      it("every schema has an example that passes it", () => {
        let n2 = 0;
        for (const e of c.endpoints) {
          if (e.request_schema) {
            expect(e.example_request, `${e.id} example_request`).toBeDefined();
            expect(check(e.request_schema, e.example_request), `${e.id} request`).toEqual([]);
            n2++;
          }
          if (e.response_schema) {
            expect(e.example_response, `${e.id} example_response`).toBeDefined();
            expect(check(e.response_schema, e.example_response), `${e.id} response`).toEqual([]);
            n2++;
          }
          if (e.schema_ref) expect(e.example_ref ?? e.schema_ref, `${e.id} ref`).toBeTruthy();
        }
        expect(n2 + c.endpoints.filter((e) => e.schema_ref).length).toBeGreaterThan(0);
      });

      it("no field in any schema or example could hold a customer", () => {
        const bad = keysOf(c.endpoints.map((e) => [e.request_schema, e.response_schema, e.example_request, e.example_response])).filter((k) => CUSTOMER.test(k));
        expect(bad).toEqual([]);
      });

      it("names its Coolify variables, and puts no secret value in an example", () => {
        const text = JSON.stringify(c.env);
        expect(Object.keys(c.env).length).toBeGreaterThan(0);
        expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}|sk-ant-|EAA[A-Za-z0-9]{20,}|\d{8,10}:[A-Za-z0-9_-]{30,}/);
      });
    });
  }
});

describe("the contracts agree with the media buyer's own code", () => {
  it("the replies capacity example is accepted by the strict adapter (and an extra field is refused)", () => {
    const ex = load("replies").endpoints.find((e) => e.id === "capacity")!.example_response;
    expect(RepliesCapacity.safeParse(ex).success).toBe(true);
    expect(RepliesCapacity.safeParse({ ...(ex as object), customer: "x" }).success).toBe(false);
  });

  it("the workspace task example has exactly the fields the door builder produces", () => {
    const ex = load("workspace").endpoints.find((e) => e.id === "task.create")!.example_request as Record<string, unknown>;
    const built = toDoorTask({ id: "ck1", title: "t", note: "n", status: "new", assignee: "abdullah", executor: null, dueAt: new Date("2026-11-19T00:00:00Z"), priority: "high", archivedAt: null, wsId: null, wsError: null, wsSyncedAt: null, updatedAt: new Date() }, "b");
    expect(Object.keys(ex).sort()).toEqual(Object.keys(built).sort());
  });

  it("the ad link the pages contract names is the one the launch builder writes", async () => {
    const { URL_TAGS } = await import("@/core/templates");
    expect(load("pages").join).toMatchObject({ media_buyer_url_tags: URL_TAGS });
  });

  it("the OMS contract points at the frozen files, which exist", () => {
    for (const e of load("oms").endpoints) for (const ref of [e.schema_ref, e.example_ref]) if (ref) expect(() => readFileSync(join(process.cwd(), ref.split(" ")[0]!), "utf8"), ref).not.toThrow();
  });
});

describe("the cost-per-ad join, on paper", () => {
  it("one ad, six orders, 42$ of spend → 7.00 per order in, 10.50 per confirmed, 42.00 per delivered", () => {
    const w = load("pages").join!.worked_example;
    const spend = Number(w.meta_spend_usd);
    const confirmed = w.orders.filter((o) => ["confirmed", "shipped", "delivered", "returned"].includes(o.status)).length;
    const delivered = w.orders.filter((o) => o.status === "delivered").length;
    expect({ orders_in: w.orders.length, confirmed, delivered, cost_per_order_in: (spend / w.orders.length).toFixed(2), cost_per_confirmed: (spend / confirmed).toFixed(2), cost_per_delivered: (spend / delivered).toFixed(2) }).toEqual(w.expected);
  });
});

describe("the rules of 17/11: one Telegram gateway, no pasted tokens between our systems", () => {
  const all = NAMES.map((n) => [n, load(n)] as const);
  it("the OMS is the only Telegram gateway: the media buyer holds no bot token and no token variable of an internal system", () => {
    for (const [n, c] of all) {
      const text = JSON.stringify(c.env);
      expect(text, n).not.toMatch(/TELEGRAM_BOT_TOKEN\"|HERMES_TOKEN|OMS_TOKEN|REPLIES_TOKEN|WORKSPACE_API_TOKEN|OMS_LANDING_TOKEN/);
      expect(Object.keys((c.env as Record<string, Record<string, unknown>>).media_buyer ?? {}).filter((k) => /TOKEN|SECRET|KEY/.test(k)), n).toEqual([]);
    }
  });
  it("the OMS contract has notify (owner, a person, or a chat with a topic) and the signed stop event back", () => {
    const oms = load("oms");
    const notify = oms.endpoints.find((e) => e.id === "oms.notify")!;
    expect(notify.path).toBe("/api/v1/notify");
    const ok = (t: unknown) => check(notify.request_schema!, { target: t, text: "x", key: "abcdefgh" });
    expect(ok("owner")).toEqual([]);
    expect(ok({ person: "abdullah" })).toEqual([]);
    expect(ok({ chat_id: "-1001234567890", topic_id: 5 })).toEqual([]);
    expect(ok("everyone")).not.toEqual([]);
    expect(ok({ phone: "0791234567" })).not.toEqual([]);
    const stop = oms.endpoints.find((e) => e.id === "oms.stop-event")!;
    expect(stop.status).toBe("ADD");
    expect(JSON.stringify(stop)).toContain("X-Zaki-Signature");
  });
  it("every link says how the token is obtained: OAuth 2.1 with PKCE S256 and the data owner as the authorization server — never a pasted key", () => {
    for (const [n, c] of all) {
      const auth = JSON.stringify(c.auth);
      expect(auth, n).toContain("S256");
      expect(auth, n).toContain("authorization_server");
      expect(auth, n).toMatch(/اربط ← اسمح/);
    }
  });
});
