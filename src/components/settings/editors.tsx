"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, Plus, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Panel } from "@/components/mb/section";
import { fmt } from "@/lib/format";
import { MARKETS, MARKET_AR } from "@/core/naming";
import { ROLES, ROLE_AR, type RoleKey } from "@/core/roles";
import type { EditView } from "@/lib/settings-view";
import { cn } from "@/lib/utils";

/** One save: POST the body, say what happened, refresh the server numbers. Returns the answer (for one-time codes). */
function useSave() {
  const { toast } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const save = async (url: string, body: unknown, done = "انحفظ", method = "POST") => {
    setBusy(true);
    try {
      const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
      if (!r.ok) {
        toast(j.error ?? "ما انحفظ", "error");
        return null;
      }
      toast(done, "success");
      router.refresh();
      return j;
    } finally {
      setBusy(false);
    }
  };
  return { save, busy };
}

const num = (v: string) => (v.trim() === "" ? NaN : Number(v));

// ───────────────────────────── money: caps and the split ─────────────────────────────

export function CapsEditor({ accounts, split }: Pick<EditView, "accounts" | "split">) {
  const { save, busy } = useSave();
  const [caps, setCaps] = useState(() => Object.fromEntries(accounts.map((a) => [a.metaId, { d: String(a.dailyCap ?? ""), m: String(a.monthlyCap ?? "") }])));
  const [sp, setSp] = useState({ scale: String(Math.round(split.scale * 100)), test: String(Math.round(split.test * 100)), new: String(Math.round(split.new * 100)) });
  const total = num(sp.scale) + num(sp.test) + num(sp.new);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {accounts.map((a) => (
        <Panel key={a.metaId} className="space-y-2">
          <p className="text-sm font-semibold text-fg">{a.name} <span className="text-xs font-normal text-fg-muted">· {a.market}</span></p>
          <div className="grid grid-cols-2 gap-2">
            <label><Label>السقف اليومي $</Label><Input dir="ltr" inputMode="decimal" value={caps[a.metaId]!.d} onChange={(e) => setCaps({ ...caps, [a.metaId]: { ...caps[a.metaId]!, d: e.target.value } })} /></label>
            <label><Label>السقف الشهري $</Label><Input dir="ltr" inputMode="decimal" value={caps[a.metaId]!.m} onChange={(e) => setCaps({ ...caps, [a.metaId]: { ...caps[a.metaId]!, m: e.target.value } })} /></label>
          </div>
          <Button disabled={busy} className="min-h-9" onClick={() => save(`/api/accounts/${a.metaId}/caps`, { dailyCap: num(caps[a.metaId]!.d), monthlyCap: num(caps[a.metaId]!.m) || 0 }, `${a.name}: السقوف انحفظت`)}>
            <Check className="size-4" /> احفظ
          </Button>
        </Panel>
      ))}
      <Panel className="space-y-2">
        <p className="text-sm font-semibold text-fg">توزيع الميزانية</p>
        <div className="grid grid-cols-3 gap-2">
          {(["scale", "test", "new"] as const).map((k) => (
            <label key={k}><Label>{{ scale: "تكبير %", test: "اختبار %", new: "جديد %" }[k]}</Label><Input dir="ltr" inputMode="numeric" value={sp[k]} onChange={(e) => setSp({ ...sp, [k]: e.target.value })} /></label>
          ))}
        </div>
        <p className={cn("text-xs", total === 100 ? "text-fg-muted" : "text-warn")}>المجموع {Number.isFinite(total) ? total : "—"}% {total === 100 ? "" : "— لازم 100%"}</p>
        <Button disabled={busy || total !== 100} className="min-h-9" onClick={() => save("/api/settings/budget.split", { value: { scale: num(sp.scale) / 100, test: num(sp.test) / 100, new: num(sp.new) / 100 } }, "التوزيع انحفظ")}>
          <Check className="size-4" /> احفظ
        </Button>
      </Panel>
    </div>
  );
}

