/**
 * The boards and fields of the team's tasks (v3 · K; cut down in v6 · P8 by Q5), the server side. The owner's changes are ops (src/core/customize.ts `UiOpSchema`); each one is a pure
 * function over the config PLUS, where it touches data, work done in the very same transaction — a merge of two boards moves
 * their tasks while it rewrites the config (both happen or neither does), a merge of two fields copies the values, archiving a
 * board or a field first counts what still uses it. The setting is changed under a lock (two edits at once wait for each other),
 * and every version of it is kept: a bad edit can be put back from the setting's history.
 *
 * What a person types into a field is the card's business (`setValues`: the same capability as editing the card).
 */
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  LIMITS, convertField, moveBoardTo, moveFieldTo, addBoard, addField, archiveBoard, archiveField, effectiveBoards, fieldsFor, mergeBoards, mergeFields,
  moveBoard, moveField, parseUiConfig, renameBoard, restoreBoard, restoreField, setBoardHidden,
  suggestMerges, templateById, updateField, validateValue,
  type EffBoard, type Entity, type FieldCfgT, type Suggestion, type UiConfig, type UiEdit, type UiOp,
} from "@/core/customize";
import { duplicateGroups } from "@/core/tasks";
import { audit } from "./audit";
import { HttpError, type Caller } from "./auth";
import { db } from "./db";
import { mutateSetting } from "./settings";
import { directoryKeys } from "./directory";
import { listTasks } from "./tasks";
import { getUiConfig } from "./ui-config";

const newId = (prefix: string) => `${prefix}-${randomBytes(3).toString("hex")}`;

export interface Effects {
  /** tasks a board merge moved · values a field merge copied, and how many cards had a value in both · tasks an undone merge sent back */
  moved?: number;
  copied?: number;
  conflicts?: number;
  movedBack?: number;
  /** values a field's change of type rewrote */
  converted?: number;
}

