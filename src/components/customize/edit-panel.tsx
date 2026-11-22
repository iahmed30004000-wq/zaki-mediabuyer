"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Combine, Eye, EyeOff, GripVertical, LayoutList, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ChoiceTile } from "@/components/ui/choice-tile";
import { IconButton } from "@/components/ui/icon-button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { BOARD_TEMPLATES, FIELD_TYPES, FIELD_TYPE_AR, type FieldType, type UiOpShape } from "@/core/customize";
import { useShell, type PanelTab } from "@/components/shell/shell-context";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/call";
import type { PanelData } from "@/server/customize";

const TABS: { value: PanelTab; label: string }[] = [
  { value: "boards", label: "اللوحات" },
  { value: "fields", label: "الحقول" },
  { value: "trash", label: "المحذوفات" },
];

type Run = (op: UiOpShape) => Promise<boolean>;

// ───────────────────────────── small pieces ─────────────────────────────

/** A name that saves itself when you leave it (Enter), and goes back when you press Escape. */
function NameInput({ value, onSave, max = 40, disabled }: { value: string; onSave: (v: string) => void; max?: number; disabled?: boolean }) {
  const [v, setV] = useState(value);
  const saved = useRef(value);
  useEffect(() => {
    setV(value);
    saved.current = value;
  }, [value]);
  const commit = () => {
    const t = v.trim();
    if (!t || t === saved.current) return setV(saved.current);
    onSave(t);
  };
  return (
    <Input
      value={v}
      maxLength={max}
      disabled={disabled}
      dir="auto"
      aria-label="الاسم"
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setV(saved.current);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="min-w-0 flex-1 font-medium"
    />
  );
}

/**
 * A row of a list. With `drag` it can be picked up by its grip and dropped on another row of the same list (`list` keeps one
 * list from dropping on another): the dropped row takes the place of the one it lands on. The arrows beside it do the same by one
 * step — they are the way on a phone, where a finger cannot drag a row.
 */
function Row({ children, dim, drag }: { children: React.ReactNode; dim?: boolean; drag?: { list: string; id: string; onDrop: (from: string, onto: string) => void } }) {
  const [over, setOver] = useState(false);
  return (
    <li
      onDragOver={drag ? (e) => { if (e.dataTransfer.types.includes(`mb/${drag.list}`)) { e.preventDefault(); setOver(true); } } : undefined}
      onDragLeave={drag ? () => setOver(false) : undefined}
      onDrop={drag ? (e) => { e.preventDefault(); setOver(false); const from = e.dataTransfer.getData(`mb/${drag.list}`); if (from && from !== drag.id) drag.onDrop(from, drag.id); } : undefined}
      className={cn("space-y-2 rounded-xl border border-border bg-surface-1 p-2.5", dim && "opacity-60", over && "border-accent bg-accent/5")}
    >
      {drag ? (
        <span
          draggable
          role="img"
          aria-label="اسحب لتغيّر الترتيب"
          title="اسحب لتغيّر الترتيب"
          onDragStart={(e) => { e.dataTransfer.setData(`mb/${drag.list}`, drag.id); e.dataTransfer.effectAllowed = "move"; }}
          className="float-end hidden cursor-grab text-fg-muted active:cursor-grabbing sm:inline-flex"
        >
          <GripVertical className="size-4" />
        </span>
      ) : null}
      {children}
    </li>
  );
}

const Tag = ({ children, tone }: { children: React.ReactNode; tone?: "accent" }) => <span className={cn("rounded-md px-1.5 py-0.5 text-sm", tone === "accent" ? "bg-accent/10 text-accent" : "bg-surface-2 text-fg-muted")}>{children}</span>;

function More({ children }: { children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-base font-medium text-accent hover:underline">خيارات أكتر</summary>
      <div className="mt-2 space-y-2 border-t border-border pt-2">{children}</div>
    </details>
  );
}

