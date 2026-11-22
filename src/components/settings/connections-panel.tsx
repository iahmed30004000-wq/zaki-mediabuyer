"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { Panel } from "@/components/mb/section";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import type { ConnectionsView, FieldView, RowView } from "@/server/connections";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/call";

const when = (iso: string) => new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

async function call(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const r = await safeFetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: r.ok, data };
}
const errorOf = (d: Record<string, unknown>) => (typeof d.error === "string" ? d.error : "صار خطأ، جرّب كمان مرة");

/** What is true of one value, in one line: «محفوظ ✓ · آخر تغيير … بواسطة … · آخر 4 خانات ••••1234», «من Coolify ✓» or «ناقص». The value itself is never here. */
function stateLine(f: FieldView): { tone: "ok" | "muted"; parts: string[] } {
  if (f.source === "app") {
    const parts = ["محفوظ ✓"];
    if (f.updatedAt) parts.push(`آخر تغيير \u2066${when(f.updatedAt)}\u2069${f.updatedBy ? ` بواسطة ${f.updatedBy}` : ""}`);
    if (f.last4) parts.push(`آخر 4 خانات \u2066••••${f.last4}\u2069`);
    return { tone: "ok", parts };
  }
  if (f.source === "env") return { tone: "ok", parts: ["من Coolify ✓"] };
  return { tone: "muted", parts: ["ناقص"] };
}

