"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { LightStrip } from "@/components/ui/light-strip";
import { RunSteps, type RunStepRow } from "@/components/ui/run-steps";
import { StateWord } from "@/components/ui/state-word";
import { ropeMove, type RopeMove } from "@/core/light-strip";
import type { Lamp } from "@/core/run-state";
import type { WordState } from "@/core/state-word";

/** The steps of the pretend run. They are an EXAMPLE for looking at the rope — not a real job. */
const DEMO_STEPS = [
  { title: "اقرا المخزون", note: "شو باقي من كل منتج" },
  { title: "اقرا الأرقام", note: "الطلبات المؤكدة وصرف أمس" },
  { title: "قرّر مين يكبر", note: "حسب القواعد، مش حسب الشعور" },
  { title: "جهّز التغيير", note: "بلا ما يتنفّذ" },
  { title: "ابعت التقرير", note: "للمالك" },
] as const;

const SENTENCE = (lamps: readonly Lamp[]): { text: string; word: WordState } => {
  const total = lamps.length;
  const failed = lamps.indexOf("fail");
  if (failed !== -1) return { text: `وقفت عند ${failed + 1}: ما قدرنا نكمّل ${DEMO_STEPS[failed]!.title}`, word: "fail" };
  const waiting = lamps.indexOf("wait");
  if (waiting !== -1) return { text: `واقفة عند ${waiting + 1}: بانتظار موافقتك`, word: "approval" };
  const running = lamps.indexOf("run");
  if (running !== -1) return { text: `هلق عند الخطوة ${running + 1} من ${total} — ${DEMO_STEPS[running]!.title}`, word: "run" };
  if (lamps.every((l) => l === "done")) return { text: "خلصت", word: "done" };
  return { text: "لسا ما بدأت", word: "next" };
};

/**
 * «ملعب الحبل» (docs/rebuild-v6/03-look.md §7): buttons that walk a pretend run step by step, so the owner can SEE every state of the rope and the strip on his phone —
 * the breathing lamp, the chasing diodes, the blinking one that needs him, the red stop. The moves are `ropeMove` (tested); nothing here touches a real job.
 */
export function RopePlayground() {
  const [lamps, setLamps] = useState<Lamp[]>(() => DEMO_STEPS.map(() => "off"));
  const move = (m: RopeMove) => setLamps((l) => ropeMove(l, m));
  const { text, word } = SENTENCE(lamps);
  const rows: RunStepRow[] = DEMO_STEPS.map((s, i) => ({
    id: `p${i}`,
    n: i + 1,
    title: s.title,
    note: lamps[i] === "off" ? null : s.note,
    lamp: lamps[i]!,
    ...(lamps[i] === "fail" ? { error: "جرّب كمان مرة بعد ما تتأكد من الاتصال" } : {}),
  }));
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => move("next")}>التالية</Button>
          <Button variant="secondary" onClick={() => move("hold")}>
            بدها موافقتك
          </Button>
          <Button variant="danger" onClick={() => move("fail")}>
            وقّفها
          </Button>
          <Button variant="ghost" onClick={() => move("reset")}>
            من الأول
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StateWord state={word} />
          <span className="text-base text-fg">{text}</span>
        </div>
        <LightStrip steps={rows} label={text} big />
        <RunSteps steps={rows} label="خطوات التشغيل التجريبي" />
      </CardBody>
    </Card>
  );
}
