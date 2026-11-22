"use client";

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A label, the control, a helper line and an error — wired together (`htmlFor`, `aria-describedby`, `aria-invalid`).
 * Pass ONE control as the child (`Input`, `Select`, `Textarea`); it gets the id and the aria attributes.
 */
export function Field({ label, hint, error, required, children, className }: { label: string; hint?: string; error?: string | null; required?: boolean; children: ReactNode; className?: string }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [hint ? hintId : "", error ? errId : ""].filter(Boolean).join(" ") || undefined;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, { id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined, required })
    : children;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-base font-semibold text-fg">
        {label}
        {required ? <span aria-hidden className="ms-1 text-danger">*</span> : null}
      </label>
      {control}
      {hint ? (
        <p id={hintId} className="text-sm text-fg-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errId} role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
