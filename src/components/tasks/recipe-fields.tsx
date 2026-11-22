"use client";

import { ChoiceTile } from "@/components/ui/choice-tile";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import {
  ALL_PRODUCTS,
  OPS,
  OP_AR,
  PERIODS,
  PERIOD_AR,
  RECIPES,
  RECIPE_HINT,
  RECIPE_TITLE,
  WATCH_METRICS,
  canWatch,
  watchMetric,
  type RecipeName,
} from "@/core/recipes";

/** The answer of the question «شو تعمل؟» when the site does it by itself (docs/rebuild-v6/02-screens.md §3.7): one of the four recipes and the few fields it needs. */
export type RecipeValue = { name: RecipeName; params: Record<string, unknown> };

export interface RecipeProduct {
  code: string;
  name: string;
}
export interface RecipePerson {
  key: string;
  name: string;
}

/** The parameters a recipe starts with when its tile is pressed: something sound where one exists, empty where the owner must choose (a person, a limit). */
export function defaultRecipe(name: RecipeName, people: readonly RecipePerson[]): RecipeValue {
  switch (name) {
    case "stock_alert":
      return { name, params: { product: ALL_PRODUCTS } };
    case "daily_summary":
      return { name, params: { period: "yesterday" } };
    case "remind":
      return { name, params: { person: people[0]?.key ?? "", text: "" } };
    case "metric_watch":
      return { name, params: { metric: WATCH_METRICS[0]!.key, product: ALL_PRODUCTS, op: "above", limit: "", period: "yesterday" } };
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

function ProductSelect({ value, products, onChange, label = "المنتج" }: { value: string; products: readonly RecipeProduct[]; onChange: (v: string) => void; label?: string }) {
  return (
    <Field label={label} className="min-w-44 flex-1">
      <Select value={value || ALL_PRODUCTS} onChange={(e) => onChange(e.target.value)}>
        <option value={ALL_PRODUCTS}>كل المنتجات</option>
        {products.map((p) => (
          <option key={p.code} value={p.code}>
            {p.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/**
 * The four recipes as big keys, and under the one that is pressed, its fields. It only draws and reports — the draft is the parent's, and the checks are `validateRecipe` (src/core/recipes.ts) which
 * the parent runs on every press of «اعتمد المهمة»; the numbers a recipe watches and the limits it compares with are the code's, never typed as an answer.
 */
export function RecipeFields({ value, onChange, products, people }: { value: RecipeValue; onChange: (v: RecipeValue) => void; products: readonly RecipeProduct[]; people: readonly RecipePerson[] }) {
  const p = value.params;
  const set = (patch: Record<string, unknown>) => onChange({ name: value.name, params: { ...p, ...patch } });
  const metric = watchMetric(str(p.metric));
  return (
    <div className="space-y-4">
      <p className="text-base text-fg-muted">الموقع بينفّذها لحاله بأرقامه، بلا ما يحتاج Claude. خطواتها ثلاثة ثابتة: يقرا ← يقارن ← يبلّغ.</p>
      <div role="group" aria-label="وصفات الموقع" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {RECIPES.map((r) => (
          <ChoiceTile key={r} title={RECIPE_TITLE[r]} hint={RECIPE_HINT[r]} pressed={value.name === r} onClick={() => (value.name === r ? undefined : onChange(defaultRecipe(r, people)))} />
        ))}
      </div>

      {value.name === "stock_alert" ? (
        <div className="flex flex-wrap gap-3">
          <ProductSelect value={str(p.product)} products={products} onChange={(product) => set({ product })} />
        </div>
      ) : null}

      {value.name === "daily_summary" ? (
        <div className="space-y-1.5">
          <span className="block text-base font-semibold text-fg">ملخص أي يوم</span>
          <Segmented
            label="ملخص أي يوم"
            value={str(p.period) === "today" ? "today" : "yesterday"}
            onChange={(period) => set({ period })}
            options={[
              { value: "yesterday", label: "أمس" },
              { value: "today", label: "اليوم لهلق" },
            ]}
          />
        </div>
      ) : null}

      {value.name === "remind" ? (
        <div className="flex flex-wrap gap-3">
          <Field label="مين نذكّر" className="min-w-44 flex-1">
            {people.length ? (
              <Select value={str(p.person)} onChange={(e) => set({ person: e.target.value })}>
                <option value="">اختار شخص</option>
                {people.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.name}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="text-base text-fg-muted">ما في أشخاص بدليل الفريق — ضيفهم من الإعدادات ← الفريق.</p>
            )}
          </Field>
          <Field label="نص التذكير" hint="بلا أرقام هواتف ولا بيانات زبائن" className="min-w-64 flex-[2]">
            <Input value={str(p.text)} maxLength={200} onChange={(e) => set({ text: e.target.value })} />
          </Field>
        </div>
      ) : null}

      {value.name === "metric_watch" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <Field label="أي رقم" className="min-w-52 flex-1">
              <Select value={str(p.metric)} onChange={(e) => set({ metric: e.target.value })}>
                {WATCH_METRICS.filter((m) => canWatch(m.key, str(p.product) || ALL_PRODUCTS)).map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
            <ProductSelect
              value={str(p.product)}
              products={products}
              // a number that only a single product has can not follow «كل المنتجات»: the number goes back to the first of the list
              onChange={(product) => set(canWatch(str(p.metric), product) ? { product } : { product, metric: WATCH_METRICS[0]!.key })}
            />
          </div>
          <div className="space-y-1.5">
            <span className="block text-base font-semibold text-fg">متى أنبّهك</span>
            <Segmented label="فوق الحد ولا تحته" value={str(p.op) === "below" ? "below" : "above"} onChange={(op) => set({ op })} options={OPS.map((o) => ({ value: o, label: `${OP_AR[o]} الحد` }))} />
          </div>
          <div className="flex flex-wrap gap-3">
            <Field label={`الحد${metric?.unit ? ` (${metric.unit})` : ""}`} className="min-w-36 flex-1">
              <Input type="number" inputMode="decimal" dir="ltr" min={0} step="any" value={str(p.limit)} onChange={(e) => set({ limit: e.target.value === "" ? "" : Number(e.target.value) })} />
            </Field>
            <Field label="على أي فترة" className="min-w-44 flex-1">
              <Select value={str(p.period) || "yesterday"} onChange={(e) => set({ period: e.target.value })}>
                {PERIODS.map((x) => (
                  <option key={x} value={x}>
                    {PERIOD_AR[x]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      ) : null}
    </div>
  );
}
