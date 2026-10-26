"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/** The sign-in card. On a brand-new system it says so, and the first sign-in creates the owner. */
export function LoginForm({ next }: { next: string }) {
  const [first, setFirst] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState<string | null>(null);
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
        const r = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, ...(invite ? { invite } : {}) }) });
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        setBusy(false);
        if (r.ok) location.href = next;
        else setError(d.error ?? "صار خطأ");
      }}
    >
      <div>
        <h1 className="text-lg font-bold text-fg">{first ? "اعمل حساب المالك" : invite !== null ? "أول دخول بدعوة" : "أهلين"}</h1>
        <p className="text-xs text-fg-muted">{first ? "أول مرة: الإيميل وكلمة السر اللي بتكتبهم هلأ بيصيروا حساب المالك." : invite !== null ? "اكتب الرمز اللي أعطاك ياه المالك، واختار كلمة سرك (8 أحرف على الأقل). الرمز بينفع مرة وحدة." : "سجّل دخول لتكمّل."}</p>
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-muted">الإيميل</span>
        <input type="email" dir="ltr" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-fg" />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-muted">{invite !== null ? "كلمة سرك الجديدة" : "كلمة السر"} {first || invite !== null ? "(8 أحرف على الأقل)" : ""}</span>
        <input type="password" dir="ltr" autoComplete={first || invite !== null ? "new-password" : "current-password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-fg" />
      </label>
      {invite !== null ? (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-muted">رمز الدعوة</span>
          <input dir="ltr" autoComplete="one-time-code" required placeholder="XXXX-XXXX-XXXX-XXXX" value={invite} onChange={(e) => setInvite(e.target.value.toUpperCase())} className="h-11 w-full rounded-lg border border-border bg-surface px-3 font-mono tracking-wider text-fg" />
        </label>
      ) : null}
      {error ? <p className="rounded-lg bg-danger/10 p-2 text-sm text-danger">{error}</p> : null}
      <Button type="submit" disabled={busy} className="h-11 w-full">
        {first ? "اعمل الحساب وادخل" : invite !== null ? "ثبّت كلمة السر وادخل" : "ادخل"}
      </Button>
      {!first ? (
        <button type="button" onClick={() => setInvite(invite === null ? "" : null)} className="w-full text-center text-xs text-accent hover:underline">
          {invite === null ? "عندي رمز دعوة من المالك" : "عندي كلمة سر — رجّعني"}
        </button>
      ) : null}
    </form>
  );
}