/** One op: the pure edit, and the data work that goes with it inside the same transaction. */
async function runOp(cfg: UiConfig, op: UiOp, tx: Prisma.TransactionClient, by: string, now: string, fx: Effects): Promise<UiEdit> {
  switch (op.op) {
    case "board.add":
      return addBoard(cfg, { id: newId("bd"), label: op.label, template: op.template, fieldIds: (templateById(op.template ?? "blank")?.fields ?? []).map(() => newId("f")) });
    case "board.rename":
      return renameBoard(cfg, op.key, op.label);
    case "board.hide":
      return setBoardHidden(cfg, op.key, op.hidden);
    case "board.move":
      return moveBoard(cfg, op.key, op.dir);
    case "board.drop":
      return moveBoardTo(cfg, op.key, op.onto);
    case "board.archive":
      // every task that still sits on it counts, the archived ones too: a board with any is merged, not put away
      return archiveBoard(cfg, op.key, await tx.task.count({ where: { board: op.key } }), now);
    case "board.restore": {
      const e = restoreBoard(cfg, op.key);
      if (e.ok && e.moveBack) fx.movedBack = (await tx.task.updateMany({ where: { id: { in: e.moveBack.ids }, board: e.moveBack.into }, data: { board: e.moveBack.from } })).count;
      return e;
    }
    case "board.merge": {
      const rows = await tx.task.findMany({ where: { board: op.from }, select: { id: true }, orderBy: { createdAt: "asc" }, take: LIMITS.moved + 1 });
      const count = rows.length <= LIMITS.moved ? rows.length : await tx.task.count({ where: { board: op.from } });
      const e = mergeBoards(cfg, { from: op.from, into: op.into, taskIds: rows.slice(0, LIMITS.moved).map((r) => r.id), taskCount: count }, now);
      if (e.ok) fx.moved = (await tx.task.updateMany({ where: { board: op.from }, data: { board: op.into } })).count;
      return e;
    }

    case "field.add":
      return addField(cfg, { id: newId("f"), entity: op.entity, label: op.label, type: op.type, options: op.options, boards: op.boards ?? undefined, onCard: op.onCard });
    case "field.update":
      return updateField(cfg, op.id, { label: op.label, options: op.options, boards: op.boards, onCard: op.onCard, hidden: op.hidden });
    case "field.move":
      return moveField(cfg, op.id, op.dir);
    case "field.drop":
      return moveFieldTo(cfg, op.id, op.onto);
    case "field.convert": {
      const stored = await tx.customValue.findMany({ where: { fieldId: op.id }, select: { entity: true, entityId: true, value: true } });
      const e = convertField(cfg, op.id, op.to, stored.map((r) => r.value), op.options);
      if (e.ok && e.convert) {
        // every stored value is rewritten the way the new type keeps it («12» text → 12), in this same transaction
        const field = e.config.fields.find((f) => f.id === op.id)!;
        let n = 0;
        for (const r of stored) {
          const v = validateValue(field, r.value, await directoryKeys());
          if (v.ok && v.value !== null) {
            await tx.customValue.update({ where: { entity_entityId_fieldId: { entity: r.entity, entityId: r.entityId, fieldId: op.id } }, data: { value: v.value, updatedBy: by } });
            n++;
          }
        }
        fx.converted = n;
      }
      return e;
    }
    case "field.archive":
      return archiveField(cfg, op.id, await tx.customValue.count({ where: { fieldId: op.id } }), now);
    case "field.restore":
      return restoreField(cfg, op.id);
    case "field.merge": {
      const e = mergeFields(cfg, op.from, op.into, now);
      if (e.ok) {
        // its values are COPIED to the cards that have none for the other field; the first field keeps its own, so nothing is lost
        fx.copied = await tx.$executeRaw`INSERT INTO "CustomValue" ("entity","entityId","fieldId","value","updatedBy","updatedAt") SELECT "entity","entityId",${op.into},"value",${by},now() FROM "CustomValue" WHERE "fieldId" = ${op.from} ON CONFLICT ("entity","entityId","fieldId") DO NOTHING`;
        const clash = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "CustomValue" a JOIN "CustomValue" b ON a."entity" = b."entity" AND a."entityId" = b."entityId" AND b."fieldId" = ${op.into} WHERE a."fieldId" = ${op.from} AND a."value" <> b."value"`;
        fx.conflicts = clash[0]?.n ?? 0;
      }
      return e;
    }
  }
}

export interface OpResult extends Effects {
  note: string;
  version: number;
  config: UiConfig;
}

/** Applies one op for the owner. A refusal is a 400 with the reason in words, and nothing changes (the transaction rolls back). */
export async function applyOp(op: UiOp, caller: Caller): Promise<OpResult> {
  const now = new Date().toISOString();
  const fx: Effects = {};
  const out = await mutateSetting(
    "ui.config",
    async (raw, tx) => {
      const edit = await runOp(parseUiConfig(raw), op, tx, caller.id, now, fx);
      if (!edit.ok) throw new HttpError(400, edit.error);
      return { value: edit.config, result: edit.note };
    },
    caller.id,
  );
  if (!out) throw new HttpError(500, "ما انحفظ التعديل");
  await audit({ type: "user", id: caller.id }, `ui.${op.op}`, { type: "setting", id: "ui.config" }, { after: { note: out.result, ...fx } });
  return { note: out.result, version: out.version, config: out.value, ...fx };
}

// ───────────────────────────── what the panel shows ─────────────────────────────

export interface PanelData {
  boards: (EffBoard & { tasks: number })[];
  fields: (FieldCfgT & { values: number })[];
  suggestions: Suggestion[];
}

/** The owner's whole layout with what each part is used for (tasks on a board, values in a field) and the merges worth doing. */
export async function panelData(): Promise<PanelData> {
  const cfg = await getUiConfig();
  const [byBoard, byField, tasks] = await Promise.all([
    db.task.groupBy({ by: ["board"], where: { archivedAt: null }, _count: { _all: true } }),
    db.customValue.groupBy({ by: ["fieldId"], _count: { _all: true } }),
    listTasks({ limit: 300, doneWithinDays: 14 }),
  ]);
  const boardTasks = Object.fromEntries(byBoard.map((b) => [b.board, b._count._all]));
  const fieldValues = Object.fromEntries(byField.map((f) => [f.fieldId, f._count._all]));
  return {
    boards: effectiveBoards(cfg).map((b) => ({ ...b, tasks: boardTasks[b.key] ?? 0 })),
    fields: cfg.fields.map((f) => ({ ...f, values: fieldValues[f.id] ?? 0 })),
    suggestions: suggestMerges({ cfg, boardTasks, fieldValues, taskGroups: duplicateGroups(tasks).length }),
  };
}

// ───────────────────────────── the cards ─────────────────────────────

interface CardInfo {
  /** a task's board (fields can be scoped to it) */
  board?: string;
}

/** The card a field value is about: a task that is not put away (the team's tasks are the only cards with fields). */
async function cardOf(entity: Entity, id: string): Promise<CardInfo> {
  if (entity !== "task") throw new HttpError(400, "الحقول للمهام بس");
  const t = await db.task.findUnique({ where: { id } });
  if (!t || t.archivedAt) throw new HttpError(404, "المهمة مش موجودة");
  return { board: t.board };
}

// ───────────────────────────── the values on the cards ─────────────────────────────

/** card id → field id → value */
export type ValueMap = Record<string, Record<string, string | number>>;

export async function getValues(entity: Entity, ids: string[]): Promise<ValueMap> {
  if (!ids.length) return {};
  const rows = await db.customValue.findMany({ where: { entity, entityId: { in: ids } } });
  const out: ValueMap = {};
  for (const r of rows) (out[r.entityId] ??= {})[r.fieldId] = r.value as string | number;
  return out;
}

/**
 * Writes what a person typed into a card's fields: each value is checked against its field (type, options, no customer data), a
 * field that is hidden, put away, or not on the card's board is refused, and an empty value clears. Returns the card's values.
 */
export async function setValues(entity: Entity, entityId: string, input: Record<string, unknown>, caller: Caller): Promise<Record<string, string | number>> {
  const cfg = await getUiConfig();
  const card = await cardOf(entity, entityId);
  const board = card.board;
  const allowed = new Map(fieldsFor(cfg, entity, board).map((f) => [f.id, f]));
  const writes: { fieldId: string; value: string | number | null }[] = [];
  for (const [fieldId, raw] of Object.entries(input)) {
    const f = allowed.get(fieldId);
    if (!f) throw new HttpError(400, "حقل مش معروف أو مخفي أو مش على هاللوحة");
    const v = validateValue(f, raw, await directoryKeys());
    if (!v.ok) throw new HttpError(400, v.error);
    writes.push({ fieldId, value: v.value });
  }
  await db.$transaction([
    ...writes.map((w) =>
      w.value === null
        ? db.customValue.deleteMany({ where: { entity, entityId, fieldId: w.fieldId } })
        : db.customValue.upsert({ where: { entity_entityId_fieldId: { entity, entityId, fieldId: w.fieldId } }, create: { entity, entityId, fieldId: w.fieldId, value: w.value, updatedBy: caller.id }, update: { value: w.value, updatedBy: caller.id } }),
    ),
  ]);
  if (writes.length) await audit({ type: "user", id: caller.id }, "ui.value.set", { type: entity, id: entityId }, { after: Object.fromEntries(writes.map((w) => [w.fieldId, w.value])) });
  return (await getValues(entity, [entityId]))[entityId] ?? {};
}
