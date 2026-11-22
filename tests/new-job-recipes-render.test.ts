/**
 * «مهمة جديدة» with the site's recipes and the sentence (v6 · P4-2), as drawn: «الموقع لحاله» among the doers, the four recipes with their own fields, the third way «اكتبها بجملة» in its two states
 * (a key linked, or the plain sentence that says how to link one), the assistant's card for a draft and the way a draft travels from it to the screen. Rendered on the server (no browser).
 */
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }), usePathname: () => "/tasks/new", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { ArtifactCard } from "@/components/shell/assistant-cards";
import { NewJob, type DoerOption } from "@/components/tasks/new-job";
import { RecipeFields, defaultRecipe } from "@/components/tasks/recipe-fields";
import { NeedsKey, WriteIt } from "@/components/tasks/write-it";
import { RECIPES, RECIPE_HINT, RECIPE_TITLE, validateRecipe } from "@/core/recipes";
import type { JobDraft } from "@/core/job-draft";
import { DRAFT_NEEDS_KEY } from "@/server/assistant/config";
import { FROM_ASSISTANT, JOB_DRAFT_KEY, leaveJobDraft, takeJobDraft } from "@/lib/job-draft-handoff";

const people: DoerOption[] = [
  { key: "claude", name: "Claude الرئيسي", kind: "agent", hint: "وكيل" },
  { key: "member1", name: "عضو الفريق", kind: "person", hint: "تأكيد" },
  { key: "site", name: "الموقع لحاله", kind: "agent", hint: "وصفات جاهزة" },
];
const products = [{ code: "TIN01", name: "قطرة طنين الأذن" }, { code: "TRF01", name: "ماء الكمأة" }];
const persons = [{ key: "member1", name: "عضو الفريق" }];
const noop = () => undefined;
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("«مهمة جديدة»: three ways, one draft", () => {
  it("the switch has «ركّبها» · «اكتبها بجملة» · «من قالب»; «ركّبها» is the one pressed", () => {
    const out = render(h(NewJob, { people, products, assistant: { on: true, message: DRAFT_NEEDS_KEY } }));
    const seg = out.slice(out.indexOf('aria-label="كيف بدك تعملها"'), out.indexOf('id="q-who"'));
    for (const w of ["ركّبها", "اكتبها بجملة", "من قالب"]) expect(seg).toContain(w);
    expect(count(seg, /checked=""/g)).toBe(1);
    expect(seg).toContain('checked="" value="build"');
  });

  it("«الموقع لحاله» is one of the doers (its jobs are the four recipes); nothing is chosen at first", () => {
    const out = render(h(NewJob, { people, products, assistant: { on: true, message: "" } }));
    const who = out.slice(out.indexOf('id="q-who"'), out.indexOf('id="q-when"'));
    expect(who).toContain('<b class="text-base font-bold">الموقع لحاله</b>');
    expect(who).toContain("وصفات جاهزة");
    expect(count(who, /aria-pressed="true"/g)).toBe(0);
    expect(count(who, /aria-pressed="false"/g)).toBe(3);
    // the first look at the third question is still the blocks (no recipe until the site is chosen)
    expect(out).toContain("شو تعمل؟ خطوة خطوة");
    expect(out).not.toContain("وصفة جاهزة");
  });

  it("the page text says there are three ways", () => {
    const out = render(h(NewJob, { people, products }));
    expect(out).toContain("اعتمد المهمة");
    expect(out).toContain("الأوقات كلها بتوقيت عمّان");
  });
});