// ───────────────────────────── products ─────────────────────────────

type Product = EditView["products"][number];
const EMPTY = { code: "", name: "", market: "SY", price: "", unitCost: "", deliveryFee: "", returnFee: "", codFeePct: "0", confirmCost: "0.3", stockDays: "" };

function ProductForm({ p, onSaved, caps }: { p?: Product; onSaved?: () => void; caps: Record<string, number> }) {
  const { save, busy } = useSave();
  const [f, setF] = useState(() =>
    p
      ? { code: p.code, name: p.name, market: p.market, price: String(p.price), unitCost: String(p.unitCost), deliveryFee: String(p.deliveryFee), returnFee: String(p.returnFee), codFeePct: String(Math.round(p.codFeePct * 1000) / 10), confirmCost: String(p.confirmCost), stockDays: p.stockDays === null ? "" : String(p.stockDays) }
      : EMPTY,
  );
  const [cap, setCap] = useState(p?.dailyCap === null || p?.dailyCap === undefined ? "" : String(p.dailyCap));
  const field = (k: keyof typeof f, label: string, mode: "decimal" | "text" = "decimal") => (
    <label><Label>{label}</Label><Input dir="ltr" inputMode={mode} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  );
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {p ? null : field("code", "الرمز (TRF01)", "text")}
        <label className={p ? "col-span-2" : ""}><Label>الاسم</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label><Label>السوق</Label><Select value={f.market} onChange={(e) => setF({ ...f, market: e.target.value })}>{MARKETS.map((m) => <option key={m} value={m}>{MARKET_AR[m]}</option>)}</Select></label>
        {field("price", "السعر $")}
        {field("unitCost", "تكلفة الوحدة $")}
        {field("deliveryFee", "التوصيل $")}
        {field("returnFee", "المرتجع $")}
        {field("codFeePct", "عمولة التحصيل %")}
        {field("confirmCost", "تكلفة التأكيد $")}
        {field("stockDays", "المخزون (أيام)")}
      </div>
      <Button
        disabled={busy}
        className="min-h-9"
        onClick={async () => {
          const ok = await save("/api/products", { productCode: f.code.trim().toUpperCase(), name: f.name, market: f.market, price: num(f.price), unitCost: num(f.unitCost), deliveryFee: num(f.deliveryFee), returnFee: num(f.returnFee) || 0, codFeePct: (num(f.codFeePct) || 0) / 100, confirmCost: num(f.confirmCost) || 0, stockDays: f.stockDays.trim() === "" ? null : Math.round(num(f.stockDays)) }, p ? `${f.name}: انحفظ` : `${f.name}: انضاف`);
          if (ok) onSaved?.();
        }}
      >
        <Check className="size-4" /> {p ? "احفظ الأرقام" : "ضيف المنتج"}
      </Button>
      {p ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-2">
          <label className="w-40"><Label>سقف المنتج باليوم $ (فاضي = بلا)</Label><Input dir="ltr" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} /></label>
          <Button variant="ghost" disabled={busy} className="min-h-9" onClick={() => { const next = { ...caps }; if (cap.trim() === "") delete next[p.code]; else next[p.code] = num(cap); save("/api/settings/scale.product_caps", { value: next }, "سقف المنتج انحفظ"); }}>
            احفظ السقف
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function ProductsEditor({ products }: Pick<EditView, "products">) {
  const [adding, setAdding] = useState(false);
  const caps = Object.fromEntries(products.filter((p) => p.dailyCap !== null).map((p) => [p.code, p.dailyCap!]));
  return (
    <div className="space-y-2">
      {products.map((p) => (
        <details key={p.code} className="rounded-card border border-border bg-surface-1 p-3">
          <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-fg">{p.name}</span>
            <span dir="ltr" className="font-mono text-xs text-fg-muted">{p.code}</span>
            <span className="text-xs text-fg-muted">· {MARKET_AR[p.market as keyof typeof MARKET_AR] ?? p.market}</span>
            <span className="ms-auto text-xs text-fg-muted">هدف الطلب {fmt(p.tOrder, "$")} · السقف {fmt(p.ceiling, "$")}{p.source === "actual" ? "" : " (تقدير)"}</span>
            {p.losing ? <span className="rounded-md bg-warn/10 px-1.5 py-0.5 text-[11px] font-semibold text-warn">خسران بأسعاره</span> : null}
          </summary>
          <div className="mt-3"><ProductForm p={p} caps={caps} /></div>
        </details>
      ))}
      {adding ? (
        <Panel><ProductForm caps={caps} onSaved={() => setAdding(false)} /></Panel>
      ) : (
        <Button variant="ghost" className="min-h-9" onClick={() => setAdding(true)}><Plus className="size-4" /> منتج جديد</Button>
      )}
      <p className="text-[11px] text-fg-muted">لما ينربط الـ OMS، أرقامه (التكلفة والرسوم والمخزون) بتغلب بكل مزامنة. هدف الطلب والسقف بيتحسبوا من هالأرقام بالحاسبة.</p>
    </div>
  );
}

// ───────────────────────────── pages and landing pages ─────────────────────────────

export function PagesEditor({ pages }: Pick<EditView, "pages">) {
  const { save, busy } = useSave();
  const [codes, setCodes] = useState(() => Object.fromEntries(pages.map((p) => [p.metaId, p.code ?? ""])));
  const [n, setN] = useState({ metaId: "", name: "", code: "" });
  return (
    <Panel className="space-y-2">
      <p className="text-sm font-semibold text-fg">صفحات فيسبوك ورموزها</p>
      <p className="text-xs text-fg-muted">الرمز (حرفين) بينكتب باسم كل مجموعة، فبتنقارن الصفحات بالتقرير. الصفحات بتيجي من ميتا لما ينربط.</p>
      {pages.map((p) => (
        <div key={p.metaId} className="flex items-end gap-2">
          <div className="min-w-0 flex-1"><p className="truncate text-sm text-fg">{p.name}</p><p dir="ltr" className="text-start font-mono text-[11px] text-fg-muted">{p.metaId}</p></div>
          <Input dir="ltr" className="w-16 text-center font-mono" maxLength={2} value={codes[p.metaId]} onChange={(e) => setCodes({ ...codes, [p.metaId]: e.target.value.toUpperCase() })} aria-label={`رمز ${p.name}`} />
          <Button variant="ghost" disabled={busy || codes[p.metaId] === (p.code ?? "")} className="min-h-9" onClick={() => save("/api/pages", { metaId: p.metaId, name: p.name, code: codes[p.metaId] }, `${p.name}: ${codes[p.metaId]}`)}>احفظ</Button>
        </div>
      ))}
      <div className="grid grid-cols-[1fr_1fr_4rem_auto] items-end gap-2 border-t border-border pt-2">
        <label><Label>رقم الصفحة</Label><Input dir="ltr" inputMode="numeric" value={n.metaId} onChange={(e) => setN({ ...n, metaId: e.target.value.trim() })} /></label>
        <label><Label>الاسم</Label><Input value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></label>
        <label><Label>الرمز</Label><Input dir="ltr" className="text-center font-mono" maxLength={2} value={n.code} onChange={(e) => setN({ ...n, code: e.target.value.toUpperCase() })} /></label>
        <Button disabled={busy} className="min-h-9" onClick={async () => { if (await save("/api/pages", n, `${n.name}: انضافت`)) setN({ metaId: "", name: "", code: "" }); }}><Plus className="size-4" /></Button>
      </div>
    </Panel>
  );
}

export function LandingEditor({ landing, products }: Pick<EditView, "landing" | "products">) {
  const { save, busy } = useSave();
  const [n, setN] = useState({ productCode: products[0]?.code ?? "", lpCode: "LP1", url: "" });
  const put = (list: EditView["landing"], done: string) => save("/api/settings/landing.pages", { value: list }, done);
  return (
    <Panel className="space-y-2">
      <p className="text-sm font-semibold text-fg">صفحات الهبوط</p>
      <p className="text-xs text-fg-muted">رمز الصفحة (LP1 · LP2) بيدخل باسم كل إعلان، ورابطها بيتعبّى لحاله بمعالج الإطلاق.</p>
      {landing.map((l) => (
        <div key={`${l.productCode}-${l.lpCode}`} className="flex items-center gap-2 text-sm">
          <span dir="ltr" className="w-28 shrink-0 font-mono text-xs text-fg">{l.productCode} · {l.lpCode}</span>
          <span dir="ltr" className="min-w-0 flex-1 truncate text-start text-xs text-fg-muted">{l.url}</span>
          <button type="button" aria-label="شيل" disabled={busy} onClick={() => put(landing.filter((x) => x !== l), "انشالت")} className="text-fg-muted hover:text-danger"><Trash2 className="size-4" /></button>
        </div>
      ))}
      <div className="grid grid-cols-[6rem_4rem_1fr_auto] items-end gap-2 border-t border-border pt-2">
        <label><Label>المنتج</Label><Select value={n.productCode} onChange={(e) => setN({ ...n, productCode: e.target.value })}>{products.map((p) => <option key={p.code} value={p.code}>{p.code}</option>)}</Select></label>
        <label><Label>الرمز</Label><Input dir="ltr" className="text-center font-mono" value={n.lpCode} onChange={(e) => setN({ ...n, lpCode: e.target.value.toUpperCase() })} /></label>
        <label><Label>الرابط</Label><Input dir="ltr" placeholder="https://…" value={n.url} onChange={(e) => setN({ ...n, url: e.target.value.trim() })} /></label>
        <Button disabled={busy || !n.url} className="min-h-9" onClick={async () => { if (await put([...landing, n], `${n.productCode} ${n.lpCode}: انضافت`)) setN({ ...n, url: "" }); }}><Plus className="size-4" /></Button>
      </div>
    </Panel>
  );
}

export function PurchaseOnPicker({ value }: { value: EditView["purchaseOn"] }) {
  const { save, busy } = useSave();
  return (
    <Panel className="space-y-2">
      <p className="text-sm font-semibold text-fg">متى بنقول لميتا «شراء»؟</p>
      <div className="grid grid-cols-2 gap-2">
        {([["confirmed", "عند التأكيد", "أسرع تعلّم (الافتراضي)"], ["delivered", "عند التسليم", "أدق، بس أبطأ"]] as const).map(([k, l, h]) => (
          <button key={k} type="button" disabled={busy || value === k} onClick={() => save("/api/settings/capi.purchase_on", { value: k }, `صار: ${l}`)} className={cn("rounded-lg border p-2 text-start", value === k ? "border-accent bg-accent/10" : "border-border hover:border-accent/50")}>
            <span className="block text-sm text-fg">{l}</span><span className="text-[11px] text-fg-muted">{h}</span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

// ───────────────────────────── the team ─────────────────────────────

function CodeOnce({ code, hours, onClose }: { code: string; hours: number; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 rounded-lg border border-accent bg-accent/5 p-3">
      <p className="text-sm font-semibold text-fg">رمز الدعوة — بيبيّن هلأ بس</p>
      <p dir="ltr" className="text-center font-mono text-lg tracking-widest text-fg">{code}</p>
      <p className="text-xs text-fg-muted">ابعته للعضو بإيدك. بيفتح الموقع ← «عندي رمز دعوة» ← إيميله والرمز وكلمة سر بيختارها. بينفع مرة وحدة، لمدة {hours} ساعة.</p>
      <div className="flex gap-2">
        <Button variant="ghost" className="min-h-9" onClick={() => { navigator.clipboard?.writeText(code).then(() => setCopied(true)).catch(() => undefined); }}><Copy className="size-4" /> {copied ? "انتسخ" : "انسخ"}</Button>
        <Button variant="ghost" className="min-h-9" onClick={onClose}>خلص</Button>
      </div>
    </div>
  );
}

export function TeamPanel({ team, me }: Pick<EditView, "team"> & { me: string | null }) {
  const { save, busy } = useSave();
  const [n, setN] = useState({ email: "", name: "", role: "ADS_MANAGER" as RoleKey });
  const [code, setCode] = useState<{ code: string; hours: number } | null>(null);
  return (
    <div className="space-y-3">
      <Panel className="divide-y divide-border p-0">
        {team.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="text-fg">{u.name}{u.id === me ? " (إنت)" : ""}</p>
              <p dir="ltr" className="text-start text-xs text-fg-muted">{u.email}</p>
              <p className="text-[11px] text-fg-muted">{u.invitePending ? "بانتظار أول دخول بالرمز" : u.lastLogin ? `آخر دخول ${u.lastLogin}` : "ما دخل لسا"}{u.active ? "" : " · موقوف"}</p>
            </div>
            <Select className="w-36" disabled={busy || u.id === me} value={u.role} onChange={(e) => save(`/api/team/${u.id}`, { role: e.target.value }, `${u.name}: صار ${ROLE_AR[e.target.value as RoleKey]}`, "PATCH")}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_AR[r]}</option>)}
            </Select>
            {u.id === me ? null : (
              <>
                <Button variant="ghost" disabled={busy} className="min-h-9 px-2 text-xs" onClick={async () => { const j = await save(`/api/team/${u.id}`, { reinvite: true }, "رمز جديد", "PATCH"); if (j?.code) setCode({ code: String(j.code), hours: Number(j.hours) }); }}><KeyRound className="size-3.5" /> رمز جديد</Button>
                <Button variant="ghost" disabled={busy} className={cn("min-h-9 px-2 text-xs", u.active ? "text-danger" : "")} onClick={() => save(`/api/team/${u.id}`, { active: !u.active }, u.active ? `${u.name}: انوقف` : `${u.name}: رجع`, "PATCH")}>{u.active ? "أوقف" : "رجّع"}</Button>
              </>
            )}
          </div>
        ))}
      </Panel>
      {code ? <CodeOnce code={code.code} hours={code.hours} onClose={() => setCode(null)} /> : null}
      <Panel className="space-y-2">
        <p className="text-sm font-semibold text-fg">ضيف عضو</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end">
          <label><Label>الإيميل</Label><Input dir="ltr" type="email" value={n.email} onChange={(e) => setN({ ...n, email: e.target.value.trim() })} /></label>
          <label><Label>الاسم</Label><Input value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></label>
          <label><Label>الدور</Label><Select value={n.role} onChange={(e) => setN({ ...n, role: e.target.value as RoleKey })}>{ROLES.filter((r) => r !== "OWNER").map((r) => <option key={r} value={r}>{ROLE_AR[r]}</option>)}</Select></label>
          <Button disabled={busy || !n.email || !n.name} className="min-h-9" onClick={async () => { const j = await save("/api/team", n, `${n.name}: انعملت الدعوة`); if (j?.code) { setCode({ code: String(j.code), hours: Number(j.hours) }); setN({ email: "", name: "", role: "ADS_MANAGER" }); } }}><UserPlus className="size-4" /> ادعُ</Button>
        </div>
        <p className="text-[11px] text-fg-muted">مدير الإعلانات: بيوقف وبيوافق ضمن السقف · المحلل: بيقترح بس · المشاهد: بيشوف بس. السقوف والمستويات والفريق: للمالك بس.</p>
      </Panel>
    </div>
  );
}
