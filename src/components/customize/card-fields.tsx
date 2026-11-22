"use client";

import { Input, Select } from "@/components/ui/input";
import { usePeople } from "@/components/shell/people-context";
import { valueText, type FieldCfgT } from "@/core/customize";
import { cn } from "@/lib/utils";

export type CardValues = Record<string, string | number>;

/** Draws one field's input by its type — the same few inputs for every card of the team's tasks. A value is kept as text here; the server checks it against the field. */
export function FieldInput({ field, value, onChange, disabled }: { field: FieldCfgT; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const people = usePeople();
  const common = { disabled, "aria-label": field.label };
  switch (field.type) {
    case "select":
      return (
        <Select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          {value && !(field.options ?? []).includes(value) ? <option value={value}>{value}</option> : null}
        </Select>
      );
    case "person":
      return (
        <Select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {people.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </Select>
      );
    case "date":
      return <Input {...common} type="date" dir="ltr" value={value} onChange={(e) => onChange(e.target.value)} />;
    case "number":
      return <Input {...common} type="text" inputMode="decimal" dir="ltr" value={value} onChange={(e) => onChange(e.target.value)} />;
    case "link":
      return <Input {...common} type="url" inputMode="url" dir="ltr" placeholder="https://…" value={value} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <Input {...common} type="text" dir="auto" maxLength={300} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
}

const safeHref = (v: string) => (v.startsWith("https://") || (v.startsWith("/") && !v.startsWith("//")) ? v : undefined);

/** The fields that have a value, as small chips on a card (a link opens). */
export function FieldChips({ fields, values }: { fields: FieldCfgT[]; values?: CardValues }) {
  const shown = fields.filter((f) => f.onCard !== false && values?.[f.id] !== undefined && values[f.id] !== "");
  if (!shown.length) return null;
  const chip = "inline-flex max-w-full items-center gap-0.5 truncate rounded-md border border-border bg-surface-1 px-1.5 py-0.5 text-sm text-fg";
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
