import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { NotificationsPanel, type NotificationsPanelProps } from "@/components/settings/notifications-panel";
import { KIND_TABLE } from "@/core/notify-plan";

const base: NotificationsPanelProps = { prefs: {}, devices: [], missing: [], canLink: true, waiting: 0, held: 0, gaveUp: 0, demo: false };
/** the list item of one kind of notice */
const li = (out: string, label: string) => out.split("<li ").find((x) => x.includes(`>${label}</span>`) && x.includes("radiogroup"))!;
const html = (over: Partial<NotificationsPanelProps> = {}) => renderToStaticMarkup(createElement(NotificationsPanel, { ...base, ...over }));

describe("«الإشعارات» before Firebase is set up: a clear «setup needed» state", () => {
  const out = html({ missing: ["FIREBASE_API_KEY", "FIREBASE_VAPID_KEY"], waiting: 3, held: 1 });

  it("says what is missing (names), what still works, and where to paste it", () => {
    expect(out).toContain("لازم تجهّز Firebase");
    expect(out).toContain("إشعارات الجوال مش شغّالة لسا");
    expect(out).toContain("FIREBASE_API_KEY · FIREBASE_VAPID_KEY");
    expect(out).toContain("بالجرس بالموقع");
    expect(out).toContain('href="/settings/connections#row-firebase"');
  });

  it("says how many notices are saved in the bell but never left it", () => {
    expect(out).toContain("3 إشعارات انحفظت بالجرس وما طلعت لبرّا");
    expect(out).toContain("1 بينتظروا تصحى");
  });

  it("a person who cannot open the connections page is told who pastes the values, with no link", () => {
    const m = html({ missing: ["FIREBASE_API_KEY"], canLink: false });
    expect(m).not.toContain("/settings/connections");
    expect(m).toContain("المالك بيلصقهم");
  });

  it("with everything set the warning is gone", () => {
    expect(html()).not.toContain("لازم تجهّز Firebase");
  });
});

describe("the page itself", () => {
  it("lists every kind of notice with the three choices, the defaults chosen", () => {
    const out = html();
    for (const k of KIND_TABLE) expect(out).toContain(k.label);
    expect((out.match(/role="radiogroup"/g) ?? []).length).toBe(KIND_TABLE.length);
    expect((out.match(/value="ring"/g) ?? []).length).toBe(KIND_TABLE.length);
    expect(out).toContain("بيرنّ");
    expect(out).toContain("صامت");
    expect(out).toContain("بالموقع بس");
    // «مهمة خلصت» defaults to the bell: its «بالموقع بس» radio is the checked one in its own row
    const row = li(out, "مهمة خلصت");
    expect(row).toMatch(/checked=""[^>]*value="site"|value="site"[^>]*checked=""/);
  });

  it("a choice he made shows instead of the default", () => {
    const row = li(html({ prefs: { "run.done": "ring" } }), "مهمة خلصت");
    expect(row).toMatch(/checked=""[^>]*value="ring"|value="ring"[^>]*checked=""/);
  });

  it("says what happens while he sleeps and the limit of a browser notification (it is honest about «ما بيرنّ دقيقة»)", () => {
    const out = html();
    expect(out).toContain("وإنت نايم");
    expect(out).toContain("أكتر من 5 إشعارات بعشر دقايق بتصير واحد");
    expect(out).toContain("ما بيرنّ دقيقة متل المنبّه");
  });

  it("his phones with «شيله» and when each was last seen; with none it says so", () => {
    const out = html({ devices: [{ id: "d1", label: "أندرويد · Chrome", platform: "android", seen: "قبل 5 دقايق" }] });
    expect(out).toContain("أندرويد · Chrome");
    expect(out).toContain("آخر ظهور: قبل 5 دقايق");
    expect(out).toContain("شيله");
    expect(html()).toContain("ما في جهاز مسجّل لسا");
  });

  it("the buttons are off while Firebase is not set up and on the demo site (the demo says why)", () => {
    expect(html({ demo: true })).toContain("الموقع على الوضع التجريبي");
  });

  it("the first paint does not guess what the browser can do (it checks in the browser)", () => {
    expect(html()).toContain("عم نفحص المتصفح");
  });
});
