"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BatteryWarning, ChevronDown, ExternalLink, FileText, FlaskConical, Play, Sparkles } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useMission } from "@/components/mb/mission";
import { CardCustom, type EntityCustom } from "@/components/customize/card-custom";
import { Num } from "@/components/mb/num";
import { Panel, Section } from "@/components/mb/section";
import { REQUEST_KINDS, REQUEST_KIND_AR, REQUEST_STATUS_AR, REQUEST_STEPS, canMoveRequest, type RequestKind, type RequestStatus } from "@/core/video-board";
import type { BoardData, BoardProduct, BoardRequest, BoardVideo } from "@/lib/videos-board";
import { cn } from "@/lib/utils";

/** The owner's fields and buttons for video cards (set in «وضع التعديل»), shared with every card of the board. */
const CustomCtx = createContext<{ custom?: EntityCustom; canEdit: boolean }>({ canEdit: false });

const ICON: Record<RequestKind, typeof Sparkles> = { new_hooks: Sparkles, new_script: FileText, to_test: FlaskConical, tired: BatteryWarning };
const TONE = { ok: "text-ok", warn: "text-warn", danger: "text-danger" } as const;

/** A button that asks twice: the first tap says «متأكد؟», the second does it. For what cannot be taken back, without a dialog on top of the page. */
function Confirm({ label, sure, onGo, className, ...rest }: { label: React.ReactNode; sure: string; onGo: () => void } & Omit<ButtonProps, "onClick">) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button
      {...rest}
      className={cn(className, armed && "border-warn text-warn")}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onGo();
        } else setArmed(true);
      }}
    >
      {armed ? sure : label}
    </Button>
  );
}

/** طلب ← عند هيرمز ← جاهز ← مرفوع, the step it is at lit. */
function Steps({ status }: { status: RequestStatus }) {
  const at = REQUEST_STEPS.indexOf(status as (typeof REQUEST_STEPS)[number]);
  return (
    <ol className="flex flex-wrap items-center gap-1 text-[11px]" aria-label="مراحل الطلب">
      {REQUEST_STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-1">
          <span className={cn("rounded-full px-2 py-0.5 font-medium", i === at ? "bg-accent text-accent-fg" : i < at ? "bg-accent/15 text-accent" : "bg-surface-2 text-fg-muted")}>{REQUEST_STATUS_AR[s]}</span>
          {i < REQUEST_STEPS.length - 1 ? <span aria-hidden className="text-fg-muted">←</span> : null}
        </li>
      ))}
    </ol>
  );
}

const NEXT: Partial<Record<RequestStatus, { to: RequestStatus; label: string }>> = {
  asked: { to: "with_hermes", label: "صار عند هيرمز" },
  with_hermes: { to: "ready", label: "هيرمز خلّص" },
  ready: { to: "uploaded", label: "انرفع" },
};

function RequestRow({ r, move }: { r: BoardRequest; move: (r: BoardRequest, to: RequestStatus) => void }) {
  const next = NEXT[r.status];
  return (
    <li className="space-y-2 rounded-xl border border-border bg-surface-2/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-fg">
          <span dir="ltr" className="me-1 font-mono">{r.label}</span>
          <span className="text-fg-muted">— {r.kindLabel}</span>
        </p>
        <Link href="/work/tasks" className="text-xs font-medium text-accent hover:underline">شوفه بالمهام</Link>
      </div>
      <Steps status={r.status} />
      {r.via === "none" && r.status === "asked" ? (
        <p className="text-xs leading-5 text-fg-muted">{r.deliveryError ? `ما وصل لهيرمز (${r.deliveryError}). ` : ""}محفوظ بالمهام، وهيرمز بيسحبه من الطابور (GET /api/v1/video-requests).</p>
      ) : r.via !== "none" ? (
        <p className="text-xs text-fg-muted">وصل لهيرمز {r.via === "api" ? "بالـ API" : "بتيليجرام"}.</p>
      ) : null}
      {r.status === "ready" && r.resultNote ? <p className="rounded-lg bg-ok/10 p-2 text-xs leading-5 text-fg">{r.resultNote}</p> : null}
      <div className="flex flex-wrap gap-2">
        {next ? (
          <Button size="sm" className="min-h-10" onClick={() => move(r, next.to)}>
            {next.label}
          </Button>
        ) : null}
        {canMoveRequest(r.status, "cancelled") ? (
          <Confirm size="sm" variant="ghost" className="min-h-10" label="إلغاء" sure="متأكد؟ اضغط كمان مرة" onGo={() => move(r, "cancelled")} />
        ) : null}
      </div>
    </li>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-fg-muted">{label}</dt>
      <dd className="truncate text-sm font-semibold text-fg">{children}</dd>
    </div>
  );
}

