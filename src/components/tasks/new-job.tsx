"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChoiceTile } from "@/components/ui/choice-tile";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { ammanKey } from "@/core/dates";
import {
  HOURLY_EVERY,
  NOTIFY_PRESETS,
  WEEKDAY_AR,
  addStep,
  defaultWhen,
  draftSentence,
  emptyDraft,
  joinInstant,
  moveStep,
  normalizeDraft,
  presetOf,
  removeStep,
  setElse,
  setStepText,
  splitInstant,
  suggestName,
  validateDraft,
  type JobDraft,
  type When,
  type WhenKind,
} from "@/core/job-draft";
import { JOB_TEMPLATES, templateDraft } from "@/core/job-templates";
import { callJson } from "@/lib/call";
import { StepsBuilder } from "./steps-builder";

/** Somebody the job can be given to: an agent or a person from the team directory (the site's own row is not one — its jobs are recipes). */
export interface DoerOption {
  key: string;
  name: string;
  kind: "agent" | "person";
  hint: string;
}

interface Saved {
  ok?: boolean;
  demo?: boolean;
  kind?: "job" | "task";
  href?: string;
  number?: number | null;
  asked?: boolean | null;
  field?: string;
}

const WHEN_TILES: { kind: WhenKind; title: string; hint: string }[] = [
  { kind: "now", title: "هلق", hint: "مرة وحدة فوراً" },
  { kind: "once", title: "مرة وحدة", hint: "بيوم وساعة" },
  { kind: "daily", title: "كل يوم", hint: "بنفس الساعة" },
  { kind: "hourly", title: "كل ساعة", hint: "بوقت الدوام" },
  { kind: "weekly", title: "كل أسبوع", hint: "بيوم محدد" },
  { kind: "window", title: "لفترة", hint: "وبتخلص لحالها" },
];
const EVERY_AR: Record<number, string> = { 1: "كل ساعة", 2: "كل ساعتين", 3: "كل 3 ساعات", 4: "كل 4 ساعات", 6: "كل 6 ساعات" };
const DOMAINS = [
  { value: "ads", label: "إعلانات" },
  { value: "ops", label: "فريق وتشغيل" },
] as const;

/** The panel a message about a field belongs to (the screen scrolls to it). */
const PANEL_OF = (field: string | undefined): string => (!field ? "q-save" : field.startsWith("assignee") ? "q-who" : field.startsWith("when") ? "q-when" : field.startsWith("steps") || field === "recipe" ? "q-steps" : field.startsWith("notify") ? "q-tell" : "q-name");

function Question({ n, title, id, tour, children }: { n: number | null; title: string; id: string; tour?: string; children: React.ReactNode }) {
  return (
    <section id={id} data-tour={tour} className="space-y-3 rounded-2xl border border-border bg-surface-1 p-4" style={{ scrollMarginTop: 80 }}>
      <div className="flex items-center gap-3">
        {n !== null ? (
          <span aria-hidden className="inline-grid size-8 shrink-0 place-items-center rounded-full border border-border bg-surface-2 font-display text-base font-extrabold tabular-nums">
            {n}
          </span>
        ) : null}
        <h2 className="font-display text-lg font-extrabold text-fg">{title}</h2>
      </div>
      {children}
    </section>
  );
}

