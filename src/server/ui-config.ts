/**
 * The owner's layout (v3 · K) as the rest of the server reads it: one document, the setting `ui.config`. It lives apart from
 * src/server/customize.ts (which edits it, and reads tasks) so that the task service can ask «which board does this key mean now?»
 * without a cycle.
 */
import { UiConfigSchema, boardWords, emptyUi, resolveBoard, type UiConfig } from "@/core/customize";
import { getSetting } from "./settings";

/** The config as stored; anything that does not read (or a database that does not answer) is the empty one — the screens then show the built-ins. */
export async function getUiConfig(): Promise<UiConfig> {
  try {
    const raw = await getSetting("ui.config");
    const r = UiConfigSchema.safeParse(raw);
    if (r.success) return r.data;
    // a document that does not read must be SEEN: the built-ins show meanwhile, and an edit would start from them
    console.error("[ui] the setting ui.config does not read — showing the built-in pages and boards", r.error.issues.slice(0, 3));
    return emptyUi();
  } catch {
    return emptyUi();
  }
}

/** A board key as tasks keep it: a board that was merged into another is that other (so a task made for the old key lands where its tasks went). */
export async function resolveBoardKey(key: string): Promise<string> {
  return resolveBoard(await getUiConfig(), key);
}

/** `#word` of a quick add → board key, for every active board (its label with spaces as «_», or its key). */
export async function quickAddBoardWords(): Promise<Record<string, string>> {
  return boardWords(await getUiConfig());
}