function VideoCard({ v, rank, busy, ask }: { v: BoardVideo; rank?: number; busy: string | null; ask: (v: BoardVideo, kind: RequestKind) => void }) {
  const [peek, setPeek] = useState(false);
  const { custom, canEdit } = useContext(CustomCtx);
  const tired = v.fatigue.state === "tired";
  return (
    <li className="space-y-3 rounded-xl border border-border bg-surface-1 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            {rank ? <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-bold text-accent">{rank}</span> : null}
            <span dir="ltr" className="truncate font-mono text-sm font-semibold text-fg">{v.label}</span>
            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-muted">{v.statusLabel}</span>
          </p>
          {v.request ? (
            <p className="mt-1 text-xs text-fg-muted">
              طلب مفتوح: {v.request.kindLabel} — <span className="font-medium text-fg">{v.request.statusLabel}</span>
            </p>
          ) : null}
        </div>
        {tired ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warn/10 px-2 py-0.5 text-xs font-medium text-warn">
            <BatteryWarning className="size-3.5" /> تعبان
          </span>
        ) : null}
      </div>

      <dl className="grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-7">
        <Cell label="تكلفة الطلب">
          <span className={cn(v.tone && TONE[v.tone])}>
            <Num value={v.costPerOrder} unit="$" term="costPerOrder" />
          </span>
        </Cell>
        <Cell label="الطلبات"><Num value={v.orders} term="realOrders" /></Cell>
        <Cell label="الصرف"><Num value={v.spend} unit="$" term="spend" /></Cell>
        <Cell label="Hook"><Num value={v.hook} unit="%" term="hook" /></Cell>
        <Cell label="Hold"><Num value={v.hold} unit="%" term="hold" /></Cell>
        <Cell label="CTR"><Num value={v.ctr} unit="%" term="ctr" /></Cell>
        <Cell label="أيام العرض"><Num value={v.days} term="daysRunning" /></Cell>
      </dl>

      {tired ? <p className="rounded-lg bg-warn/5 p-2 text-xs leading-5 text-fg">{v.fatigue.text}</p> : null}

      <CardCustom entity="video" entityId={v.key} custom={custom} canEdit={canEdit} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {v.previewUrl ? (
          <button type="button" onClick={() => setPeek((o) => !o)} aria-expanded={peek} className="inline-flex min-h-8 items-center gap-1 font-medium text-accent hover:underline">
            <Play className="size-3.5" /> {peek ? "سكّر المعاينة" : "شوف الفيديو"}
          </button>
        ) : (
          <span className="text-fg-muted">ما في ملف درايف مربوط</span>
        )}
        {v.scenarioUrl ? (
          <a href={v.scenarioUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1 font-medium text-accent hover:underline">
            <FileText className="size-3.5" /> السيناريو <ExternalLink className="size-3" />
          </a>
        ) : (
          <span className="text-fg-muted">السيناريو: ما انربط ملفه</span>
        )}
        <span className="text-fg-muted">{v.adsCount ? `${v.adsCount} إعلان` : "ما في إعلان شغّال عليه"}</span>
      </div>

      {peek && v.previewUrl ? (
        <iframe src={v.previewUrl} title={`معاينة ${v.label}`} loading="lazy" allow="autoplay" referrerPolicy="no-referrer" className="aspect-[9/16] max-h-[28rem] w-full max-w-xs rounded-lg border border-border bg-surface-2" />
      ) : null}

      <Actions v={v} busy={busy} ask={ask} />
    </li>
  );
}

