/**
 * «مهمة جديدة» and «تعديل الخطوات» as drawn (v6 · P4-1), and who is offered them: the blocks (kind · text box · arrows · cross), the question under a «قرّر», the row «ضيف خطوة», the four
 * questions with their big keys and the bar with the sentence and «اعتمد المهمة»; the «＋» offers the screen to the roles that hold `work.create` and the address is theirs alone.
 * Rendered on the server (no browser); the router and the toast are stand-ins.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }), usePathname: () => "/tasks/new", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { NewJob, type DoerOption } from "@/components/tasks/new-job";
import { EditSteps } from "@/components/tasks/edit-steps";
import { StepsBuilder } from "@/components/tasks/steps-builder";
import { StepBlock } from "@/components/ui/step-block";
import { PLUS_ITEMS } from "@/components/shell/plus-sheet";
import { MAX_STEPS, VERBS, type DraftStep } from "@/core/job-draft";
import { ROLES, canOpenPath, can } from "@/core/roles";
import { SEED_WORKFLOWS } from "@/core/workflow";
import { PAGE_GUIDE } from "@/lib/guide";

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const noop = () => undefined;
const props = { onText: noop, onElse: noop, onMove: noop, onRemove: noop, onAdd: noop };
const steps: DraftStep[] = [
  { verb: "read", text: "اقرا المخزون" },
  { verb: "decide", text: "إذا المخزون قليل", elseGoto: 3 },
  { verb: "do", text: "نفّذ" },
  { verb: "tell", text: "ابعتلي تنبيه" },
];

describe("the blocks", () => {
  it("one block per step: its number, its kind in words and its text in a box; joints between them, none before the first or after the last", () => {
    const out = render(h(StepsBuilder, { steps, ...props }));
    expect(count(out, /<li[^>]*grid-cols-\[auto_minmax/g)).toBe(4);
    for (const kind of ["اقرا", "قرّر", "نفّذ", "بلّغ"]) expect(out).toContain(`>${kind}</b>`);
    expect(out).toContain('value="اقرا المخزون"');
    expect(out).toContain('aria-label="نص الخطوة 2: قرّر"');
    expect(count(out, /role="presentation"/g)).toBe(3);
  });

  it("the arrows: the first block has no «up», the last no «down»; every block has its cross", () => {
    const out = render(h(StepsBuilder, { steps, ...props }));
    expect(out).not.toContain('aria-label="قدّم الخطوة 1"');
    expect(out).toContain('aria-label="قدّم الخطوة 2"');
    expect(out).toContain('aria-label="أخّر الخطوة 3"');
    expect(out).not.toContain('aria-label="أخّر الخطوة 4"');
    expect(count(out, /aria-label="احذف الخطوة \d"/g)).toBe(4);
  });

  it("the question under a «قرّر»: «النهاية» and the steps after the next one — and only that block has it", () => {
    const out = render(h(StepsBuilder, { steps, ...props }));
    expect(count(out, /<select/g)).toBe(1);
    expect(out).toContain("وإلا (لو لأ) روح لـ");
    expect(out).toContain("النهاية (بتخلص المهمة)");
    // the «no» of step 2 points at step 4 (index 3): it is the selected one; step 3 is the next step, so it is not offered
    expect(out).toMatch(/<option value="3" selected[^>]*>الخطوة 4<\/option>/);
    expect(out).not.toContain(">الخطوة 3<");
  });

  it("the row «ضيف خطوة»: one key per kind (seven), a step that was switched off says so, and none left to add at the limit", () => {
    const out = render(h(StepsBuilder, { steps, off: [false, false, true, false], ...props }));
    for (const w of ["اقرا", "قارن", "قرّر (إذا)", "نفّذ", "استنى موافقتي", "بلّغ", "اطلب من حدا"]) expect(out).toContain(`>${w}</button>`);
    expect(count(out, /aria-label="ضيف خطوة"/g)).toBe(1);
    expect(VERBS).toHaveLength(7);
    expect(out).toContain("نفّذ (مطفية)");
    const full = render(h(StepsBuilder, { steps: Array.from({ length: MAX_STEPS }, () => ({ verb: "read" as const, text: "a" })), ...props }));
    expect(count(full, /disabled=""[^>]*>اقرا<\/button>/g)).toBe(1);
    expect(full).toContain(`أقصى عدد خطوات (${MAX_STEPS})`);
  });

  it("a block that is wide puts what is in it on a row of its own, the whole width (a text box beside three 44-wide keys would be a sliver on a phone); the others are as they were", () => {
    expect(render(h(StepBlock, { n: 1, kind: "اقرا", wide: true }, "نص"))).toContain("col-span-3");
    expect(render(h(StepBlock, { n: 1, kind: "اقرا" }, "نص"))).not.toContain("col-span-3");
    expect(render(h(StepsBuilder, { steps, ...props }))).toContain("col-span-3");
  });

  it("no steps: it says what to do next, not a dead end", () => {
    const out = render(h(StepsBuilder, { steps: [], ...props }));
    expect(out).toContain("ما في خطوات لسا");
    expect(out).toContain("ضيف أول خطوة من تحت");
  });
});

describe("the screen", () => {
  const people: DoerOption[] = [
    { key: "claude", name: "Claude الرئيسي", kind: "agent", hint: "وكيل" },
    { key: "hermes", name: "هيرمز", kind: "agent", hint: "وكيل" },
    { key: "member1", name: "عضو الفريق", kind: "person", hint: "التأكيد" },
  ];

  it("the switch and the four questions, in order, each with its big keys; the people come from the directory", () => {
    const out = render(h(NewJob, { people }));
    expect(out).toContain('aria-label="كيف بدك تعملها"');
    expect(out).toContain("ركّبها");
    expect(out).toContain("من قالب");
    for (const q of ["مين بدّه يعملها؟", "إيمتى؟", "شو تعمل؟ خطوة خطوة", "إيمتى أخبّرك؟", "شو نسمّيها؟"]) expect(out).toContain(q);
    for (const p of ["Claude الرئيسي", "هيرمز", "عضو الفريق"]) expect(out).toContain(p);
    for (const t of ["هلق", "مرة وحدة", "كل يوم", "كل ساعة", "كل أسبوع", "لفترة"]) expect(out).toContain(`<b class="text-base font-bold">${t}</b>`);
    for (const t of ["لما تخلص", "لما توقف أو تفوت", "بس لو في شي مهم"]) expect(out).toContain(t);
    // the first panel is the 1, the second the 2…
    expect(out.indexOf("مين بدّه يعملها؟")).toBeLessThan(out.indexOf("إيمتى؟"));
    expect(out.indexOf("إيمتى؟")).toBeLessThan(out.indexOf("شو تعمل؟ خطوة خطوة"));
    expect(out.indexOf("شو تعمل؟ خطوة خطوة")).toBeLessThan(out.indexOf("إيمتى أخبّرك؟"));
  });

  it("the «site by itself» is not offered (its jobs are recipes, not built yet) and nothing is chosen at first: no tile is pressed for the doer", () => {
    const out = render(h(NewJob, { people }));
    expect(out).not.toContain("الموقع لحاله</b>");
    const who = out.slice(out.indexOf('id="q-who"'), out.indexOf('id="q-when"'));
    expect(count(who, /aria-pressed="true"/g)).toBe(0);
    expect(count(who, /aria-pressed="false"/g)).toBe(3);
  });

  it("«كل يوم» is the first choice for the time (09:30) and «لما توقف أو تفوت» for the telling", () => {
    const out = render(h(NewJob, { people }));
    const when = out.slice(out.indexOf('id="q-when"'), out.indexOf('id="q-steps"'));
    expect(when).toMatch(/aria-pressed="true"[^>]*><b class="text-base font-bold">كل يوم<\/b>/);
    expect(when).toContain('type="time"');
    expect(when).toContain('value="09:30"');
    expect(when).toContain("الأوقات كلها بتوقيت عمّان");
    const tell = out.slice(out.indexOf('id="q-tell"'), out.indexOf('id="q-name"'));
    expect(tell).toMatch(/aria-pressed="true"[^>]*><b class="text-base font-bold">لما توقف أو تفوت<\/b>/);
  });

  it("the bar: the draft in one sentence and the one primary key «اعتمد المهمة»", () => {
    const out = render(h(NewJob, { people }));
    expect(out).toContain("اعتمد المهمة");
    expect(out).toContain("مين؟ · كل يوم 09:30 · 0 خطوات · بخبّرك لما توقف أو تفوت");
    expect(count(out, /اعتمد المهمة/g)).toBe(1);
  });

  it("the name box and the kind of job (إعلانات · فريق وتشغيل)", () => {
    const out = render(h(NewJob, { people }));
    expect(out).toContain("اسم المهمة");
    expect(out).toContain("فريق وتشغيل");
    expect(out).toContain('aria-label="نوع المهمة"');
  });

  it("a team with nobody in it says where to add somebody", () => {
    expect(render(h(NewJob, { people: [] }))).toContain("الإعدادات ← الفريق");
  });

  it("no tool's name and no jargon in what the screen says", () => {
    const out = render(h(NewJob, { people }));
    for (const w of ["push_", "log_run", "cron", "MCP", "workflow", "ورك فلو", "handoff", "طابور", "Coolify", "_TOKEN"]) expect(out, w).not.toContain(w);
  });
});

describe("who is offered it, and where it lives", () => {
  it("«مهمة جديدة» is the first thing in the «＋», for the roles that hold `work.create` — and it points at a screen that exists", () => {
    const item = PLUS_ITEMS[0];
    expect(item).toMatchObject({ key: "new_job", href: "/tasks/new", label: "مهمة جديدة", cap: "work.create" });
    expect(existsSync(path.join(process.cwd(), "src", "app", "(app)", "tasks", "new", "page.tsx"))).toBe(true);
    expect(existsSync(path.join(process.cwd(), "src", "app", "(app)", "tasks", "[key]", "edit", "page.tsx"))).toBe(true);
    // the other two offers are the ones that were there (a person's task, a campaign launch)
    expect(PLUS_ITEMS.map((i) => i.key)).toEqual(["new_job", "person_task", "launch"]);
  });

  it("the address is the owner's and the manager's alone: nobody else opens it, even though they may read the jobs", () => {
    for (const role of ROLES) {
      expect(canOpenPath(role, "/tasks/new"), role).toBe(role === "OWNER" || role === "MANAGER");
      expect(can(role, "work.create"), role).toBe(role === "OWNER" || role === "MANAGER");
    }
    // the rest of «المهام» is as it was
    for (const role of ["OWNER", "MANAGER", "ADS_MANAGER", "OPS_MANAGER", "TEAM_LEAD", "ANALYST"] as const) expect(canOpenPath(role, "/tasks/day"), role).toBe(true);
    // a job whose key looks like «new-something» is still a job
    expect(canOpenPath("ADS_MANAGER", "/tasks/new-year-round")).toBe(true);
    expect(canOpenPath("OWNER", "/tasks/wf-a1b2c3/edit")).toBe(true);
  });

  it("the page guide of «المهام» points at the parts of the new screen", () => {
    const targets = PAGE_GUIDE.tasks.tour.map((s) => s.target);
    for (const t of ["who", "when", "steps", "tell", "save"]) expect(targets).toContain(t);
  });
});

describe("the edit screen", () => {
  const night = SEED_WORKFLOWS.find((s) => s.key === "night-round")!;
  const screen = () => render(h(EditSteps, { jobKey: "night-round", jobName: night.name, version: 1, graph: night.graph, executor: "claude_mcp", demo: true }));

  it("the drawing the job has, as blocks in the order they run, each with its text; nothing changed yet, so there is nothing to save", () => {
    const out = screen();
    expect(out).toContain("تعديل الخطوات");
    expect(count(out, /<li[^>]*grid-cols-\[auto_minmax/g)).toBe(6);
    expect(out).toContain('value="قراءة آخر 3 أيام كاملة"');
    expect(out).toContain('value="فوق نقطة التعادل؟ تحت الهدف؟"');
    expect(out).toContain("ما تغيّر شي لسا");
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>احفظ<\/button>/);
  });

  it("no tool's name and no jargon", () => {
    const out = screen();
    for (const w of ["push_", "log_run", "cron", "MCP", "workflow", "ورك فلو", "handoff", "طابور"]) expect(out, w).not.toContain(w);
  });
});
