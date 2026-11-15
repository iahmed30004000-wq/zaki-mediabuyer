"use client";

import { useState } from "react";
import { Copy, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DATA_SOURCES, EXECUTORS, EXECUTOR_AR, NODE_TYPES, PERMISSIONS, PERMISSION_AR, type DataSource, type Executor, type Permission, type WfGraph, type WfNode } from "@/core/workflow";
import { TYPE_AR, connect, setPredecessor } from "@/core/workflow-edit";
import { tryPrompt } from "@/core/workflow-replay";
import { cn } from "@/lib/utils";
import { PermBadge } from "../badges";

const field = "min-h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm text-fg placeholder:text-fg-muted/70 disabled:opacity-60";
const SOURCE_AR: Record<DataSource, string> = { api: "API", mcp: "Claude (MCP)", manual: "يدوي" };
const PEOPLE = ["owner", "abdullah", "hassan", "laith", "mohammad", "muse", "hermes", "claude"];

function Row({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold text-fg">{label}</span>
      {children}
      {error ? <span className="block text-xs text-danger">{error}</span> : hint ? <span className="block text-xs leading-5 text-fg-muted">{hint}</span> : null}
    </label>
  );
}

/** A text field that keeps what is typed and tells the drawing when the person leaves it — one undo step per edit, not per letter. */
function Text({ value, onCommit, multiline, rows = 4, placeholder, disabled, dir, inputMode }: { value: string; onCommit: (v: string) => string | null; multiline?: boolean; rows?: number; placeholder?: string; disabled?: boolean; dir?: "rtl" | "ltr"; inputMode?: "numeric" }) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    if (text === value) return setError(null);
    const e = onCommit(text);
    setError(e);
    if (e) setText(value);
  };
  const common = { value: text, disabled, placeholder, dir: dir ?? ("auto" as const), onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText(e.target.value), onBlur: commit, className: cn(field, error && "border-danger") };
  return (
    <>
      {multiline ? <textarea {...common} rows={rows} className={cn(common.className, "py-2 leading-6")} /> : <input {...common} inputMode={inputMode} />}
      {error ? <span className="block text-xs text-danger">{error}</span> : null}
    </>
  );
}

/** «جرّب التعليمات»: the step's words with sample values in the {{variables}} — what is still missing, and what is refused. Nothing is sent anywhere. */
function TryPrompt({ prompt }: { prompt: string }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const t = tryPrompt(prompt, values);
  return (
    <details className="rounded-lg border border-border bg-surface-2/50 p-2 text-xs">
      <summary className="min-h-8 cursor-pointer select-none py-1.5 font-medium text-fg">جرّب التعليمات{t.vars.length ? ` (${t.vars.length} متغيّر)` : ""}</summary>
      <div className="space-y-2 pt-1">
        {t.vars.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {t.vars.map((v) => (
              <label key={v} className="block space-y-1">
                <span dir="ltr" className="block text-start font-mono text-[11px] text-fg-muted">{`{{${v}}}`}</span>
                <input value={values[v] ?? ""} dir="auto" maxLength={200} onChange={(e) => setValues((x) => ({ ...x, [v]: e.target.value }))} placeholder="قيمة تجريبية" className="min-h-9 w-full rounded-lg border border-border bg-surface-1 px-2 text-sm text-fg" />
              </label>
            ))}
          </div>
        ) : (
          <p className="text-fg-muted">ما فيها متغيّرات — هيك بتنبعت متل ما هي.</p>
        )}
        <pre dir="auto" aria-label="التعليمات بعد تعبئة المتغيّرات" className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-1 p-2 font-sans text-xs leading-6 text-fg">{t.text}</pre>
        {t.missing.length ? <p className="text-warn">لسا ناقص: {t.missing.join("، ")} — بتضل {"{{…}}"} إذا ما انعبّت وقت التشغيل.</p> : t.vars.length ? <p className="text-ok">كل المتغيّرات معبّاية.</p> : null}
        {t.refused.map((r) => <p key={r.name} className="text-danger">{r.name}: {r.why}</p>)}
        <p className="text-fg-muted">{t.length} حرف من 8000. بس معاينة نص — ما بينبعت لأي موديل.</p>
      </div>
    </details>
  );
}

/**
 * A step's card: who does it, how risky it is, what it does, where the result goes, what happens when it fails — and how it
 * is joined to the others (so a phone, where a line is hard to drag, can still wire a step). Every field commits when you leave
 * it; a refusal is said under the field. `onChange` answers with the refusal, or null.
 */
