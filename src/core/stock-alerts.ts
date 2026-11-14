/**
 * STOCK ALERTS (v4 · F rule 9) — days of cover against the owner's thresholds: 🔴 under the first, 🟠 up to the second,
 * 🟡 up to the third. The thresholds are rules (editable); nothing here is a number of the owner's money. Pure.
 */
import type { Urgency } from "./mode";

export interface StockThresholds {
  redDays: number;
  orangeDays: number;
  yellowDays: number;
}

export function stockUrgency(daysCover: number, t: StockThresholds): Urgency | null {
  if (daysCover < t.redDays) return "red";
  if (daysCover < t.orangeDays) return "orange";
  if (daysCover < t.yellowDays) return "yellow";
  return null;
}

const ICON: Record<Urgency, string> = { red: "🔴", orange: "🟠", yellow: "🟡" };

export function stockAlertText(product: string, daysCover: number, urgency: Urgency, units?: number | null): { title: string; body: string } {
  const d = Math.round(daysCover * 10) / 10;
  return {
    title: `${ICON[urgency]} مخزون ${product}: بيكفي ${d} يوم`,
    body: `${units != null ? `${units} قطعة · ` : ""}التغطية ${d} يوم بمعدل البيع الحالي${urgency === "red" ? " — لازم قرار اليوم (تصنيع أو توريد)" : ""}.`,
  };
}

/** One alert per product, per level, per day: the same reading again does not raise it again. */
export function stockAlertKey(product: string, urgency: Urgency, dayKey: string): string {
  return `stock:${product}:${urgency}:${dayKey}`;
}
