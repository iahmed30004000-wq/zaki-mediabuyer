import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The table element, for a table the kit's `DataTable` cannot be: a tree whose rows open (the campaigns → ad sets → ads), a print sheet, a matrix of switches. `DataTable` is the table of every list
 * of equal rows; this is only the tag, in the kit, so no screen writes `<table>` by hand (docs/rebuild-v6/03-look.md §10: `rawControls`). A table always has a name for a screen reader (`aria-label`).
 */
export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement> & { "aria-label": string }) {
  return <table className={cn("w-full border-collapse text-base", className)} {...props} />;
}
