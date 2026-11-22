"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { LIMITS } from "@/core/assistant";
import { VERB_AR, type JobDraft } from "@/core/job-draft";
import { RECIPE_TITLE, recipeSteps } from "@/core/recipes";
import { callJson } from "@/lib/call";

interface Answer {
  ok?: boolean;
  demo?: boolean;
  setup?: boolean;
  draft?: JobDraft | null;
  sentence?: string | null;
  say?: string;
}

/** «هاي بدها مفتاح المساعد — اربطه من الإعدادات ← الربط» — what the tab says when no assistant is connected; the two other ways of making a job keep working. */
export function NeedsKey({ message }: { message: string }) {
  return (
    <div className="space-y-3">
      <p className="text-base leading-7 text-fg">{message}</p>
      <Link href="/settings/connections" className="inline-flex min-h-11 items-center rounded-xl border border-border bg-surface-2 px-4 text-base font-semibold text-fg hover:bg-surface-1">
        افتح الإعدادات ← الربط
      </Link>
    </div>
  );
}

/**
 * «اكتبها بجملة» (docs/rebuild-v6/02-screens.md §3.7): a box for the sentence and «جهّزها»; the assistant answers with a draft, shown as «هيك فهمتها — صح؟»: the sentence of the draft and its steps, with
 * «اعتمدها» (the same save as every other way) and «عدّلها بإيدي» (opens «ركّبها» filled in). Nothing is saved before «اعتمدها». When the assistant is not connected the tab says how to connect it.
 */
export function WriteIt({
  on,
  needsKey,
  names,
  saving,
  onApprove,
  onEdit,
}: {
  on: boolean;
  needsKey: string;
  /** keys to names, for the words of the draft's sentence */
  names: Readonly<Record<string, string>>;
  saving: boolean;
  onApprove: (draft: JobDraft) => void;
  onEdit: (draft: JobDraft) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<string | null>(null);
  const [got, setGot] = useState<{ draft: JobDraft; sentence: string } | null>(null);
  const [ask, setAsk] = useState<string | null>(null);

  if (!on || setup) return <NeedsKey message={setup ?? needsKey} />;

  const prepare = async () => {
    const sentence = text.trim();
    if (sentence.length < 3) return setError("اكتب المهمة بجملة");
    setBusy(true);
    setError(null);
    setAsk(null);
    setGot(null);
    try {
      const r = await callJson<Answer>("/api/assistant/draft-job", { method: "POST", body: { sentence } });
      if (!r.ok) {
        if (r.data?.setup) return setSetup(r.error ?? needsKey);
        return setError(r.error ?? "صار خطأ، جرّب كمان مرة");
      }
      if (r.data?.demo) return setError(r.data.say ?? "بالوضع التجريبي ما في مساعد");
      if (r.data?.draft) return setGot({ draft: r.data.draft, sentence: r.data.sentence ?? "" });
      // no draft: the assistant is asking for what was missing, or could not make one
      setAsk(r.data?.say?.trim() || "ما قدرت أفهمها كاملة — زيد تفصيل: مين بينفّذها، وإيمتى، وشو يعمل.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Field label="اكتب المهمة بجملة" hint="مثلاً: كل يوم الساعة 9:30 خلّي Claude يقرا المخزون ويبلّغني لو في منتج ناقص">
        <Textarea
          rows={3}
          value={text}
          maxLength={LIMITS.question}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
      </Field>
      <p className="text-sm text-fg-muted">الجملة بتروح للمساعد من غير أي رقم هاتف أو بيانات زبون. هو بيجهّز مسودة بس، وإنت بتراجعها وبتعتمدها.</p>
      {error ? (
        <p role="alert" className="text-base font-semibold text-danger">
          {error}
        </p>
      ) : null}
      <Button size="lg" loading={busy} disabled={!text.trim()} onClick={() => void prepare()}>
        جهّزها
      </Button>

      {ask ? (
        <section aria-live="polite" className="space-y-2 rounded-2xl border border-border bg-surface-2 p-4">
          <h3 className="font-display text-base font-extrabold text-fg">المساعد بيسأل</h3>
          <p className="text-base leading-7 text-fg">{ask}</p>
          <p className="text-sm text-fg-muted">زيد الجواب على الجملة فوق وجرّب «جهّزها» كمان مرة.</p>
        </section>
      ) : null}

      {got ? (
        <section aria-live="polite" className="space-y-3 rounded-2xl border border-border bg-surface-1 p-4">
          <h3 className="font-display text-lg font-extrabold text-fg">هيك فهمتها — صح؟</h3>
          <p className="text-base font-semibold text-fg">{got.draft.name}</p>
          <p className="text-base text-fg-muted">{got.sentence}</p>
          {got.draft.recipe ? (
            <ol className="list-decimal space-y-1 ps-5 text-base text-fg">
              {recipeSteps(got.draft.recipe.name, got.draft.recipe.params, names).map((s, i) => (
                <li key={i}>{`${VERB_AR[s.verb]}: ${s.text}`}</li>
              ))}
              <li className="list-none text-sm text-fg-muted">وصفة «{RECIPE_TITLE[got.draft.recipe.name]}» — الموقع بينفّذها لحاله</li>
            </ol>
          ) : (
            <ol className="list-decimal space-y-1 ps-5 text-base text-fg">
              {got.draft.steps.map((s, i) => (
                <li key={i}>{`${VERB_AR[s.verb]}: ${s.text}`}</li>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap gap-3">
            <Button size="lg" loading={saving} onClick={() => onApprove(got.draft)}>
              اعتمدها
            </Button>
            <Button size="lg" variant="secondary" disabled={saving} onClick={() => onEdit(got.draft)}>
              عدّلها بإيدي
            </Button>
          </div>
          <p className="text-sm text-fg-muted">ما انحفظ شي لسا.</p>
        </section>
      ) : null}
    </div>
  );
}