/**
 * ONE button on a card: «اطلب…» opens the four requests (new hooks · new script · up to the test · tired). «تعب» asks twice — it flips the
 * video's own flag in the bank — so it turns the button into «متأكد؟ أيوه / لا» in the same place.
 */
function Actions({ v, busy, ask }: { v: BoardVideo; busy: string | null; ask: (v: BoardVideo, kind: RequestKind) => void }) {
  const [sure, setSure] = useState(false);
  const working = !!busy && busy.startsWith(`${v.key}:`);
  if (sure) {
    return (
      <div data-tour="actions" role="group" aria-label="تأكيد تعب" className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-fg">متأكد إنه تعب؟</span>
        <Button size="sm" onClick={() => (setSure(false), ask(v, "tired"))}>
          أيوه
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setSure(false)}>
          لا
        </Button>
      </div>
    );
  }
  return (
    <div data-tour="actions">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="secondary" disabled={!!busy}>
            {working ? "لحظة…" : "اطلب…"}
            <ChevronDown className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {REQUEST_KINDS.map((kind) => {
            const Icon = ICON[kind];
            return (
              <DropdownMenuItem key={kind} disabled={kind === "tired" && v.status === "fatigued"} onSelect={() => (kind === "tired" ? setSure(true) : ask(v, kind))}>
                <Icon className="size-4" aria-hidden /> {REQUEST_KIND_AR[kind]}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function Gauge({ p }: { p: BoardProduct }) {
  const b = p.bank;
  const parts: [string, number | undefined][] = [
    ["جاهز", b.byState.ready],
    ["بالتجربة", (b.byState.testing ?? 0) + (b.byState.uploaded ?? 0)],
    ["رابح", b.byState.winner],
    ["تعبان", b.byState.fatigued],
  ];
  return (
    <div data-tour="bank" className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold text-fg">
          البنك: <Num value={b.count} term="bankCount" /> من {b.target}
        </span>
        {b.short > 0 ? <span className="text-xs text-fg-muted">ناقص {b.short}</span> : <span className="text-xs text-ok">كامل ✓</span>}
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={b.target} aria-valuenow={Math.min(b.count, b.target)} aria-label={`بنك ${p.name}`} className="h-2.5 overflow-hidden rounded-full bg-surface-2">
        <div className={cn("h-full rounded-full", b.pct >= 100 ? "bg-ok" : b.pct >= 50 ? "bg-accent" : "bg-warn")} style={{ width: `${b.pct}%` }} />
      </div>
      <p className="flex flex-wrap gap-x-3 text-xs text-fg-muted">
        {parts.filter(([, n]) => n).map(([label, n]) => (
          <span key={label}>{label} {n}</span>
        ))}
      </p>
    </div>
  );
}

function ProductBoard({ p, busy, ask, move }: { p: BoardProduct; busy: string | null; ask: (v: BoardVideo, kind: RequestKind) => void; move: (r: BoardRequest, to: RequestStatus) => void }) {
  return (
    <Panel className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <h2 className="text-base font-bold text-fg">{p.name}</h2>
          <p dir="ltr" className="text-start font-mono text-xs text-fg-muted">{p.code}</p>
        </div>
        <div className="w-full sm:w-72">
          <Gauge p={p} />
        </div>
      </div>

      {p.requests.length ? (
        <div className="space-y-2" data-tour="requests">
          <h3 className="text-sm font-bold text-fg">طلبات مفتوحة ({p.requests.length})</h3>
          <ul className="grid gap-2 lg:grid-cols-2">
            {p.requests.map((r) => (
              <RequestRow key={r.id} r={r} move={move} />
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-2" data-tour="winners">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-bold text-fg">الرابحين — الأرخص طلب حقيقي أول</h3>
          {p.minSpend !== null ? (
            <span className="text-xs text-fg-muted">
              بعد ما يصرف <Num value={p.minSpend} unit="$" term="minSpend" /> {p.minSpendFrom === "target" ? "(ضعف هدفك)" : "(اللي كتبته)"} بآخر 7 أيام
            </span>
          ) : (
            <span className="text-xs text-fg-muted">ما في حد أدنى للصرف — اكتبه فوق</span>
          )}
        </div>
        {p.winners.length ? (
          <ul className="space-y-2">
            {p.winners.map((v, i) => (
              <VideoCard key={v.key} v={v} rank={i + 1} busy={busy} ask={ask} />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-border p-3 text-sm text-fg-muted">ما في فيديو وصل للحد لسا وجاب طلب حقيقي بآخر 7 أيام.</p>
        )}
      </div>

      {p.learning.length ? (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-fg">لسا بيتقيّم ({p.learning.length})</h3>
          <p className="text-xs text-fg-muted">صرف بس لسا ما وصل للحد أو ما جاب طلب — ما بنحكم عليه.</p>
          <ul className="space-y-2">
            {p.learning.map((v) => (
              <VideoCard key={v.key} v={v} busy={busy} ask={ask} />
            ))}
          </ul>
        </div>
      ) : null}

      {p.rest.length ? (
        <details className="group rounded-xl border border-border bg-surface-1">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-semibold text-fg">
            <span>باقي البنك — مش شغّال هلأ ({p.rest.length})</span>
            <ChevronDown className="size-4 text-fg-muted transition-transform group-open:rotate-180" />
          </summary>
          <ul className="space-y-2 p-3 pt-0">
            {p.rest.map((v) => (
              <VideoCard key={v.key} v={v} busy={busy} ask={ask} />
            ))}
          </ul>
        </details>
      ) : null}
    </Panel>
  );
}

/** The minimum spend before a video is ranked — the owner types it (nothing is committed in code). */
function MinSpend({ typed }: { typed: number | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = useState(typed === null ? "" : String(typed));
  const [saving, setSaving] = useState(false);
  async function save() {
    const n = value.trim() === "" ? null : Number(value);
    if (n !== null && !(n > 0)) return toast("اكتب رقم أكبر من صفر، أو خلّيه فاضي", "error");
    setSaving(true);
    try {
      const r = await fetch("/api/videos/min-spend", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: n }) });
      const d = (await r.json().catch(() => ({}))) as { error?: string; demo?: boolean };
      if (!r.ok) return toast(d.error ?? "صار خطأ", "error");
      toast(d.demo ? "بالوضع التجريبي ما انحفظ شي" : "انحفظ ✓", d.demo ? "info" : "success");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      <label htmlFor="min-spend" className="text-fg-muted">ما بنرتّب فيديو قبل ما يصرف</label>
      <Input id="min-spend" dir="ltr" inputMode="decimal" type="number" min="0" step="0.5" value={value} onChange={(e) => setValue(e.target.value)} placeholder="ضعف هدفك" className="h-9 w-28" />
      <span className="text-fg-muted">$ بآخر 7 أيام</span>
      <Button type="submit" size="sm" variant="secondary" className="min-h-9" disabled={saving}>
        {saving ? "لحظة…" : "احفظ"}
      </Button>
    </form>
  );
}

/**
 * الفيديوهات, the board per product (v3 · D): the bank against 50, the winners ranked by the cost of a real order, the tired
 * ones, and four buttons on every card — each one a request to Hermes, shown as a card on المهام. Never edits a video.
 */
export function BoardView({ data, custom, canEdit = false }: { data: BoardData; custom?: EntityCustom; canEdit?: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const mission = useMission();
  const [busy, setBusy] = useState<string | null>(null);

  async function ask(v: BoardVideo, kind: RequestKind) {
    setBusy(`${v.key}:${kind}`);
    try {
      const r = await fetch("/api/videos/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: v.key, kind }) });
      const d = (await r.json().catch(() => ({}))) as { error?: string; demo?: boolean; created?: boolean; request?: { via: string } };
      if (!r.ok) return toast(d.error ?? "صار خطأ", "error");
      if (d.demo) return toast("بالوضع التجريبي ما انبعت شي لحدا", "info");
      if (d.created === false) toast("في طلب مفتوح من هالنوع على هالفيديو", "info");
      else if (d.request?.via === "none") toast("انحفظ بالمهام. لسا ما في قناة لهيرمز، وهو بيسحبه من الطابور.", "info");
      else mission({ title: "انطلب ✓", detail: `${REQUEST_KIND_AR[kind]} — صار عند هيرمز` });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function move(r: BoardRequest, to: RequestStatus) {
    const res = await fetch(`/api/video-requests/${r.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ to }) });
    const d = (await res.json().catch(() => ({}))) as { error?: string; demo?: boolean };
    if (!res.ok) return toast(d.error ?? "صار خطأ", "error");
    if (d.demo) return toast("بالوضع التجريبي ما انغيّر شي", "info");
    router.refresh();
  }

  const t = data.totals;
  return (
    <div className="space-y-5">

      <div data-tour="totals" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["بالبنك", t.videos],
          ["رابحين", t.winners],
          ["تعبانين", t.tired],
          ["طلبات مفتوحة", t.openRequests],
        ].map(([label, n]) => (
          <div key={label as string} className="rounded-xl border border-border bg-surface-1 px-3 py-2">
            <p className="text-xs text-fg-muted">{label}</p>
            <p className="text-xl font-bold tabular-nums text-fg">{n}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2 rounded-xl border border-border bg-surface-1 p-3">
        <MinSpend typed={data.typedMinSpend} />
        <p className="text-xs leading-5 text-fg-muted">
          {data.hermes.api || data.hermes.chat
            ? `الطلبات بتوصل لهيرمز ${data.hermes.api ? "بالـ API" : "بتيليجرام"}، وبتنزل كبطاقة بالمهام.`
            : "لسا ما في قناة لهيرمز (HERMES_BASE_URL + HERMES_TOKEN، أو TELEGRAM_HERMES_CHAT_ID). الطلب بينحفظ بالمهام، وهيرمز بيسحبه من الطابور."}
        </p>
      </div>

      {data.products.length ? (
        <CustomCtx.Provider value={{ custom, canEdit }}>
          <div className="space-y-4">
            {data.products.map((p) => (
              <ProductBoard key={p.code} p={p} busy={busy} ask={ask} move={move} />
            ))}
          </div>
        </CustomCtx.Provider>
      ) : (
        <EmptyState title="لسا ما في فيديوهات" hint="لما يبعت Claude بنك الفيديوهات (push_videos) أو يستلم النظام من درايف، بتطلع هون لكل منتج." art="empty-creatives" />
      )}

      <Section title="شو بتعمل الأزرار؟" hint="كل زر بيعمل طلب واحد، مش أكتر" tour="help">
        <Panel className="space-y-1 text-sm leading-6 text-fg-muted">
          <p>كل طلب بيوصل لهيرمز ومعه رقم الـ JOB وملف السيناريو وأرقام الفيديو (من الكود)، وبينزل كبطاقة بالمهام. حالته: طلب ← عند هيرمز ← جاهز ← مرفوع.</p>
          <p>ما في تعديل على أي فيديو، وما في تصنيف سياسات هون. «تعب» بيعلّم الفيديو تعبان بالبنك بس.</p>
        </Panel>
      </Section>
    </div>
  );
}