describe("the four recipes and their fields", () => {
  const draw = (name: (typeof RECIPES)[number], params?: Record<string, unknown>) => {
    const v = defaultRecipe(name, persons);
    return render(h(RecipeFields, { value: { name, params: params ?? v.params }, onChange: noop, products, people: persons }));
  };

  it("all four are keys, with their words; the pressed one is the recipe in hand", () => {
    const out = draw("stock_alert");
    for (const r of RECIPES) {
      expect(out).toContain(RECIPE_TITLE[r]);
      expect(out).toContain(RECIPE_HINT[r]);
    }
    expect(out).toContain("الموقع بينفّذها لحاله بأرقامه");
    expect(out).toContain("يقرا ← يقارن ← يبلّغ");
    expect(count(out, /aria-pressed="true"/g)).toBe(1);
    expect(out).toMatch(/aria-pressed="true"[^>]*><b class="text-base font-bold">نبّهني لما منتج يقرب يخلص/);
  });

  it("stock_alert: one field — which product (all, or one of the site's)", () => {
    const out = draw("stock_alert");
    expect(count(out, /<select/g)).toBe(1);
    expect(out).toContain("كل المنتجات");
    for (const p of products) expect(out).toContain(p.name);
  });

  it("daily_summary: which day — yesterday (the first) or today so far", () => {
    const out = draw("daily_summary");
    expect(out).toContain("ملخص أي يوم");
    expect(out).toContain("أمس");
    expect(out).toContain("اليوم لهلق");
  });

  it("remind: who (people only, not agents) and the text (at most 200 characters, no customer data)", () => {
    const out = draw("remind");
    expect(out).toContain("مين نذكّر");
    expect(out).toContain("عضو الفريق");
    expect(out).not.toMatch(/<option[^>]*>Claude/);
    expect(count(out, /<option/g)).toBe(2);
    expect(out).toContain("نص التذكير");
    expect(out).toContain('maxLength="200"');
    expect(out).toContain("بلا أرقام هواتف ولا بيانات زبائن");
  });

  it("remind with nobody in the directory says where to add people", () => {
    const out = render(h(RecipeFields, { value: defaultRecipe("remind", []), onChange: noop, products, people: [] }));
    expect(out).toContain("ما في أشخاص بدليل الفريق");
  });

  it("metric_watch: the six numbers, the product, over or under, the limit (a number, with the unit of the chosen one) and the period", () => {
    const out = draw("metric_watch", { metric: "realCost", product: "all", op: "above", limit: 4.5, period: "yesterday" });
    for (const l of ["تكلفة الطلب الحقيقي", "الطلبات الحقيقية", "نسبة التأكيد", "الصرف", "تكلفة المؤكد", "نسبة التسليم (30 يوم)"]) expect(out).toContain(l);
    expect(out).toContain("فوق الحد");
    expect(out).toContain("تحت الحد");
    expect(out).toContain('type="number"');
    expect(out).toContain('value="4.5"');
    expect(out).toContain("الحد ($)");
    for (const p of ["أمس", "اليوم لهلق", "آخر 7 أيام"]) expect(out).toContain(p);
    // a number the money roles hold (profit, margin) is not on the list
    expect(out).not.toMatch(/ربح|هامش/);
  });

  it("what each tile starts with is something the check accepts, or says what to fill in: a person and a limit are the owner's to choose", () => {
    expect(validateRecipe(defaultRecipe("stock_alert", persons))).toEqual({ ok: true });
    expect(validateRecipe(defaultRecipe("daily_summary", persons))).toEqual({ ok: true });
    expect(validateRecipe(defaultRecipe("remind", persons))).toMatchObject({ ok: false, field: "recipe.text" });
    expect(validateRecipe(defaultRecipe("remind", []))).toMatchObject({ ok: false, field: "recipe.person" });
    expect(validateRecipe(defaultRecipe("metric_watch", persons))).toMatchObject({ ok: false, field: "recipe.limit" });
  });
});

describe("«اكتبها بجملة»", () => {
  const write = (on: boolean) => render(h(WriteIt, { on, needsKey: DRAFT_NEEDS_KEY, names: {}, saving: false, onApprove: noop, onEdit: noop }));

  it("with the assistant connected: a box for the sentence, «جهّزها», and a line that nothing goes with a customer's data", () => {
    const out = write(true);
    expect(out).toContain("اكتب المهمة بجملة");
    expect(out).toContain("<textarea");
    expect(out).toContain('maxLength="1000"');
    expect(out).toContain("جهّزها");
    expect(out).toContain("من غير أي رقم هاتف أو بيانات زبون");
    // nothing is offered to approve before there is a draft
    expect(out).not.toContain("اعتمدها");
    expect(out).not.toContain("هيك فهمتها");
  });

  it("without it: the plain sentence that says how to connect it, and a link to where — and no box that would do nothing", () => {
    const out = write(false);
    expect(out).toContain("هاي بدها مفتاح المساعد — اربطه من الإعدادات ← الربط");
    expect(out).toContain("«ركّبها» و«من قالب»");
    expect(out).toContain('href="/settings/connections"');
    expect(out).not.toContain("<textarea");
    expect(out).not.toContain("جهّزها");
  });

  it("the sentence of the setup is the one the server says (one source)", () => {
    expect(render(h(NeedsKey, { message: DRAFT_NEEDS_KEY }))).toContain(DRAFT_NEEDS_KEY.replace(/[«»]/g, (c) => c));
  });
});

