/**
 * What a recipe needs from outside, as plain values (docs/rebuild-v6/01-model.md §9). The real implementation reads the database and the screens' own loaders (`realRecipeDeps`, in index.ts);
 * a test hands in stand-ins. Nothing in here carries a customer's name, phone or address: the stock, the numbers of the day and the names of the team are all a recipe ever reads.
 */
import type { KnownProduct, StockReading } from "@/core/recipes";
import type { NumbersSet } from "@/core/numbers";
import type { StockThresholds } from "@/core/stock-alerts";

/** A number that could not be read at all (the source is down, or the site is a demo): the step fails with this sentence. */
export class RecipeDataMissing extends Error {}

export interface NumbersPeriod {
  /** the period as the numbers screen names it: «أمس» */
  label: string;
  totals: NumbersSet;
  prev: NumbersSet;
  products: { code: string; name: string; current: NumbersSet }[];
}

export interface RecipePerson {
  key: string;
  name: string;
  active: boolean;
  kind: "agent" | "person";
  hasTelegram: boolean;
}

export interface RecipeDeps {
  products(): Promise<KnownProduct[]>;
  /** the newest reading of the stock of each product */
  stockReadings(): Promise<StockReading[]>;
  /** the owner's limits (`campaign.rules.stock`) and who is told */
  stockRules(): Promise<{ limits: StockThresholds; audience: string[] }>;
  numbers(period: "today" | "yesterday" | "7d", now: Date): Promise<NumbersPeriod>;
  person(key: string): Promise<RecipePerson | null>;
  /** send a written notice the way every notice is sent (it never throws) */
  dispatch(notificationId: string): Promise<void>;
}

/** Everything one run of a recipe knows about itself. */
export interface RecipeRunCtx {
  jobKey: string;
  jobName: string;
  ref: string;
  now: Date;
  /** the address of the run's page (a notice opens it) */
  runHref: string;
  /** the job's `recipeParams` as stored; each recipe reads them with `parseRecipeParams` */
  params: unknown;
}
