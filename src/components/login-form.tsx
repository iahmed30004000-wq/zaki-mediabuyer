"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/** The sign-in card. On a brand-new system it says so, and the first sign-in creates the owner. */
export function LoginForm({ next }: { next: string }) {
  const [first, setFirst] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/login").then((r) => r.json()).then((d: { hasUsers: boolean }) => setFirst(!d.hasUsers)).catch(() => {});
  }, []);

  return (
    <form
      className="space-y-3 rounded-card border border-border bg-surface-1 p-5 shadow-card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const r = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        setBusy(false);
        if (r.ok) location.href = next;
        else setError(d.error ?? "صار خطأ");
      }}
    >
      <div>
        <h1 className="text-lg font-bold text-fg">{first ? "اعمل حساب المالك" : "أهلين"}</h1>
        <p className="text-xs text-fg-muted">{first ? "أول مرة: الإيميل وكلمة السر اللي بتكتبهم هلأ بيصيروا حساب المالك." : "سجّل دخول لتكمّل."}</p>
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-muted">الإيميل</span>
        <input type="email" dir="ltr" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-fg" />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-muted">كلمة السر {first ? "(8 أحرف على الأقل)" : ""}</span>
        <input type="password" dir="ltr" autoComplete={first ? "new-password" : "current-password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-fg" />
      </label>
      {error ? <p className="rounded-lg bg-danger/10 p-2 text-sm text-danger">{error}</p> : null}
      <Button type="submit" disabled={busy} className="h-11 w-full">
        {first ? "اعمل الحساب وادخل" : "ادخل"}
      </Button>
    </form>
  );
}