/** «كل اللوحات» or a choice of boards. */
function ScopePicker({ boards, value, onChange }: { boards: { key: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-base text-fg-muted">بتظهر على</legend>
      <Checkbox label="كل اللوحات" checked={!value.length} onChange={() => onChange([])} />
      <div className="grid grid-cols-2 gap-x-3">
        {boards.map((b) => (
          <Checkbox key={b.key} label={b.label} checked={value.includes(b.key)} onChange={(e) => onChange(e.target.checked ? [...value, b.key] : value.filter((x) => x !== b.key))} />
        ))}
      </div>
    </fieldset>
  );
}

const optionLines = (text: string) => text.split(/\n|،|,/).map((x) => x.trim()).filter(Boolean);

// ───────────────────────────── suggestions ─────────────────────────────

function Suggestions({ data, run, busy }: { data: PanelData; run: Run; busy: boolean }) {
  if (!data.suggestions.length) return null;
  return (
    <details className="rounded-xl border border-warn/40 bg-warn/5 p-2.5" open>
      <summary className="cursor-pointer text-base font-semibold text-fg">اقتراحات دمج ({data.suggestions.length})</summary>
      <ul className="mt-2 space-y-2">
        {data.suggestions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 text-base leading-6 text-fg">{s.text}</span>
            {s.op ? (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(s.op!)}>
                <Combine className="size-3.5" />
                ادمجهم
              </Button>
            ) : s.href ? (
              <a href={s.href} className="text-base font-medium text-accent hover:underline">
                افتح
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

// ───────────────────────────── boards ─────────────────────────────

function BoardsTab({ data, run, busy }: { data: PanelData; run: Run; busy: boolean }) {
  const list = data.boards.filter((b) => !b.archived);
  const [template, setTemplate] = useState("blank");
  const [name, setName] = useState("");
  const [into, setInto] = useState<Record<string, string>>({});
  return (
    <div className="space-y-3">
      <p className="text-base leading-6 text-fg-muted">اللوحات هي تبويبات «مهام الفريق». دمج لوحتين بينقل مهامهم وحقولهم لوحدة وما بيخسّر ولا شي، وبترجّع الدمج من «المحذوفات».</p>
      <ul className="space-y-2">
        {list.map((b) => {
          const others = list.filter((x) => x.key !== b.key);
          return (
            <Row key={b.key} dim={b.hidden} drag={b.hidden ? undefined : { list: "boards", id: b.key, onDrop: (from, onto) => void run({ op: "board.drop", key: from, onto }) }}>
              <div className="flex items-center gap-1.5">
                <NameInput value={b.label} onSave={(v) => void run({ op: "board.rename", key: b.key, label: v })} disabled={busy} />
                <IconButton aria-label="فوق" disabled={busy || b.hidden} onClick={() => void run({ op: "board.move", key: b.key, dir: -1 })}>
                  <ArrowUp className="size-4" />
                </IconButton>
                <IconButton aria-label="تحت" disabled={busy || b.hidden} onClick={() => void run({ op: "board.move", key: b.key, dir: 1 })}>
                  <ArrowDown className="size-4" />
                </IconButton>
                <IconButton aria-label={b.hidden ? "اظهر التبويب" : "اخفي التبويب"} disabled={busy || b.locked} onClick={() => void run({ op: "board.hide", key: b.key, hidden: !b.hidden })}>
                  {b.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </IconButton>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Tag tone="accent">{b.tasks} مهمة</Tag>
                <Tag>{b.builtin ? "من النظام" : "عملتها إنت"}</Tag>
                {b.hidden ? <Tag>مخفية</Tag> : null}
                {b.locked ? <Tag>الرئيسية</Tag> : null}
              </div>
              {!b.locked ? (
                <More>
                  <div className="flex items-center gap-2">
                    <Select aria-label="ادمجها بـ" value={into[b.key] ?? ""} onChange={(e) => setInto((m) => ({ ...m, [b.key]: e.target.value }))}>
                      <option value="">ادمجها بلوحة…</option>
                      {others.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                    <Button size="sm" variant="secondary" disabled={busy || !into[b.key]} onClick={() => void run({ op: "board.merge", from: b.key, into: into[b.key]! })}>
                      ادمج
                    </Button>
                  </div>
                  {into[b.key] ? <p className="text-base text-fg-muted">رح تنتقل {b.tasks} مهمة لـ «{list.find((x) => x.key === into[b.key])?.label}» ومعها كل قيمها.</p> : null}
                  <Button size="sm" variant="ghost" disabled={busy || b.tasks > 0} onClick={() => void run({ op: "board.archive", key: b.key })}>
                    <Trash2 className="size-3.5" />
                    {b.tasks > 0 ? "عليها مهام — ادمجها أول" : "احذفها (بترجّعها من «المحذوفات»)"}
                  </Button>
                </More>
              ) : null}
            </Row>
          );
        })}
      </ul>

      <form
        className="space-y-2 rounded-xl border border-dashed border-border p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run({ op: "board.add", label: name, template })) setName("");
        }}
      >
        <p className="text-base font-semibold text-fg">＋ لوحة من قالب</p>
        <div role="group" aria-label="قالب اللوحة" className="grid gap-2">
          {BOARD_TEMPLATES.map((t) => (
            <ChoiceTile key={t.id} title={t.name} hint={t.about} pressed={template === t.id} onClick={() => setTemplate(t.id)} />
          ))}
        </div>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم اللوحة" aria-label="اسم اللوحة" maxLength={40} dir="auto" />
        <Button type="submit" disabled={busy || !name.trim()}>
          <Plus className="size-4" />
          اعملها
        </Button>
      </form>
    </div>
  );
}

// ───────────────────────────── fields ─────────────────────────────

function FieldsTab({ data, run, busy }: { data: PanelData; run: Run; busy: boolean }) {
  const list = data.fields.filter((f) => f.entity === "task" && !f.archivedAt);
  const boards = data.boards.filter((b) => !b.archived);
  const labelOf = (key: string) => boards.find((b) => b.key === key)?.label ?? key;
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [convert, setConvert] = useState<Record<string, { to: FieldType; options: string }>>({});
  const [options, setOptions] = useState("");
  const [scope, setScope] = useState<string[]>([]);
  const [onCard, setOnCard] = useState(true);
  const [draft, setDraft] = useState<Record<string, { options?: string; scope?: string[] }>>({});
  const [into, setInto] = useState<Record<string, string>>({});
  return (
    <div className="space-y-3">
      <p className="text-base leading-6 text-fg-muted">حقول بطاقات المهام: نص · رقم · تاريخ · اختيار · شخص · رابط. الحقل اللي فيه قيم ما بينحذف — بتخفيه (بتضل القيم محفوظة) أو بتدمجه بحقل تاني من نفس النوع، أو بتغيّر نوعه لو كل قيمه بتنفع للنوع الجديد.</p>
      <ul className="space-y-2">
        {list.map((f) => {
          const others = list.filter((x) => x.id !== f.id && x.type === f.type);
          const d = draft[f.id] ?? {};
          return (
            <Row key={f.id} dim={f.hidden} drag={{ list: "fields-task", id: f.id, onDrop: (from, onto) => void run({ op: "field.drop", id: from, onto }) }}>
              <div className="flex items-center gap-1.5">
                <NameInput value={f.label} onSave={(v) => void run({ op: "field.update", id: f.id, label: v })} disabled={busy} />
                <IconButton aria-label="فوق" disabled={busy} onClick={() => void run({ op: "field.move", id: f.id, dir: -1 })}>
                  <ArrowUp className="size-4" />
                </IconButton>
                <IconButton aria-label="تحت" disabled={busy} onClick={() => void run({ op: "field.move", id: f.id, dir: 1 })}>
                  <ArrowDown className="size-4" />
                </IconButton>
                <IconButton aria-label="يطلع على البطاقة" aria-pressed={f.onCard !== false} className={f.onCard !== false ? "text-accent" : undefined} disabled={busy} onClick={() => void run({ op: "field.update", id: f.id, onCard: f.onCard === false })}>
                  <LayoutList className="size-4" />
                </IconButton>
                <IconButton aria-label={f.hidden ? "اظهره" : "اخفيه"} disabled={busy} onClick={() => void run({ op: "field.update", id: f.id, hidden: !f.hidden })}>
                  {f.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </IconButton>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Tag tone="accent">{FIELD_TYPE_AR[f.type]}</Tag>
                <Tag>{f.values} قيمة</Tag>
                <Tag>{f.boards?.length ? f.boards.map(labelOf).join("، ") : "كل اللوحات"}</Tag>
                {f.hidden ? <Tag>مخفي</Tag> : null}
              </div>
              <More>
                {f.type === "select" ? (
                  <div className="space-y-1.5">
                    <label className="block text-base text-fg-muted">
                      الخيارات (واحد بكل سطر)
                      <Textarea value={d.options ?? (f.options ?? []).join("\n")} onChange={(e) => setDraft((m) => ({ ...m, [f.id]: { ...m[f.id], options: e.target.value } }))} rows={4} />
                    </label>
                    <Button size="sm" variant="secondary" disabled={busy || d.options === undefined} onClick={() => void run({ op: "field.update", id: f.id, options: optionLines(d.options ?? "") })}>
                      احفظ الخيارات
                    </Button>
                  </div>
                ) : null}
                <ScopePicker boards={boards} value={d.scope ?? f.boards ?? []} onChange={(v) => setDraft((m) => ({ ...m, [f.id]: { ...m[f.id], scope: v } }))} />
                <Button size="sm" variant="secondary" disabled={busy || d.scope === undefined} onClick={() => void run({ op: "field.update", id: f.id, boards: d.scope!.length ? d.scope! : null })}>
                  احفظ المكان
                </Button>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Select aria-label="غيّر النوع" value={convert[f.id]?.to ?? ""} onChange={(e) => setConvert((m) => ({ ...m, [f.id]: { to: e.target.value as FieldType, options: m[f.id]?.options ?? "" } }))}>
                      <option value="">غيّر النوع لـ…</option>
                      {FIELD_TYPES.filter((t) => t !== f.type).map((t) => (
                        <option key={t} value={t}>
                          {FIELD_TYPE_AR[t]}
                        </option>
                      ))}
                    </Select>
                    <Button size="sm" variant="secondary" disabled={busy || !convert[f.id]?.to} onClick={() => void run({ op: "field.convert", id: f.id, to: convert[f.id]!.to, ...(convert[f.id]!.to === "select" ? { options: optionLines(convert[f.id]!.options) } : {}) })}>
                      غيّر
                    </Button>
                  </div>
                  {convert[f.id]?.to === "select" ? <Textarea value={convert[f.id]!.options} onChange={(e) => setConvert((m) => ({ ...m, [f.id]: { to: "select", options: e.target.value } }))} rows={3} placeholder="الخيارات: واحد بكل سطر — لازم تغطّي كل القيم المكتوبة" aria-label="الخيارات" /> : null}
                  <p className="text-base leading-6 text-fg-muted">بينغيّر بس لو كل القيم المكتوبة ({f.values}) بتنفع للنوع الجديد؛ وإلا بيوقف وبيقلّك كم قيمة ما بتنفع.</p>
                </div>
                {others.length ? (
                  <div className="flex items-center gap-2">
                    <Select aria-label="ادمجه بـ" value={into[f.id] ?? ""} onChange={(e) => setInto((m) => ({ ...m, [f.id]: e.target.value }))}>
                      <option value="">ادمجه بحقل…</option>
                      {others.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                    <Button size="sm" variant="secondary" disabled={busy || !into[f.id]} onClick={() => void run({ op: "field.merge", from: f.id, into: into[f.id]! })}>
                      ادمج
                    </Button>
                  </div>
                ) : null}
                <Button size="sm" variant="ghost" disabled={busy || f.values > 0} onClick={() => void run({ op: "field.archive", id: f.id })}>
                  <Trash2 className="size-3.5" />
                  {f.values > 0 ? `فيه ${f.values} قيمة — اخفيه أو ادمجه` : "احذفه (بترجّعه من «المحذوفات»)"}
                </Button>
              </More>
            </Row>
          );
        })}
        {!list.length ? <li className="rounded-lg border border-dashed border-border p-3 text-base leading-6 text-fg-muted">ما في حقول لسا. أضف أول حقل تحت، أو اعمل لوحة من قالب وبتجي معها حقولها.</li> : null}
      </ul>

      <form
        className="space-y-2 rounded-xl border border-dashed border-border p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run({ op: "field.add", entity: "task", label, type, ...(type === "select" ? { options: optionLines(options) } : {}), boards: scope.length ? scope : null, onCard });
          if (ok) {
            setLabel("");
            setOptions("");
          }
        }}
      >
        <p className="text-base font-semibold text-fg">＋ حقل جديد على بطاقة المهمة</p>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="اسم الحقل (مثلاً: رقم الشحنة)" aria-label="اسم الحقل" maxLength={40} dir="auto" />
        <Select value={type} onChange={(e) => setType(e.target.value as FieldType)} aria-label="النوع">
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {FIELD_TYPE_AR[t]}
            </option>
          ))}
        </Select>
        {type === "select" ? <Textarea value={options} onChange={(e) => setOptions(e.target.value)} rows={3} placeholder="الخيارات: واحد بكل سطر (اتنين على الأقل)" aria-label="الخيارات" /> : null}
        <ScopePicker boards={boards} value={scope} onChange={setScope} />
        <Checkbox label="يطلع على البطاقة نفسها (مش بس جوّاها)" checked={onCard} onChange={(e) => setOnCard(e.target.checked)} />
        <Button type="submit" disabled={busy || !label.trim()}>
          <Plus className="size-4" />
          أضف
        </Button>
      </form>
    </div>
  );
}

// ───────────────────────────── what was put away ─────────────────────────────

function TrashTab({ data, run, busy }: { data: PanelData; run: Run; busy: boolean }) {
  const boards = data.boards.filter((b) => b.archived);
  const fields = data.fields.filter((f) => f.archivedAt);
  const empty = !boards.length && !fields.length;
  const name = (key: string) => data.boards.find((b) => b.key === key)?.label ?? data.fields.find((f) => f.id === key)?.label ?? key;
  const row = (key: string, text: string, sub: string, op: UiOpShape, action: string) => (
    <Row key={key}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-medium text-fg">{text}</p>
          <p className="text-base text-fg-muted">{sub}</p>
        </div>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(op)}>
          <RotateCcw className="size-3.5" />
          {action}
        </Button>
      </div>
    </Row>
  );
  return (
    <div className="space-y-3">
      <p className="text-base leading-6 text-fg-muted">ما في شي بينحذف: اللي بتحذفه أو بتدمجه بيجي هون وبترجّعه.</p>
      <ul className="space-y-2">
        {boards.map((b) => row(b.key, b.label, b.mergedInto ? `اندمجت بـ «${name(b.mergedInto)}»${b.movedCount ? ` · ${b.movedCount} مهمة` : ""}` : "لوحة", { op: "board.restore", key: b.key }, b.canMoveBack ? "رجّعها ومهامها" : "رجّعها"))}
        {fields.map((f) => row(f.id, f.label, f.mergedInto ? `اندمج بـ «${name(f.mergedInto)}» · ${f.values} قيمة محفوظة` : `حقل · ${f.values} قيمة`, { op: "field.restore", id: f.id }, "رجّعه"))}
        {empty ? <li className="rounded-lg border border-dashed border-border p-3 text-base text-fg-muted">فاضي.</li> : null}
      </ul>
    </div>
  );
}

// ───────────────────────────── the panel ─────────────────────────────

/**
 * «لوحة تخصيص مهام الفريق»: where the owner makes a board from a template, adds fields to the cards, merges what looks alike and brings back what he put away (v6 · P8, Q5: the pages and
 * the buttons of the old edit mode are gone). Every change is one request (`POST /api/ui`) that either happens in full or says why not; the screens behind it refresh after each.
 * It opens from «تخصيص» on the team's board and from «الإعدادات ← متقدّم ← التخصيص», and only for the owner.
 */
export function EditPanel() {
  const { panel, closePanel, setTab, canEdit } = useShell();
  const router = useRouter();
  const { toast } = useToast();
  const [data, setData] = useState<PanelData | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const open = panel.open && canEdit;

  const load = useCallback(async () => {
    setFailed(false);
    const r = await safeFetch("/api/ui", { cache: "no-store" }).catch(() => null);
    const d = (await r?.json().catch(() => null)) as (PanelData & { demo?: boolean }) | null;
    if (r?.ok && d && !d.demo) setData(d);
    else setFailed(true);
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const run: Run = useCallback(
    async (op) => {
      setBusy(true);
      const r = await safeFetch("/api/ui", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(op) }).catch(() => null);
      const d = (await r?.json().catch(() => ({}))) as { error?: string; demo?: boolean; note?: string; panel?: PanelData; moved?: number; copied?: number; conflicts?: number; movedBack?: number };
      setBusy(false);
      if (!r || !r.ok) {
        toast(d?.error ?? "صار خطأ، جرّب كمان مرة", "error");
        return false;
      }
      if (d.demo || !d.panel) {
        toast("بدون تسجيل دخول ما بينحفظ شي", "info");
        return false;
      }
      setData(d.panel);
      const extra = [d.moved ? `انتقلت ${d.moved} مهمة` : "", d.movedBack ? `رجعت ${d.movedBack} مهمة` : "", d.copied ? `اننسخت ${d.copied} قيمة` : "", d.conflicts ? `${d.conflicts} تعارض: بقيت قيمة الحقل الجديد` : ""].filter(Boolean);
      toast(`${d.note ?? "انحفظ"}${extra.length ? ` — ${extra.join(" · ")}` : ""} ✓`, "success");
      router.refresh();
      return true;
    },
    [router, toast],
  );

  const trash = data ? data.boards.filter((b) => b.archived).length + data.fields.filter((f) => f.archivedAt).length : 0;
  const tabs = TABS.map((t) => (t.value === "trash" && trash ? { ...t, label: `${t.label} (${trash})` } : t));

  return (
    <Sheet open={open} onOpenChange={(o) => !o && closePanel()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>تخصيص مهام الفريق</SheetTitle>
          <SheetDescription>كل تعديل بيتحفظ فوراً وبيضل بعد التحديث. ما في شي بينحذف.</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-3">
          <Segmented value={panel.tab} onChange={setTab} options={tabs} label="أقسام التخصيص" />
          {failed ? (
            <div className="space-y-2 rounded-lg border border-dashed border-border p-3 text-base text-fg-muted">
              <p>ما قدرت أجيب الإعدادات — جرّب كمان مرة.</p>
              <Button size="sm" variant="secondary" onClick={() => void load()}>
                جرّب
              </Button>
            </div>
          ) : !data ? (
            <p className="text-base text-fg-muted">…</p>
          ) : (
            <>
              <Suggestions data={data} run={run} busy={busy} />
              {panel.tab === "boards" ? <BoardsTab data={data} run={run} busy={busy} /> : null}
              {panel.tab === "fields" ? <FieldsTab data={data} run={run} busy={busy} /> : null}
              {panel.tab === "trash" ? <TrashTab data={data} run={run} busy={busy} /> : null}
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
