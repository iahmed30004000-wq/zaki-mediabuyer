"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "./button";

/** What a block says when it could not load: what happened in a sentence, and a retry. Never a stack trace, never a blank. */
export function ErrorState({ title = "ما قدرت أحمّل هالجزء", hint, onRetry }: { title?: string; hint?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-card border border-danger/30 bg-danger/10 p-6 text-center">
      <AlertTriangle aria-hidden className="size-6 text-danger" />
      <p className="text-base font-bold text-fg">{title}</p>
      {hint ? <p className="text-sm text-fg-muted">{hint}</p> : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          جرّب كمان مرة
        </Button>
      ) : null}
    </div>
  );
}
