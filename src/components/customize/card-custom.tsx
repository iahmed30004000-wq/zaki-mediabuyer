"use client";

import { useState } from "react";
import { ChevronDown, Save } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import type { ButtonCfgT, Entity, FieldCfgT } from "@/core/customize";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/call";
import { FieldChips, FieldInput, RunButton, type CardValues } from "./card-fields";

/** What a screen needs to draw the owner's fields and buttons on one kind of card (the task board has its own sheet for it). */
export interface EntityCustom {
  fields: FieldCfgT[];
  buttons: ButtonCfgT[];
  /** card id → field id → value */
  values: Record<string, CardValues>;
}

/**
 * The owner's fields and buttons on a card that has no sheet of its own (a video, a workflow): the filled fields as chips, the
 * buttons that ask Claude to run a workflow on THIS card, and — for whoever may edit — a small box to type the values in. Nothing
 * shows when the owner added nothing for this kind of card.
 */
export function CardCustom({ entity, entityId, custom, canEdit }: { entity: Entity; entityId: string; custom?: EntityCustom; canEdit: boolean }) {
  const { toast } = useToast();
  const fields = custom?.fields ?? [];
  const buttons = custom?.buttons ?? [];
  const [values, setValues] = useState<CardValues>(custom?.values[entityId] ?? {});
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (!fields.length && !buttons.length) return null;

  const stored = (f: FieldCfgT) => String(values[f.id] ?? "");
  const current = (f: FieldCfgT) => draft[f.id] ?? stored(f);
  const changed = fields.filter((f) => current(f) !== stored(f));

  async function save() {
    setBusy(true);
    // only what changed is sent; an emptied field clears
    const body = { entity, entityId, values: Object.fromEntries(changed.map((f) => [f.id, current(f) === "" ? null : current(f)])) };
    const r = await safeFetch("/api/ui/values", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const d = (await r?.json().catch(() => ({}))) as { error?: string; demo?: boolean; values?: CardValues };
    setBusy(false);
    if (!r || !r.ok) return toast(d?.error ?? "ما انحفظ، جرّب كمان مرة", "error");
    if (d.demo) return toast("بالوضع التجريبي ما بينحفظ شي", "info");
    setValues(d.values ?? {});
    setDraft({});
    toast("انحفظ ✓", "success");
  }

  return (
    <div className="space-y-2" data-tour="card-custom">
      <div className="flex flex-wrap items-center gap-1.5">
        <FieldChips fields={fields} values={values} />
        {canEdit ? buttons.map((b) => <RunButton key={b.id} button={b} entity={entity} entityId={entityId} />) : null}
        {canEdit && fields.length ? (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex min-h-10 max-md:min-h-[44px] items-center gap-1 rounded-md px-1.5 text-xs font-medium text-fg-muted hover:text-fg">
            حقولي
            <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
          </button>
        ) : null}
      </div>
      {open && canEdit ? (
        <div className="space-y-2 rounded-lg border border-border bg-surface-2/40 p-2">
          {fields.map((f) => (
            <label key={f.id} className="block text-sm text-fg-muted">
              {f.label}
              <FieldInput field={f} value={current(f)} disabled={busy} onChange={(v) => setDraft((m) => ({ ...m, [f.id]: v }))} />
            </label>
          ))}
          <button type="button" disabled={busy || !changed.length} onClick={() => void save()} className="inline-flex min-h-10 max-md:min-h-[44px] items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-50">
            <Save className="size-3.5" />
            احفظ
          </button>
        </div>
      ) : null}
    </div>
  );
}
