"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Link2 } from "lucide-react";
import { Panel } from "@/components/mb/section";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

interface TokenRow {
  id: string;
  name: string;
  scopes: string[];
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
interface LinkRow {
  crCode: string;
  sourceRef: string;
  productCode: string | null;
}

/** The names the studio stores each token under (its secrets_store), so the owner knows where to paste it. */
const STUDIO_NAME: Record<string, string> = { "vp:read": "توكن القراءة", "vp:launch": "توكن الإطلاق" };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" }) : "ولا مرة");

/** «الربط ← استوديو المحتوى»: the studio's tokens, and which video came from which script (docs/STUDIO_DATA_CONTRACT_AR.md). */
export function StudioLink() {
  const { toast } = useToast();
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [scope, setScope] = useState("vp:read");
  const [cr, setCr] = useState("");
  const [vp, setVp] = useState("");

  const load = useCallback(async () => {
    const [t, l] = await Promise.all([fetch("/api/studio/tokens"), fetch("/api/studio/links")]);
    setTokens(t.ok ? ((await t.json()) as { tokens: TokenRow[] }).tokens : []);
    if (l.ok) setLinks(((await l.json()) as { links: LinkRow[] }).links);
  }, []);
  useEffect(() => {
    load().catch(() => setTokens([]));
  }, [load]);

  async function call(url: string, init: RequestInit) {
    const r = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
    const d = (await r.json().catch(() => ({}))) as { error?: string; token?: string };
    if (!r.ok) toast(d.error ?? "صار خطأ", "error");
    return r.ok ? d : null;
  }

  const live = (tokens ?? []).filter((t) => !t.revokedAt);
  return (
    <Panel className="space-y-4 md:col-span-2">
      <div>
        <p className="text-sm font-semibold text-fg">استوديو المحتوى</p>
        <p className="text-xs text-fg-muted">الاستوديو بيسحب من هون كم صرف كل فيديو منه وكم طلب انسلّم، لحتى يتعلّم شو الرابح. حط عنوان الميديا باير بإعدادات الاستوديو مكان «عنوان الـ OMS»، والتوكن بخانته.</p>
      </div>

      <div className="space-y-2">
        {live.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
            <KeyRound className="size-4 text-fg-muted" />
            <span className="text-fg">{t.name}</span>
            <span className="text-xs text-fg-muted">{t.scopes.map((s) => STUDIO_NAME[s] ?? s).join(" · ")}</span>
            <span dir="ltr" className="font-mono text-xs text-fg-muted">{t.prefix}…</span>
            <span className="ms-auto text-xs text-fg-muted">آخر استعمال: {when(t.lastUsedAt)}</span>
            <Button size="sm" variant="ghost" onClick={async () => (await call(`/api/studio/tokens/${t.id}`, { method: "DELETE" })) && load()}>
              وقّفه
            </Button>
          </div>
        ))}
        {tokens && !live.length ? <p className="text-xs text-fg-muted">ما في توكن. اعمل «توكن القراءة» أول شي.</p> : null}
      </div>

      {fresh ? (
        <div className="space-y-2 rounded-lg border border-accent/40 bg-accent/5 p-3">
          <p className="text-xs text-fg">هاد التوكن بيظهر هلأ بس. انسخه وحطه بالاستوديو، وما تبعته بأي محادثة.</p>
          <div className="flex items-center gap-2">
            <code dir="ltr" className="flex-1 break-all rounded bg-surface-2 px-2 py-1 font-mono text-xs text-fg">{fresh}</code>
            <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(fresh).then(() => toast("انسخ ✓ — حطه بالاستوديو هلأ", "success"))}>
              <Copy className="size-3.5" /> انسخ
            </Button>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setFresh(null)}>خلص، حطيته</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={scope} onChange={(e) => setScope(e.target.value)} className="w-auto">
            <option value="vp:read">توكن القراءة (الأداء)</option>
            <option value="vp:launch" disabled>توكن الإطلاق (بالمرحلة الجاية)</option>
          </Select>
          <Button
            size="sm"
            onClick={async () => {
              const d = await call("/api/studio/tokens", { method: "POST", body: JSON.stringify({ name: "استوديو المحتوى", scope }) });
              if (d?.token) {
                setFresh(d.token);
                await load();
              }
            }}
          >
            اعمل توكن
          </Button>
        </div>
      )}

      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-xs font-medium text-fg">أي فيديو من أي سكربت</p>
        <p className="text-xs text-fg-muted">لحد ما يصير الاستلام من الاستوديو تلقائي: اكتب رقم الفيديو بالميديا باير (مثلاً <span dir="ltr" className="whitespace-nowrap font-mono">CR00147</span>) ورقم سكربته بالاستوديو (مثلاً <span dir="ltr" className="whitespace-nowrap font-mono">VP-TRF01-0012-v2</span>).</p>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await call("/api/studio/links", { method: "POST", body: JSON.stringify({ crCode: cr.trim().toUpperCase(), vpId: vp.trim() }) })) {
              setCr("");
              setVp("");
              toast("انربط ✓", "success");
              await load();
            }
          }}
        >
          <Input dir="ltr" placeholder="CR00147" value={cr} onChange={(e) => setCr(e.target.value)} className="w-32 font-mono" />
          <Input dir="ltr" placeholder="VP-TRF01-0012-v2" value={vp} onChange={(e) => setVp(e.target.value)} className="w-56 font-mono" />
          <Button size="sm" variant="secondary" type="submit" disabled={!cr || !vp}>
            <Link2 className="size-3.5" /> اربط
          </Button>
        </form>
        {links.length ? (
          <ul className="flex flex-wrap gap-2">
            {links.map((l) => (
              <li key={l.crCode} dir="ltr" className="rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-fg-muted">
                {l.crCode} ↔ {l.sourceRef}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Panel>
  );
}
