/**
 * How a job draft the assistant made in its panel reaches «مهمة جديدة» (v6 · P4-2): the card puts it in the browser's session storage under this key and opens the screen with `?from=assistant`;
 * the screen reads it once, checks it with the same strict schema as everything that comes from outside, fills the form with it, and forgets it. Nothing here goes to the server, and nothing is saved.
 */
import { JobDraftSchema, type JobDraft } from "@/core/job-draft";

export const JOB_DRAFT_KEY = "mb:job-draft";
export const FROM_ASSISTANT = "?from=assistant";

/** Leaves a draft for the screen. False when the browser would not keep it. */
export function leaveJobDraft(draft: JobDraft): boolean {
  try {
    sessionStorage.setItem(JOB_DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

/** Takes the draft the assistant left (and forgets it). Null when there is none, or what is there is not a draft. */
export function takeJobDraft(): JobDraft | null {
  try {
    const raw = sessionStorage.getItem(JOB_DRAFT_KEY);
    sessionStorage.removeItem(JOB_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JobDraftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as JobDraft) : null;
  } catch {
    return null;
  }
}
