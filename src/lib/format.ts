/** How a number is written: English digits, fixed width (spec 18.1), its unit, «—» when there is not enough. Server and client. */
export function fmt(value: number | null | undefined, unit: "$" | "%" | "x" | "" = "", digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const d = unit === "%" ? 1 : unit === "" ? 0 : digits;
  const n = value.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  if (unit === "$") return `${n}$`;
  if (unit === "%") return `${n}%`;
  if (unit === "x") return `×${n}`;
  return n;
}

/** A figure with an EXACT number of decimals whatever its unit (`fmt` writes a plain count and a percentage with a fixed few): «402$» · «4.7» · «118». */
export function fmtExact(value: number | null | undefined, unit: "$" | "%" | "x" | "", digits: number): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const n = value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return unit === "$" ? `${n}$` : unit === "%" ? `${n}%` : unit === "x" ? `×${n}` : n;
}
