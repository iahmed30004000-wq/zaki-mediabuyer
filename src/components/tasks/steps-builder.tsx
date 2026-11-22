"use client";

import { Fragment } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { StepBlock, StepBlocks, StepJoint } from "@/components/ui/step-block";
import { MAX_STEPS, MAX_STEP_TEXT, VERBS, VERB_AR, VERB_CHIP, VERB_HINT, type DraftStep, type Verb } from "@/core/job-draft";

/**
 * The steps as blocks standing on top of each other (docs/rebuild-v6/02-screens.md §3.7 السؤال 3 · §3.8): each block is its kind and a text box, two arrows and a cross; a «قرّر» block also says where
 * «لا» goes; under the blocks, the row «ضيف خطوة» with one key per kind. It draws and reports — the list is the parent's, and so are the rules (`src/core/job-draft.ts`),
 * because a screen that edits a drawing that exists keeps the ids of its nodes beside the blocks and moves them together. `off`: the blocks that are switched off in the drawing.
 */
export function StepsBuilder({
  steps,
  off,
  onText,
  onElse,
  onMove,
  onRemove,
  onAdd,
  label = "الخطوات",
}: {
  steps: readonly DraftStep[];
  off?: readonly boolean[];
  onText: (at: number, text: string) => void;
  onElse: (at: number, to: number | "end") => void;
  onMove: (at: number, by: -1 | 1) => void;
  onRemove: (at: number) => void;
  onAdd: (verb: Verb) => void;
  label?: string;
}) {
  return (
    <div className="space-y-4">
      {steps.length ? (
        <StepBlocks label={label}>
          {steps.map((s, i) => (
            <Fragment key={i}>
              {i > 0 ? <StepJoint /> : null}
              <StepBlock wide n={i + 1} kind={off?.[i] ? `${VERB_AR[s.verb]} (مطفية)` : VERB_AR[s.verb]} onUp={i > 0 ? () => onMove(i, -1) : undefined} onDown={i < steps.length - 1 ? () => onMove(i, 1) : undefined} onRemove={() => onRemove(i)}>
                <div className="space-y-2">
                  <Input value={s.text} maxLength={MAX_STEP_TEXT + 20} placeholder={VERB_HINT[s.verb]} aria-label={`نص الخطوة ${i + 1}: ${VERB_AR[s.verb]}`} onChange={(e) => onText(i, e.target.value)} />
                  {s.verb === "decide" ? (
                    <label className="block space-y-1">
                      <span className="block text-sm font-semibold text-fg-muted">وإلا (لو لأ) روح لـ</span>
                      <Select value={typeof s.elseGoto === "number" ? String(s.elseGoto) : "end"} aria-label={`وين تروح الخطوة ${i + 1} لو الجواب لأ`} onChange={(e) => onElse(i, e.target.value === "end" ? "end" : Number(e.target.value))}>
                        <option value="end">النهاية (بتخلص المهمة)</option>
                        {steps.map((_, j) => (j > i + 1 ? <option key={j} value={j}>{`الخطوة ${j + 1}`}</option> : null))}
                      </Select>
                    </label>
                  ) : null}
                </div>
              </StepBlock>
            </Fragment>
          ))}
        </StepBlocks>
      ) : (
        <EmptyState title="ما في خطوات لسا" hint="ضيف أول خطوة من تحت: اقرا، قارن، نفّذ…" />
      )}
      <div className="space-y-2">
        <p className="text-base font-semibold text-fg-muted">ضيف خطوة:</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="ضيف خطوة">
          {VERBS.map((v) => (
            <Button key={v} variant="secondary" size="sm" disabled={steps.length >= MAX_STEPS} onClick={() => onAdd(v)}>
              {VERB_CHIP[v]}
            </Button>
          ))}
        </div>
        {steps.length >= MAX_STEPS ? <p className="text-sm text-fg-muted">وصلت لأقصى عدد خطوات ({MAX_STEPS}).</p> : null}
      </div>
    </div>
  );
}