export function NodeForm({
  node,
  graph,
  readOnly,
  onChange,
  onDuplicate,
  onRemove,
  onAddAfter,
  onGraph,
}: {
  node: WfNode;
  graph: WfGraph;
  readOnly?: boolean;
  onChange: (patch: Partial<WfNode>) => string | null;
  onDuplicate: () => void;
  onRemove: () => void;
  /** a new step right after this one */
  onAddAfter: () => void;
  /** a change to the lines (not to the step): the drawing, or the refusal in words */
  onGraph: (g: WfGraph) => void;
}) {
  const [refusal, setRefusal] = useState<string | null>(null);
  const others = graph.nodes.filter((n) => n.id !== node.id);
  const ins = graph.edges.filter((e) => e.to === node.id);
  const outs = graph.edges.filter((e) => e.from === node.id);
  const nameOf = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  const set = (patch: Partial<WfNode>) => setRefusal(onChange(patch));
  const num = (k: "timeoutS" | "retries") => (v: string) => {
    if (v.trim() === "") return onChange({ [k]: undefined });
    const n = Number(v);
    return Number.isFinite(n) ? onChange({ [k]: Math.trunc(n) }) : "رقم بس";
  };

  return (
    <div className="space-y-4">
      {refusal ? <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 p-2 text-xs text-danger">{refusal}</p> : null}

      <Row label="الاسم">
        <Text value={node.label} disabled={readOnly} onCommit={(v) => onChange({ label: v })} />
      </Row>

      <div className="grid grid-cols-2 gap-3">
        <Row label="النوع">
          <select value={node.type} disabled={readOnly} onChange={(e) => set({ type: e.target.value as WfNode["type"] })} className={field}>
            {NODE_TYPES.map((t) => (
              <option key={t} value={t}>{TYPE_AR[t]}</option>
            ))}
          </select>
        </Row>
        <Row label="المنفّذ">
          <select value={node.executor ?? ""} disabled={readOnly} onChange={(e) => set({ executor: (e.target.value || undefined) as Executor | undefined })} className={field}>
            <option value="">—</option>
            {EXECUTORS.map((x) => (
              <option key={x} value={x}>{EXECUTOR_AR[x]}</option>
            ))}
          </select>
        </Row>
      </div>

      {node.executor === "n8n" || node.executor === "http" ? (
        <Row label={node.executor === "n8n" ? "الـ webhook (الاسم بس)" : "رابط https"} hint="الموقع بينفّذ هالخطوة بس إذا كانت خضراء والهدف بقائمتك المسموحة بإعدادات السيرفر (N8N_ALLOWED_PATHS · STEP_HTTP_ALLOW). غير هيك بتنزل لطابور التسليم.">
          <Text value={node.target ?? ""} dir="ltr" disabled={readOnly} onCommit={(v) => onChange({ target: v })} />
        </Row>
      ) : null}

      <Row label="المسؤول (شخص أو وكيل)" hint="مين بيتابعها لو وقفت">
        <>
          <input list="wf-people" defaultValue={node.assignee ?? ""} key={`a-${node.id}`} disabled={readOnly} dir="auto" onBlur={(e) => { if (e.target.value !== (node.assignee ?? "")) set({ assignee: e.target.value }); }} className={field} />
          <datalist id="wf-people">
            {PEOPLE.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </>
      </Row>

      <fieldset className="space-y-1.5">
        <legend className="text-xs font-semibold text-fg">الصلاحية</legend>
        <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="الصلاحية">
          {PERMISSIONS.map((p: Permission) => (
            <button key={p} type="button" disabled={readOnly} aria-pressed={node.permission === p} onClick={() => set({ permission: p })} className={cn("flex min-h-10 items-center justify-center rounded-lg border text-xs", node.permission === p ? "border-accent bg-accent/5" : "border-border")}>
              <PermBadge permission={p} />
            </button>
          ))}
        </div>
        <p className="text-xs leading-5 text-fg-muted">{node.permission ? PERMISSION_AR[node.permission] : "اختار صلاحية الخطوة"}</p>
        {node.permission === "black" ? <p className="rounded-lg border border-danger/30 bg-danger/5 p-2 text-xs text-danger">ممنوع على الوكلاء: دفع · حذف · تسجيل خروج · CAPTCHA · توكنات · ورك فلو «ورك فلو n8n الرئيسي». الأحسن تعطّلها.</p> : null}
      </fieldset>

      <Row label="التعليمات" hint="اكتب شو بدها تعمل. المتغيّرات مثل {{product}} بتنملى وقت التشغيل. ولا أرقام زبائن ولا مفاتيح.">
        <Text value={node.prompt ?? ""} multiline rows={5} disabled={readOnly} onCommit={(v) => onChange({ prompt: v })} />
      </Row>
      {node.prompt ? <TryPrompt key={node.id} prompt={node.prompt} /> : null}

      <div className="grid grid-cols-2 gap-3">
        <Row label="الدخل">
          <Text value={node.inputs ?? ""} disabled={readOnly} onCommit={(v) => onChange({ inputs: v })} />
        </Row>
        <Row label="الخرج">
          <Text value={node.outputs ?? ""} disabled={readOnly} onCommit={(v) => onChange({ outputs: v })} />
        </Row>
      </div>

      <Row label="وين بتوصل النتيجة، وعلى شو" hint="مثلاً: «اليوم + تيليجرام» أو «الميديا باير ← المهام»">
        <Text value={node.destination ?? ""} disabled={readOnly} onCommit={(v) => onChange({ destination: v })} />
      </Row>

      <div className="grid grid-cols-2 gap-3">
        <Row label="المهلة (ثانية)">
          <Text value={node.timeoutS === undefined ? "" : String(node.timeoutS)} inputMode="numeric" dir="ltr" disabled={readOnly} onCommit={num("timeoutS")} />
        </Row>
        <Row label="إعادة المحاولة">
          <Text value={node.retries === undefined ? "" : String(node.retries)} inputMode="numeric" dir="ltr" disabled={readOnly} onCommit={num("retries")} />
        </Row>
      </div>
      <Row label="إذا فشلت" hint="شو بيصير لو وقفت أو فشلت. بدون هيك بتنزل لطابور التسليم وبيكمّلها Claude.">
        <Text value={node.fallback ?? ""} disabled={readOnly} onCommit={(v) => onChange({ fallback: v })} />
      </Row>

      <Row label="الأرقام جاية من">
        <select value={node.dataSource ?? ""} disabled={readOnly} onChange={(e) => set({ dataSource: (e.target.value || undefined) as DataSource | undefined })} className={field}>
          <option value="">—</option>
          {DATA_SOURCES.map((s) => (
            <option key={s} value={s}>{SOURCE_AR[s]}</option>
          ))}
        </select>
      </Row>

      <section className="space-y-3 rounded-xl border border-border p-3" aria-label="التوصيل">
        <h3 className="text-xs font-bold text-fg">التوصيل</h3>
        {node.type === "trigger" ? (
          <p className="text-xs text-fg-muted">البداية ما بيدخل عليها شي.</p>
        ) : ins.length <= 1 ? (
          <Row label="بتيجي بعد">
            <select
              disabled={readOnly}
              value={ins[0]?.from ?? ""}
              onChange={(e) => {
                const r = setPredecessor(graph, node.id, e.target.value || null);
                if (r.ok) {
                  setRefusal(null);
                  onGraph(r.graph);
                } else setRefusal(r.error);
              }}
              className={field}
            >
              <option value="">— ما إلها خطوة قبلها</option>
              {others.map((n) => (
                <option key={n.id} value={n.id} disabled={!setPredecessor(graph, node.id, n.id).ok && ins[0]?.from !== n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </Row>
        ) : (
          <p className="text-xs leading-5 text-fg-muted">بتيجي بعد {ins.length} خطوات: {ins.map((e) => nameOf(e.from)).join("، ")} — عدّلها من اللوحة.</p>
        )}
        <div className="space-y-1.5">
          <span className="text-xs font-semibold text-fg">بتوصّل لـ</span>
          {outs.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {outs.map((e) => (
                <li key={e.to} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 ps-2.5 pe-1 text-xs text-fg">
                  {e.label ? <span className="text-fg-muted">{e.label}:</span> : null}
                  {nameOf(e.to)}
                  {readOnly ? null : (
                    <button type="button" aria-label={`شيل الوصلة لـ ${nameOf(e.to)}`} onClick={() => onGraph({ ...graph, edges: graph.edges.filter((x) => !(x.from === e.from && x.to === e.to)) })} className="inline-flex size-6 items-center justify-center rounded-full text-fg-muted hover:bg-surface-1 hover:text-fg">
                      <X className="size-3" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-fg-muted">ما بتوصّل لشي.</p>
          )}
          {readOnly ? null : (
            <select
              aria-label="وصّلها بخطوة"
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                const r = connect(graph, node.id, e.target.value);
                if (r.ok) {
                  setRefusal(null);
                  onGraph(r.graph);
                } else setRefusal(r.error);
              }}
              className={field}
            >
              <option value="">＋ وصّلها بخطوة…</option>
              {others.map((n) => (
                <option key={n.id} value={n.id} disabled={!connect(graph, node.id, n.id).ok}>
                  {n.label}
                </option>
              ))}
            </select>
          )}
          {node.type === "condition" ? <p className="text-xs leading-5 text-fg-muted">الشرط لازم يتفرّع لمسارين. سمّي كل وصلة (نعم / لا) من اللوحة: اضغط على الخط.</p> : null}
        </div>
      </section>

      <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm text-fg">
        <input type="checkbox" checked={!!node.disabled} disabled={readOnly} onChange={(e) => set({ disabled: e.target.checked ? true : undefined })} className="size-4 accent-[var(--accent,#2563eb)]" />
        معطّلة (بتنتخطّى وقت التشغيل)
      </label>

      <p dir="ltr" className="text-start font-mono text-[11px] text-fg-muted">id: {node.id}</p>

      {readOnly ? null : (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button type="button" variant="secondary" size="sm" className="min-h-10" onClick={onAddAfter}>
            <Plus className="size-4" /> ضيف خطوة بعدها
          </Button>
          <Button type="button" variant="secondary" size="sm" className="min-h-10" onClick={onDuplicate}>
            <Copy className="size-4" /> انسخها
          </Button>
          <Button type="button" variant="ghost" size="sm" className="min-h-10 text-danger hover:text-danger" onClick={onRemove}>
            <Trash2 className="size-4" /> احذفها
          </Button>
        </div>
      )}
    </div>
  );
}
