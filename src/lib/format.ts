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
