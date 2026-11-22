/**
 * What the team's tasks board reads of the owner's layout (v3 · K, cut down in v6 · P8 by Q5): its boards and fields, and the values typed into them. The rules are
 * src/core/customize.ts; this only gathers.
 */
import { activeFields, effectiveBoards, type EffBoard, type FieldCfgT } from "@/core/customize";
import { getValues, type ValueMap } from "@/server/customize";
import { getUiConfig } from "@/server/ui-config";

export interface TasksCustom {
  /** every board not put away (the hidden ones are flagged: the panel still shows them) */
  boards: EffBoard[];
  /** the fields a card may show (not hidden, not put away); each says which boards it is on */
  fields: FieldCfgT[];
  values: ValueMap;
}

export async function loadTasksCustom(taskIds: string[]): Promise<TasksCustom> {
  const cfg = await getUiConfig();
  return {
    boards: effectiveBoards(cfg).filter((b) => !b.archived),
    fields: activeFields(cfg, "task").filter((f) => !f.hidden),
    values: await getValues("task", taskIds),
  };
}
