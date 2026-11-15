"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Copy, KeyRound } from "lucide-react";
import { Panel } from "@/components/mb/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" }) : "ولا مرة");

/**
 * «الربط ← Claude»: how the numbers reach the app before the official APIs are linked. Claude reads Ads Manager, the OMS and
 * the rest in the owner's browser and pushes them here through the MCP server. The owner adds the connector once in Claude.
 */
export function ClaudeLink({ mock }: { mock: boolean }) {
  const { toast } = useToast();
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [url, setUrl] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [name, setName] = useState("Claude الرئيسي");

  const load = useCallback(async () => {
    const r = await fetch("/api/mcp/tokens");
    if (!r.ok) return setTokens([]);
    const d = (await r.json()) as { tokens: TokenRow[]; url: string };
    setTokens(d.tokens);
    setUrl(d.url);
  }, []);
  useEffect(() => {
    load().catch(() => setTokens([]));
  }, [load]);

  async function call(u: string, init: RequestInit) {
    const r = await fetch(u, { ...init, headers: { "content-type": "application/json" } });
    const d = (await r.json().catch(() => ({}))) as { error?: string; token?: string };
    if (!r.ok) toast(d.error ?? "صار خطأ", "error");
    return r.ok ? d : null;
  }
  const copy = (text: string, done: string) => navigator.clipboard.writeText(text).then(() => toast(done, "success"));
  const live = (tokens ?? []).filter((t) => !t.revokedAt);

  return (
    <Panel className="space-y-4 md:col-span-2">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <Bot className="size-5" />
        </span>
        <div>
          <p className="text-sm font-semibold text-fg">Claude — طريق الأرقام لحد ما تنربط الـ APIs الرسمية</p>
          <p className="text-xs leading-5 text-fg-muted">Claude بيقرا مدير الإعلانات والـ OMS من متصفحك وبيبعت الأرقام والتشغيلات والطلبات هون. الموقع بيتصرف نفس تصرفه لو كان على الـ API: نفس الشاشات ونفس السجل. وبيطلب موافقتك على أي شي برّا القواعد، والتلفون بيرنّ.</p>
        </div>
      </div>

      {mock ? (
        <p className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs leading-5 text-warn">
          الموقع لسا بالوضع التجريبي (<span dir="ltr" className="font-mono">MOCK_MODE=1</span>): الأرقام اللي بيبعتها Claude بتنحفظ بس الشاشات بتضل تعرض الأرقام التجريبية. لما تربط Claude، غيّر <span dir="ltr" className="font-mono">MOCK_MODE</span> لـ <span dir="ltr" className="font-mono">0</span> بـ Coolify.
        </p>
      ) : null}

      <ol className="space-y-2 text-sm leading-6 text-fg">
        <li><span className="font-semibold">1.</span> اعمل توكن تحت (بيظهر مرة وحدة بس).</li>
        <li>
          <span className="font-semibold">2.</span> بـ Claude: <span className="text-fg-muted">الإعدادات ← الموصّلات (Customize ← Connectors) ← «إضافة» ← موصّل مخصّص</span>، واكتب العنوان:
          <span className="mt-1 flex items-center gap-2">
            <code dir="ltr" className="flex-1 break-all rounded bg-surface-2 px-2 py-1 font-mono text-xs text-fg">{url || "…/mcp"}</code>
            <Button size="sm" variant="secondary" disabled={!url} onClick={() => copy(url, "انسخ العنوان ✓")}>
              <Copy className="size-3.5" /> انسخ
            </Button>
          </span>
        </li>
        <li>
          <span className="font-semibold">3.</span> بقسم <span className="text-fg-muted">«ترويسات الطلب» (Request headers)</span> أضف: <code dir="ltr" className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">Authorization</code> = <code dir="ltr" className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">Bearer التوكن</code> — واختار «بلا تسجيل دخول». بعدين اطلب من Claude: «شغّل get_mode».
        </li>
      </ol>

      <div className="space-y-2">
        {live.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
            <KeyRound className="size-4 text-fg-muted" />
            <span className="text-fg">{t.name}</span>
            <span dir="ltr" className="font-mono text-xs text-fg-muted">{t.prefix}…</span>
            <span className="ms-auto text-xs text-fg-muted">آخر استعمال: {when(t.lastUsedAt)}</span>
            <Button size="sm" variant="ghost" onClick={async () => (await call(`/api/mcp/tokens/${t.id}`, { method: "DELETE" })) && load()}>
              وقّفه
            </Button>
          </div>
        ))}
        {tokens && !live.length ? <p className="text-xs text-fg-muted">ما في توكن لـ Claude لسا.</p> : null}
      </div>

      {fresh ? (
        <div className="space-y-2 rounded-lg border border-accent/40 bg-accent/5 p-3">
          <p className="text-xs text-fg">هاد التوكن بيظهر هلأ بس. انسخه وحطه بإعدادات الموصّل بـ Claude، وما تبعته بأي محادثة.</p>
          <div className="flex items-center gap-2">
            <code dir="ltr" className="flex-1 break-all rounded bg-surface-2 px-2 py-1 font-mono text-xs text-fg">{fresh}</code>
            <Button size="sm" variant="secondary" onClick={() => copy(fresh, "انسخ ✓ — حطه بـ Claude هلأ")}>
              <Copy className="size-3.5" /> انسخ
            </Button>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setFresh(null)}>خلص، حطيته</Button>
        </div>
      ) : (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const d = await call("/api/mcp/tokens", { method: "POST", body: JSON.stringify({ name }) });
            if (d?.token) {
              setFresh(d.token);
              await load();
            }
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم التوكن" className="w-56" aria-label="اسم التوكن" />
          <Button size="sm" type="submit" disabled={!name.trim()}>
            اعمل توكن لـ Claude
          </Button>
        </form>
      )}
    </Panel>
  );
}
