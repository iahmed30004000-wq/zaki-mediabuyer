/**
 * FAKE META + FAKE OMS (spec 17.3 contract mocks) — a `fetch` that answers like graph.facebook.com and like the OMS
 * contract of section 9.2, built from the demo data (src/lib/mock/data.ts). The whole pipeline runs against it until
 * the owner opens the real links, and the tests use it to prove a second pull changes nothing.
 * Ad CR00147 reproduces the truth example of spec 17.1 exactly.
 */
import { ACCOUNTS, CAMPAIGNS, PRODUCTS } from "@/lib/mock/data";

const DAY = 86_400_000;

/** All demo numbers land on one archive day: two days before `now` (so every order but the «open» ones is mature). */
export function fixtureDate(now = new Date()): string {
  return new Date(now.getTime() - 2 * DAY).toISOString().slice(0, 10);
}

const metaIdOf = (localId: string) => `1202110000${localId.replace(/\D/g, "").padStart(5, "0")}`;

function metaRoutes(now: Date): Record<string, unknown> {
  const date = fixtureDate(now);
  const accounts = ACCOUNTS.map((a) => ({ id: a.id, name: a.name, currency: "USD", timezone_name: "Asia/Amman", account_status: 1, spend_cap: String(a.dailyCap * 3100) }));
  const routes: Record<string, unknown> = { "me/adaccounts": { data: accounts } };
  for (const a of ACCOUNTS) {
    const cmps = CAMPAIGNS.filter((c) => c.account === a.id);
    routes[`${a.id}/campaigns`] = { data: cmps.map((c) => ({ id: metaIdOf(c.id), name: c.name, effective_status: c.status === "paused" ? "PAUSED" : "ACTIVE", objective: "OUTCOME_SALES" })) };
    routes[`${a.id}/adsets`] = { data: cmps.flatMap((c) => c.adsets.map((s) => ({ id: metaIdOf(s.id), name: s.name, campaign_id: metaIdOf(c.id), effective_status: s.status === "paused" ? "PAUSED" : "ACTIVE", optimization_goal: "OFFSITE_CONVERSIONS", daily_budget: String(s.dailyBudget * 100), learning_stage_info: { status: s.learning.events >= s.learning.of ? "SUCCESS" : "LEARNING" } }))) };
    routes[`${a.id}/ads`] = { data: cmps.flatMap((c) => c.adsets.flatMap((s) => s.ads.map((ad) => ({ id: metaIdOf(ad.id), name: ad.name, adset_id: metaIdOf(s.id), effective_status: ad.status === "paused" ? "PAUSED" : "ACTIVE" })))) };
    routes[`${a.id}/insights`] = {
      data: cmps.flatMap((c) =>
        c.adsets.flatMap((s) =>
          s.ads.map((ad) => {
            const k = ad.counts;
            return {
              ad_id: metaIdOf(ad.id), adset_id: metaIdOf(s.id), campaign_id: metaIdOf(c.id), date_start: date,
              spend: String(k.spend), impressions: String(k.impressions), reach: String(Math.round(k.impressions * 0.8)), frequency: "1.25",
              inline_link_clicks: String(k.clicks), outbound_clicks: [{ action_type: "outbound_click", value: String(Math.round(k.clicks * 0.92)) }],
              actions: [
                { action_type: "video_view", value: String(k.v3s) },
                { action_type: "landing_page_view", value: String(Math.round(k.clicks * 0.8)) },
                { action_type: "offsite_conversion.fb_pixel_purchase", value: String(k.purchases) },
                ...(k.conversations !== undefined ? [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: String(k.conversations) }] : []),
              ],
              video_thruplay_watched_actions: [{ action_type: "video_view", value: String(k.thru) }],
            };
          }),
        ),
      ),
    };
  }
  return routes;
}

