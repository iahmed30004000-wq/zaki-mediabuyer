import { describe, expect, it, vi } from "vitest";
import { MetaApiError, MetaClient, UsageTooHigh, usagePercent } from "@/meta/client";
import { readInsights, toInsightRow, windowSuspicious } from "@/meta/read";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Promise.resolve(new Response(JSON.stringify(body), { status, headers }));
const noSleep = async () => {};

describe("the safe Meta client (spec 9.1)", () => {
  it("sends the token as a header, never in the URL", async () => {
    const f = vi.fn().mockImplementation(() => json({ id: "1" }));
    await new MetaClient({ token: "EAAsecret", fetch: f as unknown as typeof fetch, sleep: noSleep }).get("me");
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).not.toContain("EAAsecret");
    expect(init.headers.authorization).toBe("Bearer EAAsecret");
  });

  it("retries a rate limit, never a permission error", async () => {
    const rate = vi.fn().mockImplementationOnce(() => json({ error: { code: 17, message: "limit" } }, 400)).mockImplementationOnce(() => json({ ok: 1 }));
    await expect(new MetaClient({ token: "t", fetch: rate as unknown as typeof fetch, sleep: noSleep }).get("x")).resolves.toEqual({ ok: 1 });
    const perm = vi.fn().mockImplementation(() => json({ error: { code: 200, message: "Permissions error" } }, 403));
    await expect(new MetaClient({ token: "t", fetch: perm as unknown as typeof fetch, sleep: noSleep }).get("x")).rejects.toBeInstanceOf(MetaApiError);
    expect(perm).toHaveBeenCalledTimes(1);
  });

  it("reads the usage headers and stops at 90%", async () => {
    expect(usagePercent(new Headers({ "x-business-use-case-usage": JSON.stringify({ "123": [{ type: "ads_insights", call_count: 42, total_cputime: 91, total_time: 10 }] }) }))).toBe(91);
    const f = vi.fn().mockImplementation(() => json({ data: [] }, 200, { "x-app-usage": JSON.stringify({ call_count: 95, total_cputime: 1, total_time: 1 }) }));
    const c = new MetaClient({ token: "t", fetch: f as unknown as typeof fetch, sleep: noSleep });
    await c.get("a");
    await expect(c.get("b")).rejects.toBeInstanceOf(UsageTooHigh);
  });

  it("follows pages and keeps the attribution window explicit", async () => {
    const f = vi
      .fn()
      .mockImplementationOnce(() => json({ data: [{ ad_id: "1", date_start: "2026-10-25" }], paging: { next: "https://graph.facebook.com/v24.0/act_1/insights?after=X&access_token=leak" } }))
      .mockImplementationOnce(() => json({ data: [{ ad_id: "2", date_start: "2026-10-25" }] }));
    const rows = await readInsights(new MetaClient({ token: "t", fetch: f as unknown as typeof fetch, sleep: noSleep }), "act_1", "2026-10-25", "2026-10-25");
    expect(rows.map((r) => r.ad_id)).toEqual(["1", "2"]);
    const first = new URL(String(f.mock.calls[0]![0]));
    expect(first.searchParams.get("action_attribution_windows")).toBe('["7d_click"]');
    expect(String(f.mock.calls[1]![0])).not.toContain("access_token");
  });

  it("turns a raw row into an archive row", () => {
    const row = toInsightRow(
      {
        ad_id: "120211",
        date_start: "2026-10-25",
        spend: "12.34",
        impressions: "3100",
        reach: "2500",
        frequency: "1.24",
        inline_link_clicks: "41",
        outbound_clicks: [{ action_type: "outbound_click", value: "38" }],
        actions: [
          { action_type: "video_view", value: "980" },
          { action_type: "landing_page_view", value: "30" },
          { action_type: "offsite_conversion.fb_pixel_purchase", value: "3" },
          { action_type: "purchase", value: "3" },
        ],
        video_thruplay_watched_actions: [{ action_type: "video_view", value: "210" }],
      },
      "7d_click",
    );
    expect(row).toMatchObject({ objectId: "120211", spend: "12.34", impressions: 3100, linkClicks: 41, outboundClicks: 38, lpv: 30, purchases: 3, video3s: 980, thruplays: 210, attributionSetting: "7d_click" });
  });

  it("flags a sudden zero after a window change", () => {
    expect(windowSuspicious({ purchases: 12, spend: 100 }, { purchases: 0, spend: 90 })).toBe(true);
    expect(windowSuspicious({ purchases: 2, spend: 100 }, { purchases: 0, spend: 90 })).toBe(false);
  });
});
