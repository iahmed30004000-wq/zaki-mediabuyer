/**
 * What the screens read of the owner's layout (v3 · K): the pages of the sidebar, and what the tasks board needs to draw its
 * boards, fields and buttons. The rules are src/core/customize.ts; this only gathers (and never lets a database that does not
 * answer take the shell down: the built-ins are the fallback).
 */
import { activeFields, effectiveBoards, effectivePages, type ButtonCfgT, type EffBoard, type EffPage, type FieldCfgT } from "@/core/customize";
import { getValues, type ValueMap } from "@/server/customize";
import { getUiConfig } from "@/server/ui-config";
import { BUILTIN_PAGES } from "./nav";

export async function loadPages(): Promise<EffPage[]> {
  return effectivePages(await getUiConfig(), BUILTIN_PAGES);
}

export interface TasksCustom {
  /** every board not put away (the hidden ones are flagged: the edit mode still shows them) */
  boards: EffBoard[];
  /** the fields a card may show (not hidden, not put away); each says which boards it is on */
  fields: FieldCfgT[];
  buttons: ButtonCfgT[];
  values: ValueMap;
}

export async function loadTasksCustom(taskIds: string[]): Promise<TasksCustom> {
  const cfg = await getUiConfig();
  return {
    boards: effectiveBoards(cfg).filter((b) => !b.archived),
    fields: activeFields(cfg, "task").filter((f) => !f.hidden),
    buttons: cfg.buttons.filter((b) => b.entity === "task" && !b.archivedAt && !b.hidden),
    values: await getValues("task", taskIds),
  };
}