function omsOrders(now: Date) {
  const day = new Date(`${fixtureDate(now)}T09:00:00Z`);
  const items: Record<string, unknown>[] = [];
  let n = 77_000;
  for (const c of CAMPAIGNS) {
    if (!c.productCode) continue;
    const product = PRODUCTS.find((p) => p.code === c.productCode)!;
    for (const s of c.adsets) {
      for (const ad of s.ads) {
        const k = ad.counts;
        const statuses: string[] = [
          ...Array(k.delivered).fill("delivered"),
          ...Array(k.returned).fill("returned"),
          ...Array(Math.max(0, k.shipments - k.delivered - k.returned)).fill("shipped"),
          ...Array(Math.max(0, k.confirmed - k.shipments)).fill("confirmed"),
          ...Array(Math.max(0, k.mature - k.confirmed)).fill("canceled"),
        ];
        const open = k.orders - k.mature;
        statuses.forEach((status, i) => {
          items.push(order(++n, c, ad, product, status, new Date(day.getTime() + i * 60_000)));
        });
        // «open»: same day, but the clock says they are younger than the confirm window
        for (let i = 0; i < open; i++) items.push(order(++n, c, ad, product, "new", new Date(day.getTime() + 23.5 * 3_600_000)));
      }
    }
  }
  return items;

  function order(id: number, c: (typeof CAMPAIGNS)[number], ad: (typeof CAMPAIGNS)[number]["adsets"][number]["ads"][number], p: (typeof PRODUCTS)[number], status: string, created: Date) {
    const at = (h: number) => new Date(created.getTime() + h * 3_600_000).toISOString();
    const reached = (s: string) => ["confirmed", "shipped", "delivered", "returned"].indexOf(status) >= ["confirmed", "shipped", "delivered", "returned"].indexOf(s) && status !== "new" && status !== "canceled";
    return {
      order_id: String(id), product_code: p.code, country: p.market, channel: ad.counts.conversations !== undefined ? "whatsapp" : "website",
      ad_id: metaIdOf(ad.id), adset_id: null, campaign_id: metaIdOf(c.id), ad_name: ad.name, landing_page: "https://crm.zakiai.io/lp/demo",
      status, created_at: created.toISOString(),
      confirmed_at: reached("confirmed") ? at(3) : null, shipped_at: reached("shipped") ? at(20) : null,
      delivered_at: status === "delivered" ? at(40) : null, returned_at: status === "returned" ? at(60) : null, canceled_at: status === "canceled" ? at(5) : null,
      order_value: p.price.toFixed(2), collected: status === "delivered" ? p.price.toFixed(2) : null, currency: "USD", is_fake: false, capi_ref: `enc:demo${id}`,
    };
  }
}

const omsProducts = () =>
  PRODUCTS.map((p) => ({ code: p.code, name: p.name, aliases: [], unit_cost_usd: p.unitCost.toFixed(2), price_options: [{ price: p.price.toFixed(2) }], stock_days: p.stockDays, delivery_fee: p.delivery.toFixed(2), return_fee: p.returnFee.toFixed(2), cod_fee_pct: p.codFee.toFixed(4) }));

export const FAKE_OMS_URL = "http://oms.fake";

/** A fetch that answers Meta and the OMS from the demo data. «now» is fixed per instance so a second pull is identical. */
export function fakeFetch(now = new Date()): typeof fetch {
  const meta = metaRoutes(now);
  const orders = omsOrders(now);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "graph.facebook.com") {
      const path = url.pathname.replace(/^\/v\d+\.\d+\//, "");
      if (init?.method === "POST" && path.endsWith("/events")) {
        const data = JSON.parse(String(new URLSearchParams(String(init.body ?? "")).get("data") ?? "[]")) as unknown[];
        return new Response(JSON.stringify({ events_received: data.length, messages: [], fbtrace_id: "demo" }));
      }
      const body = meta[path];
      return new Response(JSON.stringify(body ?? { error: { code: 100, message: `unknown path ${path}` } }), { status: body ? 200 : 400, headers: { "x-app-usage": JSON.stringify({ call_count: 3, total_cputime: 2, total_time: 2 }) } });
    }
    if (url.origin === FAKE_OMS_URL) {
      if (url.pathname === "/api/v1/orders/attribution") return new Response(JSON.stringify({ items: orders, next_cursor: null }));
      if (url.pathname === "/api/v1/products") return new Response(JSON.stringify({ items: omsProducts() }));
      if (url.pathname === "/api/v1/capi/identifiers") {
        // made-up identifiers for the demo refs (no real person): a test phone and click ids
        const refs = (JSON.parse(String(init?.body ?? "{}")) as { refs?: string[] }).refs ?? [];
        return new Response(JSON.stringify({ items: refs.map((ref, n) => ({ ref, phone_e164: `+96399900${String(n).padStart(4, "0")}`, fbc: `fb.1.1790000000.demo${n}`, fbp: `fb.1.1790000000.${n}`, external_ref: ref })) }));
      }
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

export { metaIdOf };
