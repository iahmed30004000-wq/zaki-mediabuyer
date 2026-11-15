"use client";

import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { PEOPLE } from "@/core/tasks";
import { valueText, type ButtonCfgT, type Entity, type FieldCfgT } from "@/core/customize";
import { cn } from "@/lib/utils";

export type CardValues = Record<string, string | number>;

const control = "min-h-10 w-full rounded-lg border border-border bg-surface-1 px-2 text-sm text-fg disabled:opacity-60";

/** Draws one field's input by its type — the same few inputs for every card the owner puts fields on. A value is kept as text here; the server checks it against the field. */
export function FieldInput({ field, value, onChange, disabled }: { field: FieldCfgT; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const common = { disabled, "aria-label": field.label };
  switch (field.type) {
    case "select":
      return (
        <select {...common} value={value} onChange={(e) => onChange(e.target.value)} className={control}>
          <option value="">—</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          {value && !(field.options ?? []).includes(value) ? <option value={value}>{value}</option> : null}
        </select>
      );
    case "person":
      return (
        <select {...common} value={value} onChange={(e) => onChange(e.target.value)} className={control}>
          <option value="">—</option>
          {PEOPLE.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      );
    case "date":
      return <input {...common} type="date" dir="ltr" value={value} onChange={(e) => onChange(e.target.value)} className={control} />;
    case "number":
      return <input {...common} type="text" inputMode="decimal" dir="ltr" value={value} onChange={(e) => onChange(e.target.value)} className={control} />;
    case "link":
      return <input {...common} type="url" inputMode="url" dir="ltr" placeholder="https://…" value={value} onChange={(e) => onChange(e.target.value)} className={control} />;
    default:
      return <input {...common} type="text" dir="auto" maxLength={300} value={value} onChange={(e) => onChange(e.target.value)} className={control} />;
  }
}

const safeHref = (v: string) => (v.startsWith("https://") || (v.startsWith("/") && !v.startsWith("//")) ? v : undefined);

/** The fields that have a value, as small chips on a card (a link opens). */
export function FieldChips({ fields, values }: { fields: FieldCfgT[]; values?: CardValues }) {
  const shown = fields.filter((f) => f.onCard !== false && values?.[f.id] !== undefined && values[f.id] !== "");
  if (!shown.length) return null;
  const chip = "inline-flex max-w-full items-center gap-0.5 truncate rounded-md border border-border bg-surface-1 px-1.5 py-0.5 text-[11px] text-fg";
  return (
    <>
      {shown.map((f) => {
        const v = values![f.id]!;
        const text = valueText(f, v);
        const href = f.type === "link" ? safeHref(String(v)) : undefined;
        return href ? (
          <a key={f.id} href={href} target={href.startsWith("https://") ? "_blank" : undefined} rel="noreferrer noopener" title={f.label} className={cn(chip, "text-accent hover:underline")}>
            <span className="text-fg-muted">{f.label}:</span> <span dir="ltr">{text}</span>
          </a>
        ) : (
          <span key={f.id} title={f.label} className={chip}>
            <span className="text-fg-muted">{f.label}:</span> <span dir={f.type === "number" || f.type === "date" ? "ltr" : "auto"}>{text}</span>
          </span>
        );
      })}
    </>
  );
}

/**
 * A button the owner put on a card. Pressed, it asks Claude to run its workflow on THIS card (the queue of handoffs — the same as
 * «شغّل هلق»); it asks «متأكد؟» first unless the owner turned that off. It spends nothing.
 */
export function RunButton({ button, entityId, entity = "task", large }: { button: ButtonCfgT; entityId: string; entity?: Entity; large?: boolean }) {
  const { toast } = useToast();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  async function go() {
    setBusy(true);
    setArmed(false);
    const r = await fetch("/api/ui/button", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ buttonId: button.id, entity, entityId }) }).catch(() => null);
    const d = (await r?.json().catch(() => ({}))) as { error?: string; demo?: boolean; created?: boolean };
    setBusy(false);
    if (!r || !r.ok) return toast(d?.error ?? "صار خطأ، جرّب كمان مرة", "error");
    if (d.demo) return toast("بالوضع التجريبي ما بيشتغل الورك فلو", "info");
    toast(d.created ? "انطلب من Claude ✓ — بتشوفه بـ «الورك فلو»" : "في طلب مفتوح لهالبطاقة من قبل", d.created ? "success" : "info");
  }

  const size = large ? "min-h-10 px-3 text-sm" : "min-h-8 px-2 text-[11px]";
  if (armed) {
    return (
      <span className={cn("inline-flex items-center gap-2 rounded-md border border-accent/50 bg-accent/5", size)}>
        <span className="text-fg">متأكد؟</span>
        <button type="button" onClick={() => void go()} className="font-semibold text-accent">
          أيوه
        </button>
        <button type="button" onClick={() => setArmed(false)} className="text-fg-muted">
          لا
        </button>
      </span>
    );
  }
  return (
    <button type="button" disabled={busy} onClick={() => (button.confirm === false ? void go() : setArmed(true))} className={cn("inline-flex items-center gap-1 rounded-md border border-accent/40 font-medium text-accent hover:bg-accent/5 disabled:opacity-50", size)}>
      <Play className={large ? "size-4" : "size-3"} />
      {button.label}
    </button>
  );
}
