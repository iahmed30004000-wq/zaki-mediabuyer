"use client";

import { Printer } from "lucide-react";

/** On a phone «طباعة» offers «حفظ كـ PDF» — that is the PDF of the day. Hidden on the paper itself. */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-black px-5 text-sm font-semibold text-white print:hidden">
      <Printer className="size-4" />
      احفظ كـ PDF
    </button>
  );
}