function FieldEditor({ f, locked, onChanged }: { f: FieldView; locked: boolean; onChanged: () => Promise<void> }) {
  const { toast } = useToast();
  const secret = f.kind === "secret" || f.kind === "file";
  const [value, setValue] = useState(secret ? "" : f.value ?? "");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const line = stateLine(f);
  const canClear = f.source === "app";

  useEffect(() => {
    if (!secret) setValue(f.value ?? "");
  }, [f.value, secret]);

  async function save(raw: string) {
    setBusy(true);
    try {
      const r = await call(`/api/connections/field/${encodeURIComponent(f.name)}`, "PUT", { value: raw });
      if (!r.ok) return toast(errorOf(r.data), "error");
      if (secret) setValue("");
      toast("انحفظ ✓", "success");
      await onChanged();
    } finally {
      setBusy(false);
    }
  }
  async function clear() {
    setBusy(true);
    try {
      const r = await call(`/api/connections/field/${encodeURIComponent(f.name)}`, "DELETE");
      if (!r.ok) return toast(errorOf(r.data), "error");
      toast("انمسح", "success");
      await onChanged();
    } finally {
      setBusy(false);
    }
  }
  async function pick(file: File) {
    if (file.size > 25_000) return toast("الملف كبير — لازم يكون ملف الـService Account نفسه", "error");
    await save(await file.text());
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="space-y-1.5">
      <Field label={f.label} hint={f.hint}>
        {f.kind === "file" ? (
          <div>
            <Input ref={fileRef} type="file" accept=".json,application/json" className="hidden" disabled={busy || locked} onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])} />
            <Button variant="secondary" size="md" loading={busy} disabled={locked} onClick={() => fileRef.current?.click()}>
              {f.source === "app" ? "ارفع ملف جديد" : "ارفع الملف"}
            </Button>
          </div>
        ) : (
          <Input
            dir="ltr"
            type={secret ? "password" : "text"}
            autoComplete="off"
            spellCheck={false}
            value={value}
            placeholder={secret ? (f.source === "none" ? "الصق المفتاح" : "اكتب مفتاح جديد ليبدّل الحالي") : f.example}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy || locked}
          />
        )}
      </Field>
      <p className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm", line.tone === "ok" ? "text-ok" : "text-fg-muted")}>
        {line.tone === "ok" ? <CheckCircle2 className="size-3.5 shrink-0" aria-hidden /> : <CircleAlert className="size-3.5 shrink-0" aria-hidden />}
        {line.parts.map((t, i) => (
          <span key={i} className="whitespace-nowrap">
            {i > 0 ? "· " : ""}
            {t}
          </span>
        ))}
      </p>
      {f.kind !== "file" || canClear ? (
        <div className="flex flex-wrap gap-2">
          {f.kind !== "file" ? (
            <Button size="sm" loading={busy} disabled={locked || !value.trim() || (!secret && value === (f.value ?? ""))} onClick={() => void save(value)}>
              احفظ
            </Button>
          ) : null}
          {canClear ? (
            <Button size="sm" variant="ghost" disabled={busy} confirm="بدك تمسحها؟" onClick={() => void clear()}>
              امسح
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RowCard({ row, masterKey, onChanged }: { row: RowView; masterKey: boolean; onChanged: () => Promise<void> }) {
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pulling, setPulling] = useState(false);

  /** «اسحب هلق» (the OMS only): one pull now — the orders, then the truth — instead of waiting for the next hour */
  async function pullNow() {
    setPulling(true);
    setResult(null);
    try {
      const r = await call(`/api/connections/row/${row.key}/sync`, "POST");
      if (!r.ok) return setResult({ ok: false, message: errorOf(r.data) });
      setResult({ ok: true, message: String(r.data.sentence ?? "انسحب") });
    } finally {
      setPulling(false);
    }
  }

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      const r = await call(`/api/connections/row/${row.key}/test`, "POST");
      if (!r.ok) return toast(errorOf(r.data), "error");
      setResult({ ok: r.data.ok === true, message: String(r.data.message ?? "") });
    } finally {
      setTesting(false);
    }
  }

  const secretLocked = !masterKey;
  return (
    <Panel className="space-y-3" id={`row-${row.key}`}>
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-base font-bold text-fg">{row.title}</p>
        {row.kind !== "info" ? <Pill tone={row.linked ? "ok" : "warn"}>{row.linked ? "مربوط" : "ناقص"}</Pill> : null}
      </div>
      {row.note ? <p className="text-sm leading-5 text-fg-muted">{row.note}</p> : null}
      {row.fields.map((f) => (
        <FieldEditor key={f.name} f={f} locked={(f.kind === "secret" || f.kind === "file") && secretLocked} onChanged={onChanged} />
      ))}
      {row.testable ? (
        <div className="space-y-1.5 border-t border-border pt-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" loading={testing} onClick={() => void test()}>
              اختبر الربط
            </Button>
            {row.key === "oms" && row.linked ? (
              <Button size="sm" variant="secondary" loading={pulling} onClick={() => void pullNow()}>
                اسحب هلق
              </Button>
            ) : null}
          </div>
          {result ? (
            <p role="status" className={cn("flex items-start gap-1.5 text-base", result.ok ? "text-ok" : "text-danger")}>
              {result.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />}
              <span>{result.ok ? "✓ " : "✗ "}{result.message}</span>
            </p>
          ) : (
            <p className="text-sm text-fg-muted">مكالمة وحدة حقيقية للقراءة بس — ما بتغيّر ولا بتبعت شي.</p>
          )}
        </div>
      ) : null}
    </Panel>
  );
}

/**
 * «الربط»: one card per connection. A key is typed or uploaded here once and never comes back (write-only box, «محفوظ ✓ · آخر 4 خانات»); an address or folder id is
 * a normal box; the token of one of our own systems is made on that system's «توكنات الأنظمة» page and pasted the same way. «اختبر الربط» makes one real read-only call and says ✓ or the exact reason. Owner only.
 */
export function ConnectionsPanel() {
  const [view, setView] = useState<ConnectionsView | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const r = await safeFetch("/api/connections", { cache: "no-store" });
    if (!r.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setView((await r.json()) as ConnectionsView);
  }, []);

  useEffect(() => {
    load().catch(() => setFailed(true));
  }, [load]);

  if (failed) return <p className="text-sm text-danger">ما قدرت أجيب سطور الربط — حدّث الصفحة.</p>;
  if (!view) return <p className="text-sm text-fg-muted">…</p>;
  return (
    <div className="space-y-3">
      {!view.masterKey ? (
        <Panel className="space-y-1 border-warn/40">
          <p className="text-sm font-semibold text-warn">مفتاح التشفير ناقص</p>
          <p className="text-sm leading-5 text-fg-muted">
            بدّك تحط <code dir="ltr" className="rounded bg-surface-2 px-1.5 py-0.5 text-fg">SECRETS_MASTER_KEY</code> بـ Coolify مرة وحدة (32 بايت base64 أو 64 خانة hex) وتعيد التشغيل. لحد هيك الأسرار ما بتنحفظ من الموقع، والعناوين والمعرّفات بتنحفظ عادي، ومفاتيح Coolify بتضل شغّالة.
          </p>
        </Panel>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        {view.rows
          .filter((r) => r.key !== "assistant")
          .map((r) => (
            <RowCard key={r.key} row={r} masterKey={view.masterKey} onChanged={load} />
          ))}
      </div>
    </div>
  );
}