describe("a draft that travels from the assistant's card to the screen", () => {
  const draft: JobDraft = { name: "فحص المخزون", domain: "ops", assigneeKey: "claude", when: { kind: "daily", time: "09:30" }, steps: [{ verb: "read", text: "اقرا المخزون" }, { verb: "tell", text: "بلّغني" }], notifyOn: ["stuck", "missed", "failed"] };
  const store = new Map<string, string>();
  const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });

  it("the card leaves the draft, the screen takes it once and forgets it", () => {
    vi.stubGlobal("sessionStorage", fake);
    expect(FROM_ASSISTANT).toBe("?from=assistant");
    expect(leaveJobDraft(draft)).toBe(true);
    expect(store.has(JOB_DRAFT_KEY)).toBe(true);
    expect(takeJobDraft()).toEqual(draft);
    expect(store.has(JOB_DRAFT_KEY)).toBe(false);
    expect(takeJobDraft()).toBeNull();
  });

  it("what is there is checked with the strict schema: anything else is forgotten, never opened", () => {
    vi.stubGlobal("sessionStorage", fake);
    store.set(JOB_DRAFT_KEY, JSON.stringify({ ...draft, steps: [{ verb: "run_shell", text: "x" }] }));
    expect(takeJobDraft()).toBeNull();
    expect(store.has(JOB_DRAFT_KEY)).toBe(false);
    store.set(JOB_DRAFT_KEY, "not json");
    expect(takeJobDraft()).toBeNull();
  });

  it("a browser that will not keep it: the card says so (false), it does not pretend", () => {
    vi.stubGlobal("sessionStorage", { ...fake, setItem: () => { throw new Error("blocked"); } });
    expect(leaveJobDraft(draft)).toBe(false);
    vi.stubGlobal("sessionStorage", { ...fake, getItem: () => { throw new Error("blocked"); } });
    expect(takeJobDraft()).toBeNull();
  });

  it("the card in the panel: the draft's name, its sentence, its steps — «لسا ما انحفظت» — and one button that opens it on «مهمة جديدة»", () => {
    const out = render(h(ArtifactCard, { a: { kind: "job_draft", draft, sentence: "Claude · كل يوم 09:30 · 2 خطوات · بخبّرك لما توقف أو تفوت" }, canDraft: true, onNavigate: noop }));
    expect(out).toContain("مسودة مهمة: فحص المخزون");
    expect(out).toContain("كل يوم 09:30");
    expect(out).toContain("لسا ما انحفظت");
    expect(out).toContain("اقرا: اقرا المخزون");
    expect(out).toContain("بلّغ: بلّغني");
    expect(out).toContain("افتحها بـ«مهمة جديدة» وراجعها");
    expect(count(out, /<button/g)).toBe(1);
  });

  it("the card of a recipe says which recipe, and that the site carries it out itself", () => {
    const rec: JobDraft = { ...draft, assigneeKey: "site", steps: [], recipe: { name: "stock_alert", params: { product: "all" } } };
    const out = render(h(ArtifactCard, { a: { kind: "job_draft", draft: rec, sentence: "الموقع لحاله · كل يوم 09:30 · نبّهني لما منتج يقرب يخلص" }, canDraft: true, onNavigate: noop }));
    expect(out).toContain("وصفة «نبّهني لما منتج يقرب يخلص» — الموقع بينفّذها لحاله");
    expect(out).not.toContain("<ol");
  });
});
