"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 max-md:h-11 w-full rounded-lg border border-border bg-surface-1 px-3 text-base text-fg placeholder:text-muted transition-colors focus:border-accent disabled:opacity-[.45] aria-[invalid=true]:border-danger",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-base text-fg placeholder:text-muted transition-colors focus:border-accent aria-[invalid=true]:border-danger",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-10 max-md:h-11 w-full rounded-lg border border-border bg-surface-1 px-2 text-base text-fg disabled:opacity-[.45] aria-[invalid=true]:border-danger",
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = "Select";

export function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("mb-1 block text-xs font-medium text-fg-muted", className)}>{children}</span>;
}