/** A time box: the clock the way it is typed (24 hours), left to right inside a right-to-left page. */
function TimeField({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: boolean }) {
  return (
    <Field label={label} className="min-w-36 flex-1">
      <Input type="time" dir="ltr" value={value} aria-invalid={error || undefined} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

const asEvery = (v: number): 1 | 2 | 3 | 4 | 6 => ((HOURLY_EVERY as readonly number[]).includes(v) ? (v as 1 | 2 | 3 | 4 | 6) : 2);

function EverySelect({ value, onPick }: { value: number; onPick: (v: 1 | 2 | 3 | 4 | 6) => void }) {
  return (
    <Field label="كل قديش" className="min-w-36 flex-1">
      <Select value={String(value)} onChange={(e) => onPick(asEvery(Number(e.target.value)))}>
        {HOURLY_EVERY.map((h) => (
          <option key={h} value={h}>
            {EVERY_AR[h]}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function WhenFields({ when, onChange, today }: { when: When; onChange: (w: When) => void; today: string }) {
  switch (when.kind) {
    case "now":
      return <p className="text-base text-fg-muted">بتنطلب بنفس اللحظة اللي بتعتمدها فيها.</p>;
    case "once":
      return (
        <div className="flex flex-wrap gap-3">
          <Field label="اليوم" className="min-w-44 flex-1">
            <Input type="date" dir="ltr" min={today} value={when.date} onChange={(e) => onChange({ ...when, date: e.target.value })} />
          </Field>
          <TimeField label="الساعة" value={when.time} onChange={(time) => onChange({ ...when, time })} />
        </div>
      );
    case "daily":
      return (
        <div className="flex flex-wrap gap-3">
          <TimeField label="الساعة" value={when.time} onChange={(time) => onChange({ ...when, time })} />
        </div>
      );
    case "hourly":
      return (
        <div className="flex flex-wrap gap-3">
          <TimeField label="من الساعة" value={when.from} onChange={(from) => onChange({ ...when, from })} />
          <TimeField label="لحد الساعة" value={when.to} onChange={(to) => onChange({ ...when, to })} />
          <EverySelect value={when.everyHours} onPick={(everyHours) => onChange({ ...when, everyHours })} />
        </div>
      );
    case "weekly":
      return (
        <div className="space-y-3">
          <div role="group" aria-label="أيام الأسبوع" className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {WEEKDAY_AR.map((d, i) => {
              const on = when.days.includes(i);
              return <ChoiceTile key={d} title={d} className="min-h-12 items-center px-2 py-2 text-center" pressed={on} onClick={() => onChange({ ...when, days: on ? when.days.filter((x) => x !== i) : [...when.days, i].sort((a, b) => a - b) })} />;
            })}
          </div>
          <div className="flex flex-wrap gap-3">
            <TimeField label="الساعة" value={when.time} onChange={(time) => onChange({ ...when, time })} />
          </div>
        </div>
      );
    case "window": {
      const until = splitInstant(when.until) ?? { date: today, time: "23:59" };
      const set = (date: string, time: string) => onChange({ ...when, until: joinInstant(date, time) ?? "" });
      return (
        <div className="flex flex-wrap gap-3">
          <EverySelect value={when.everyHours} onPick={(everyHours) => onChange({ ...when, everyHours })} />
          <Field label="لحد يوم" className="min-w-44 flex-1">
            <Input type="date" dir="ltr" min={today} value={until.date} onChange={(e) => set(e.target.value, until.time)} />
          </Field>
          <TimeField label="والساعة" value={until.time} onChange={(time) => set(until.date, time)} />
        </div>
      );
    }
  }
}

/**
 * «مهمة جديدة» (docs/rebuild-v6/02-screens.md §3.7): a switch between «ركّبها» (four questions on top of each other, each with big keys) and «من قالب» (six drafts half built) — both fill the
 * same draft. Under it a bar that stays: the draft in one sentence and «اعتمد المهمة». Nothing is saved before that press; the site checks the draft again and answers with a sentence the
 * screen puts next to the question it is about. The times are on the Amman clock. «اكتبها بجملة» joins when the assistant can draft a job (P4-2).
 */
export function NewJob({ people }: { people: DoerOption[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [mode, setMode] = useState<"build" | "tpl">("build");
  const [draft, setDraft] = useState<JobDraft>(() => emptyDraft());
  const [nameTouched, setNameTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [today] = useState(() => ammanKey(new Date()));
  const names = Object.fromEntries(people.map((p) => [p.key, p.name]));

  const edit = (patch: Partial<JobDraft>) => {
    setError(null);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const setSteps = (steps: JobDraft["steps"]) => {
    setError(null);
    setDraft((d) => ({ ...d, steps, ...(nameTouched ? {} : { name: suggestName(steps) }) }));
  };
  const pickTemplate = (key: string) => {
    const t = templateDraft(key, new Date());
    if (!t) return;
    setError(null);
    setNameTouched(false);
    // a person the template does not know is not guessed: the owner picks one
    setDraft({ ...t, assigneeKey: people.some((p) => p.key === t.assigneeKey) ? t.assigneeKey : "" });
    setMode("build");
    window.scrollTo({ top: 0 });
  };

  const fail = (message: string, field?: string) => {
    setError({ message, field });
    document.getElementById(PANEL_OF(field))?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  const save = async () => {
    const d = normalizeDraft(draft);
    const check = validateDraft(d, new Date());
    if (!check.ok) return fail(check.message, check.field);
    setSaving(true);
    try {
      const r = await callJson<Saved>("/api/jobs", { method: "POST", body: { draft: d } });
      if (!r.ok) return fail(r.error ?? "صار خطأ", r.data?.field);
      if (r.data?.demo) return toast("بالوضع التجريبي ما انحفظ شي", "info");
      const out = r.data;
      if (out?.kind === "task") toast("تمّت ✓ — انحفظت كمهمة على لوحة الفريق بموعدها", "success");
      else toast(`تمّت ✓ — انحفظت المهمة${out?.number ? ` رقم ${out.number}` : ""}${out?.asked === true ? " وانطلب تشغيلها هلق" : out?.asked === false ? " (ما انطلب تشغيلها — اضغط «شغّلها هلق» من صفحتها)" : ""}`, "success");
      router.push(out?.href ?? "/tasks/all");
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 pb-2">
      <div>
        <Segmented
          label="كيف بدك تعملها"
          value={mode}
          onChange={setMode}
          options={[
            { value: "build", label: "ركّبها" },
            { value: "tpl", label: "من قالب" },
          ]}
        />
      </div>

      {mode === "tpl" ? (
        <Question n={null} id="q-templates" title="قوالب جاهزة من شغلك">
          <p className="text-base text-fg-muted">اختار واحد، وبيفتحلك «ركّبها» معبّاية وبتعدّل اللي بدك.</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {JOB_TEMPLATES.map((t) => (
              <ChoiceTile key={t.key} title={t.title} hint={t.hint} onClick={() => pickTemplate(t.key)} />
            ))}
          </div>
        </Question>
      ) : (
        <>
          <Question n={1} id="q-who" tour="who" title="مين بدّه يعملها؟">
            {people.length ? (
              <div role="group" aria-label="مين بدّه يعملها" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {people.map((p) => (
                  <ChoiceTile key={p.key} title={p.name} hint={p.hint} pressed={draft.assigneeKey === p.key} onClick={() => edit({ assigneeKey: p.key })} />
                ))}
              </div>
            ) : (
              <p className="text-base text-fg-muted">ما في حدا بدليل الفريق لسا. ضيف وكيل أو شخص من الإعدادات ← الفريق.</p>
            )}
          </Question>

          <Question n={2} id="q-when" tour="when" title="إيمتى؟">
            <div role="group" aria-label="إيمتى" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {WHEN_TILES.map((t) => (
                <ChoiceTile key={t.kind} title={t.title} hint={t.hint} pressed={draft.when.kind === t.kind} onClick={() => edit({ when: draft.when.kind === t.kind ? draft.when : defaultWhen(t.kind, new Date(), draft.when) })} />
              ))}
            </div>
            <WhenFields when={draft.when} onChange={(when) => edit({ when })} today={today} />
            <p className="text-sm text-fg-muted">الأوقات كلها بتوقيت عمّان.</p>
          </Question>

          <Question n={3} id="q-steps" tour="steps" title="شو تعمل؟ خطوة خطوة">
            <StepsBuilder
              steps={draft.steps}
              onText={(at, text) => setSteps(setStepText(draft.steps, at, text))}
              onElse={(at, to) => setSteps(setElse(draft.steps, at, to))}
              onMove={(at, by) => setSteps(moveStep(draft.steps, at, by))}
              onRemove={(at) => setSteps(removeStep(draft.steps, at))}
              onAdd={(verb) => setSteps(addStep(draft.steps, verb))}
            />
          </Question>

          <Question n={4} id="q-tell" tour="tell" title="إيمتى أخبّرك؟">
            <div role="group" aria-label="إيمتى أخبّرك" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {NOTIFY_PRESETS.map((p) => (
                <ChoiceTile key={p.key} title={p.label} pressed={presetOf(draft.notifyOn) === p.key} onClick={() => edit({ notifyOn: [...p.on] })} />
              ))}
            </div>
          </Question>

          <Question n={null} id="q-name" title="شو نسمّيها؟">
            <Field label="اسم المهمة" hint="بينقترح من أول خطوة، وبتعدّله براحتك">
              <Input
                value={draft.name}
                maxLength={140}
                onChange={(e) => {
                  setNameTouched(true);
                  edit({ name: e.target.value });
                }}
              />
            </Field>
            <div className="space-y-1.5">
              <span className="block text-base font-semibold text-fg">نوعها</span>
              <Segmented label="نوع المهمة" value={draft.domain} onChange={(domain) => edit({ domain })} options={DOMAINS} />
            </div>
          </Question>
        </>
      )}

      {mode === "build" ? (
        <div id="q-save" data-tour="save" className="sticky bottom-20 z-10 space-y-2 rounded-2xl border border-border bg-surface-1/95 p-3 backdrop-blur md:bottom-4">
          {error ? (
            <p role="alert" className="text-base font-semibold text-danger">
              {error.message}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-base text-fg" aria-live="polite">
              {draftSentence(draft, names)}
            </p>
            <Button size="lg" loading={saving} onClick={save}>
              اعتمد المهمة
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
