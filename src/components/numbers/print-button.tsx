"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** On a phone «طباعة» offers «حفظ كـ PDF» — that is the PDF of the day. Hidden on the paper itself. */
export function PrintButton() {
  return (
    <Button variant="primary" size="sm" onClick={() => window.print()} className="print:hidden">
      <Printer className="size-4" />
      احفظ كـ PDF
    </Button>
  );
}
