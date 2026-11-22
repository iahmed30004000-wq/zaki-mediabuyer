"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { safeNext } from "@/core/auth-guards";
import { safeFetch } from "@/lib/call";
import { Input } from "@/components/ui/input";

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
        const r = await safeFetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, ...(invite ? { invite } : {}) }) });
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        setBusy(false);
        if (r.ok) location.href = safeNext(next);
        else setError(d.error ?? "صار خطأ");
      }}
    >
      <div>
        <h1 className="text-base font-bold text-fg">{first ? "اعمل حساب المالك" : invite !== null ? "أول دخول بدعوة" : "أهلين"}</h1>
        <p className="text-sm text-fg-muted">{first ? "أول مرة: الإيميل وكلمة السر اللي بتكتبهم هلأ بيصيروا حساب المالك." : invite !== null ? "اكتب الرمز اللي أعطاك ياه المالك، واختار كلمة سرك (8 أحرف على الأقل). الرمز بينفع مرة وحدة." : "سجّل دخول لتكمّل."}</p>
      </div>
      <label className="block space-y-1">
        <span className="text-sm font-medium text-fg-muted">الإيميل</span>
        <Input type="email" dir="ltr" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium text-fg-muted">{invite !== null ? "كلمة سرك الجديدة" : "كلمة السر"} {first || invite !== null ? "(8 أحرف على الأقل)" : ""}</span>
        <Input type="password" dir="ltr" autoComplete={first || invite !== null ? "new-password" : "current-password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {invite !== null ? (
        <label className="block space-y-1">
          <span className="text-sm font-medium text-fg-muted">رمز الدعوة</span>
          <Input dir="ltr" autoComplete="one-time-code" required placeholder="XXXX-XXXX-XXXX-XXXX" value={invite} onChange={(e) => setInvite(e.target.value.toUpperCase())} className="tabular-nums tracking-wider" />
        </label>
      ) : null}
      {error ? <p className="rounded-lg bg-danger/10 p-2 text-sm text-danger">{error}</p> : null}
      <Button type="submit" disabled={busy} block>
        {first ? "اعمل الحساب وادخل" : invite !== null ? "ثبّت كلمة السر وادخل" : "ادخل"}
      </Button>
      {!first ? (
        <Button variant="ghost" size="sm" block onClick={() => setInvite(invite === null ? "" : null)}>
          {invite === null ? "عندي رمز دعوة من المالك" : "عندي كلمة سر — رجّعني"}
        </Button>
      ) : null}
    </form>
  );
}
