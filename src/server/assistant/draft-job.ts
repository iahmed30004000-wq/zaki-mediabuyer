/**
 * «اكتبها بجملة» (v6 · P4-2, docs/rebuild-v6/02-screens.md §3.7): the owner writes the job in a sentence, the assistant turns it into a draft — through the ONE tool `draft_job`, whose input is the
 * strict schema of `JobDraft` and whose checks are the same as «مهمة جديدة»'s own — and the screen shows «هيك فهمتها — صح؟». Nothing is saved here: the owner presses «اعتمدها», which is the same
 * `POST /api/jobs` as every other way of making a job. The model never sees a customer, a token or a phone number (the sentence goes through the privacy filter, like every question), and
 * never touches Meta: the tool it has makes a card, nothing else.
 */
import { allowedTools, draftJobPrompt } from "@/core/assistant";
import type { JobDraft } from "@/core/job-draft";
import type { Caller } from "../auth";
import { AssistantError, runAssistant, type AskHooks } from "./index";
import { defaultDeps, makeTools, type ToolDeps } from "./tools";

export interface DraftJobResult {
  /** the draft, when the model made one that passed the checks */
  draft: JobDraft | null;
  /** the draft in one sentence («الموقع لحاله · كل يوم 09:30 · …») */
  sentence: string | null;
  /** the model's own words: a question when something was missing, a line when it made the draft */
  say: string;
  model: string;
  costUsd: number;
}

export interface DraftJobHooks extends AskHooks {
  /** stand-ins for the directory and the products (tests) */
  deps?: Partial<ToolDeps>;
}

export async function draftJobFromSentence(sentence: string, caller: Caller, hooks: DraftJobHooks = {}): Promise<DraftJobResult> {
  const now = hooks.now ?? new Date();
  const deps: ToolDeps = { ...defaultDeps, ...(hooks.deps ?? {}) };
  const tools = allowedTools((hooks.tools ?? makeTools(hooks.deps)).filter((t) => t.name === "draft_job"), caller.role);
  if (!tools.length) throw new AssistantError(403, "دورك ما بيسمح بإنشاء مهمة", "off");
  const team = (await deps.directory()).filter((e) => e.active).map((e) => ({ key: e.key, name: e.name, kind: e.kind }));
  const reply = await runAssistant({ question: sentence, history: [], place: null, system: (products) => draftJobPrompt({ now, team, products }), tools }, caller, hooks);
  const made = reply.artifacts.filter((a): a is Extract<(typeof reply.artifacts)[number], { kind: "job_draft" }> => a.kind === "job_draft").at(-1);
  return { draft: made?.draft ?? null, sentence: made?.sentence ?? null, say: reply.answer, model: reply.model, costUsd: reply.costUsd };
}
